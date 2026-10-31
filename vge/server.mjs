// Vite dev backend for Unreal runtime processes.
// One Vite server owns file watching, TypeScript transforms, the module graph and HMR for two
// environments: `unreal` (game code; every Unreal process is a ModuleRunner client over WebSocket at
// /__unreal) and the regular browser `client` (the HTML/CSS UI at /src/ui/, shown in the game by the
// engine's embedded browser with Vite's own HMR client). Both share one HTTP port.
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { makeIdFiltersToMatchWithQuery } from '@rolldown/pluginutils';
import { DevEnvironment, createServer, transformWithOxc } from 'vite';
import { reactRefreshWrapperPlugin } from 'vite/internal';
import { WebSocketServer } from 'ws';
import { createFab } from './content/fab.mjs';
import { createContentPipeline } from './content/pipeline.mjs';
import { importedContent } from './content/imports.mjs';
import { contentSpec, specOfModelKey } from './content/characters.mjs';
import { ports, runtimeDir, shellSecret } from './tools/engine.mjs';
import { isAlive, registerRuntimeUse, trackProcess } from './tools/processes.mjs';
import { startShell } from './tools/shell.mjs';
import { createMaterialModules, handleModule } from './content/materials.mjs';
import { createNiagaraModules, NIAGARA_MODULE, niagaraHandleModule } from './content/niagara.mjs';
import { createTerrainModules, TERRAIN_MODULE, terrainHandleModule } from './content/terrain.mjs';
import { createMotionModules, MOTION_MODULE, motionHandleModule } from './content/motion.mjs';
import { COMPUTE_MODULE, computeHandleModule, createComputeModules } from './content/compute.mjs';
import { createPcgModules, PCG_MODULE, pcgHandleModule } from './content/pcg.mjs';
import { createFractureModules, FRACTURE_MODULE, fractureHandleModule } from './content/fracture.mjs';
import { contentAssetsPlugin } from './vite/contentAssetsPlugin.mjs';
import { devLeanTransportPlugin } from './vite/devLeanTransportPlugin.ts';
import { materialsEnvironment, uiKitClientPlugins, unrealOptimizeDeps, unrealResolve } from './vite/environments.mjs';
import { reactCompilerPlugin } from './vite/reactCompiler.mjs';
import { materialAssetsPlugin } from './vite/materialAssetsPlugin.mjs';
import { liveEditPlugins } from './edit/plugin.mjs';

const PORT = ports().dev;
const PATH = '/__unreal';

// The game channel and the eval seam run code in the game, so only the kit's own processes may use them: the
// games (Puerts' WebSocket client) and the tools (Node's fetch) send no Origin header, while every request a web
// page makes does, so a page open in any browser while the dev server runs cannot reach them.
const fromAPage = (request) => request.headers.origin !== undefined;

function createUnrealHotChannel() {
  const listeners = new Map();
  const sockets = new Set();
  const wss = new WebSocketServer({ noServer: true });

  const dispatch = (event, data, client) => {
    for (const fn of listeners.get(event) ?? []) fn(data, client);
  };

  wss.on('connection', (socket, request) => {
    sockets.add(socket);
    const client = { send: (payload) => socket.send(JSON.stringify(payload)) };
    console.log(`[vge] unreal client connected from ${request.socket.remoteAddress} (${sockets.size} total)`);
    socket.on('message', (raw) => {
      const payload = JSON.parse(raw.toString());
      if (payload.type === 'custom') dispatch(payload.event, payload.data, client);
    });
    socket.on('close', () => {
      sockets.delete(socket);
      console.log(`[vge] unreal client disconnected (${sockets.size} left)`);
    });
    dispatch('connection');
  });

  return {
    skipFsCheck: false,
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    off(event, fn) {
      listeners.get(event)?.delete(fn);
    },
    send(payload) {
      const text = JSON.stringify(payload);
      for (const socket of sockets) if (socket.readyState === socket.OPEN) socket.send(text);
    },
    // Takes only upgrades for PATH on the shared HTTP server; Vite's own HMR socket keeps the rest.
    attach(httpServer) {
      httpServer.on('upgrade', (request, socket, head) => {
        if (new URL(request.url, 'http://localhost').pathname !== PATH) return;
        if (fromAPage(request)) {
          socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
      });
    },
    listen() {},
    clientCount: () => sockets.size,
    close() {
      for (const socket of sockets) socket.close();
      return new Promise((resolvePromise) => wss.close(() => resolvePromise()));
    },
  };
}

const unrealChannel = createUnrealHotChannel();

// Model files the game code imports become cooked containers; runtimes are told over the unreal hot channel.
const pipeline = createContentPipeline({ projectDir: resolve(process.cwd(), 'unreal') });

function isHalfWritten(file) {
  try {
    return !readFileSync(file, 'utf8').trim();
  } catch {
    return false;
  }
}

function contentPlugins() {
  let unreal;
  let server;
  // Material modules: described in the `materials` environment, built by the pipeline, imported by the game as handles.
  const materials = createMaterialModules({ root: process.cwd(), environment: () => server.environments.materials, folderRoot: '/VgeLive/Materials' });
  const handles = new Map();
  const buildMaterials = (key, exports) => {
    console.log(`[content] building materials of ${key}`);
    pipeline.enqueueMaterials(key, exports, (err, result) => {
      if (err) {
        console.error(`[content] ${err.message}`);
        unreal().send('vge:content-error', { file: key, message: err.message });
        return;
      }
      for (const line of result.errors ?? []) console.error(`[content] ${key}: ${line}`);
      if (result.errors?.length) unreal().send('vge:content-error', { file: key, message: `the cook reported material errors:\n${result.errors.join('\n')}` });
      unreal().send('vge:content', result.manifest);
    });
  };
  // A build is needed when an export's asset (its description's hash) is not the one the mounted build has.
  const needsBuild = (exports) => {
    const { materials: built, assets } = pipeline.materialState();
    return exports.some((e) => built[e.exportKey]?.path !== e.path || !assets[e.path] || (e.base && !assets[e.base.path]));
  };
  const describeMaterials = async (file, key) => {
    const exports = await materials.describe(file);
    const code = handleModule(exports);
    handles.set(key, code);
    if (needsBuild(exports)) buildMaterials(key, exports);
    return code;
  };
  // Niagara and terrain modules: described like material modules (they use materials), built by the pipeline through
  // the content service, imported by the game as handles.
  const describedModules = ({ modules, handleModuleOf, enqueue, currentState, table, noun, modelsOf = () => [] }) => {
    const build = (key, exports) => {
      const models = [...new Set(exports.flatMap(modelsOf))].map((model) => specOfModelKey(process.cwd(), model)).filter((spec) => pipeline.isStale(spec));
      if (models.length) {
        let waiting = models.length;
        let failed = false;
        for (const spec of models) {
          console.log(`[content] building ${spec.key} for ${key}`);
          pipeline.enqueue(spec, (err, result) => {
            if (err) {
              failed = true;
              console.error(`[content] ${err.message}`);
              unreal().send('vge:content-error', { file: key, message: `${spec.key}, which ${key} uses, did not build: ${err.message}` });
            } else unreal().send('vge:content', result.manifest);
            if (--waiting === 0 && !failed) build(key, exports);
          });
        }
        return;
      }
      console.log(`[content] building ${noun} of ${key}`);
      enqueue(key, exports, (err, result) => {
        if (err) {
          console.error(`[content] ${err.message}`);
          unreal().send('vge:content-error', { file: key, message: err.message });
          return;
        }
        for (const line of result.errors ?? []) console.error(`[content] ${key}: ${line}`);
        if (result.errors?.length) unreal().send('vge:content-error', { file: key, message: `the cook reported errors:\n${result.errors.join('\n')}` });
        unreal().send('vge:content', result.manifest);
      });
    };
    const needsBuild = (exports) => {
      const { [table]: built, assets, materialAssets, models } = currentState();
      const staleModel = (e) =>
        modelsOf(e).some((model) => {
          const spec = specOfModelKey(process.cwd(), model);
          return pipeline.isStale(spec) || built[e.exportKey]?.modelBuilds?.[spec.key] !== models[spec.key]?.build;
        });
      return exports.some((e) => {
        const path = pipeline.versionOf(e).path;
        return built[e.exportKey]?.path !== path || !assets[path] || e.materials.some((m) => !materialAssets[m.path]) || staleModel(e);
      });
    };
    return async (file, key) => {
      const exports = await modules.describe(file);
      const code = handleModuleOf(exports);
      handles.set(key, code);
      if (needsBuild(exports)) build(key, exports);
      return code;
    };
  };
  const niagara = createNiagaraModules({ materials, folderRoot: '/VgeLive/Niagara' });
  const describeNiagara = describedModules({ modules: niagara, handleModuleOf: niagaraHandleModule, enqueue: pipeline.enqueueNiagara, currentState: pipeline.niagaraState, table: 'niagara', noun: 'systems' });
  const terrain = createTerrainModules({ materials, folderRoot: '/VgeLive/Terrain' });
  const describeTerrain = describedModules({ modules: terrain, handleModuleOf: terrainHandleModule, enqueue: pipeline.enqueueTerrain, currentState: pipeline.terrainState, table: 'terrain', noun: 'terrains', modelsOf: (entry) => (entry.request.grass ?? []).map((grass) => grass.model) });
  const motion = createMotionModules({ materials, folderRoot: '/VgeLive/Motion' });
  const describeMotion = describedModules({ modules: motion, handleModuleOf: motionHandleModule, enqueue: pipeline.enqueueMotion, currentState: pipeline.motionState, table: 'motion', noun: 'motion matching graphs', modelsOf: (entry) => entry.request.models ?? [] });
  const compute = createComputeModules({ materials, folderRoot: '/VgeLive/Compute' });
  const describeCompute = describedModules({ modules: compute, handleModuleOf: computeHandleModule, enqueue: pipeline.enqueueCompute, currentState: pipeline.computeState, table: 'compute', noun: 'compute graphs' });
  const pcg = createPcgModules({ materials, folderRoot: '/VgeLive/Pcg' });
  const describePcg = describedModules({ modules: pcg, handleModuleOf: pcgHandleModule, enqueue: pipeline.enqueuePcg, currentState: pipeline.pcgState, table: 'pcg', noun: 'PCG graphs', modelsOf: (entry) => entry.request.models });
  const fracture = createFractureModules({ materials, folderRoot: '/VgeLive/Fracture' });
  const describeFracture = describedModules({ modules: fracture, handleModuleOf: fractureHandleModule, enqueue: pipeline.enqueueFracture, currentState: pipeline.fractureState, table: 'fracture', noun: 'geometry collections', modelsOf: (entry) => entry.request.models });
  // An edit of a material or Niagara module, or of anything it imports: its assets are described again, built when
  // they changed, and the game reloads its handle module only when the exports themselves changed.
  const builtTables = () => [[describeMotion, pipeline.motionState, 'motion'], [describeTerrain, pipeline.terrainState, 'terrain'], [describeNiagara, pipeline.niagaraState, 'niagara'], [describePcg, pipeline.pcgState, 'pcg'], [describeFracture, pipeline.fractureState, 'fracture']];
  const modulesBuiltOn = (file) => {
    const target = resolve(file);
    const found = new Map();
    for (const [describe, current, table] of builtTables()) {
      for (const [exportKey, entry] of Object.entries(current()[table] ?? {})) {
        if (!(entry.models ?? []).some((model) => resolve(process.cwd(), model.split('?')[0]) === target)) continue;
        const moduleFile = resolve(process.cwd(), exportKey.split('#')[0]).replaceAll('\\', '/');
        found.set(moduleFile, { moduleFile, describe });
      }
    }
    return [...found.values()];
  };
  const onFileChange = async (file) => {
    if (isHalfWritten(file)) return;
    const graphed = [
      ...materials.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeMaterials })),
      ...niagara.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeNiagara })),
      ...terrain.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeTerrain })),
      ...motion.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeMotion })),
      ...compute.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeCompute })),
      ...pcg.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describePcg })),
      ...fracture.affectedBy(file).map((moduleFile) => ({ moduleFile, describe: describeFracture })),
    ];
    const affected = [...graphed, ...modulesBuiltOn(file).filter((built) => !graphed.some((entry) => entry.moduleFile === built.moduleFile))];
    if (!affected.length) return;
    materials.invalidate(file);
    for (const { moduleFile, describe } of affected) {
      const key = materials.keyOf(moduleFile);
      try {
        const previous = handles.get(key);
        const code = await describe(moduleFile, key);
        if (previous !== undefined && previous !== code) {
          for (const node of server.environments.unreal.moduleGraph.getModulesByFile(moduleFile) ?? []) await server.environments.unreal.reloadModule(node);
        }
      } catch (err) {
        console.error(`[content] ${key}: ${err?.stack ?? err}`);
        unreal().send('vge:content-error', { file: key, message: String(err?.message ?? err) });
      }
    }
  };
  const build = (spec) => {
    console.log(`[content] building ${spec.key}`);
    if (spec.kind === 'model' && /\.(glb|gltf)$/i.test(spec.file)) unreal().send('vge:content-preview', { key: spec.key, file: spec.file });
    pipeline.enqueue(spec, (err, result) => {
      if (err) {
        console.error(`[content] ${err.message}`);
        unreal().send('vge:content-error', { file: spec.key, message: err.message });
      } else {
        unreal().send('vge:content', result.manifest);
      }
    });
  };
  return [
    {
      name: 'vge:content',
      configureServer(viteServer) {
        server = viteServer;
        server.watcher.on('change', onFileChange);
        server.watcher.on('add', onFileChange);
        unrealChannel.attach(server.httpServer);
        unreal = () => server.environments.unreal.hot;
        unreal().on('vge:content-sync', (_data, client) => client.send('vge:content', pipeline.manifest()));
        // The content service warms up with the dev server, so the first imported model does not wait for it.
        pipeline.startService();
        for (const [describe, current, table] of builtTables()) {
          const built = Object.entries(current()[table] ?? {});
          const stale = built.filter(([, entry]) => (entry.models ?? []).some((model) => pipeline.isStale(specOfModelKey(process.cwd(), model))));
          for (const key of new Set(stale.map(([exportKey]) => exportKey.split('#')[0]))) {
            describe(resolve(process.cwd(), key), key).catch((err) => console.error(`[content] ${key}: ${err?.message ?? err}`));
          }
        }
        pipeline.restoreMissing((err, result) => {
          if (err) console.error(`[content] ${err.message}`);
          else unreal().send('vge:content', result.manifest);
        });
        // What no code imports any more is removed: now, and a moment after a code file is saved or deleted.
        const sweepUnused = () =>
          importedContent({ root: process.cwd(), srcDir: resolve(process.cwd(), 'src') }).then((content) =>
            pipeline.removeUnusedContent(content, (err, result) => {
              if (err) return console.error(`[content] removing unused content failed: ${err.message}`);
              // Vite keeps a loaded model module: an import of a removed asset added back must load it again, so that
              // the load builds it (vite/contentAssetsPlugin.mjs onImport).
              const graph = server.environments.unreal.moduleGraph;
              for (const [id, module] of graph.idToModuleMap) {
                const [file, query] = id.split('?');
                if (/\.(glb|gltf|fbx|wav|mp3|ogg|flac|opus|aif|aiff)$/i.test(file) && result.removedAssets.includes(contentSpec(process.cwd(), file, query).key)) graph.invalidateModule(module);
              }
              for (const key of result.removedModules ?? []) {
                for (const module of graph.getModulesByFile(resolve(process.cwd(), key)) ?? []) graph.invalidateModule(module);
              }
              if (result.manifest) unreal().send('vge:content', result.manifest);
            }),
          );
        sweepUnused();
        let sweep;
        const onCodeSaved = (file) => {
          if (!/\.(m?[jt]sx?)$/.test(file)) return;
          clearTimeout(sweep);
          sweep = setTimeout(sweepUnused, 1000);
        };
        server.watcher.on('change', onCodeSaved);
        server.watcher.on('unlink', onCodeSaved);
      },
    },
    // A model is built when the game code first imports it (unless its last build is current) and on every save.
    contentAssetsPlugin({
      root: process.cwd(),
      onImport: (spec) => {
        if (pipeline.isStale(spec)) build(spec);
      },
      // Every import of the saved file: the model itself and its variants; imports built on a model follow it.
      onChange: (file) => {
        for (const spec of pipeline.specsOf(file)) build(spec);
      },
    }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeMaterials }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeNiagara, pattern: NIAGARA_MODULE, name: 'vge:niagara-assets' }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeTerrain, pattern: TERRAIN_MODULE, name: 'vge:terrain-assets' }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeMotion, pattern: MOTION_MODULE, name: 'vge:motion-assets' }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeCompute, pattern: COMPUTE_MODULE, name: 'vge:compute-assets' }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describePcg, pattern: PCG_MODULE, name: 'vge:pcg-assets' }),
    materialAssetsPlugin({ root: process.cwd(), onImport: describeFracture, pattern: FRACTURE_MODULE, name: 'vge:fracture-assets' }),
  ];
}

// DEV seam: POST /__vge/eval {"code": "<expression>", "scene"?: "labs/<id>"} evaluates the expression in every
// connected Unreal process, or only in the one on `scene` (src/app/debug-seam.ts), and answers with their results
// (tools/game.mjs is the CLI for it).
// Refused to web pages (fromAPage).
function evalPlugin() {
  return {
    name: 'vge:eval',
    configureServer(server) {
      const unreal = () => server.environments.unreal.hot;
      const pending = new Map();
      unreal().on('vge:eval-result', (reply) => pending.get(reply.id)?.(reply));
      server.middlewares.use('/__vge/eval', (req, res) => {
        if (req.method !== 'POST' || fromAPage(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const { code, timeoutMs = 5000, scene } = JSON.parse(body || '{}');
          const id = Math.random().toString(36).slice(2);
          const expected = unrealChannel.clientCount();
          const results = [];
          const finish = () => {
            pending.delete(id);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ clients: expected, results }));
          };
          const timer = setTimeout(finish, timeoutMs);
          pending.set(id, (reply) => {
            results.push(reply);
            if (results.length >= expected) {
              clearTimeout(timer);
              finish();
            }
          });
          if (expected === 0) {
            clearTimeout(timer);
            finish();
          } else {
            unreal().send('vge:eval', { id, code, ...(scene ? { scene } : {}) });
          }
        });
      });
    },
  };
}

// POST /__vge/shell/open {"scene": "labs/<id>" | "main"}: the shell page goes to that lab's screen or the main one (the
// game's main scene), and the shell
// opens its world (src/ui/shell/open.ts); answers how many pages heard it. tools/open.mjs (npm run open) is the CLI.
// Refused to web pages (fromAPage).
function shellPlugin() {
  return {
    name: 'vge:shell',
    configureServer(server) {
      server.middlewares.use('/__vge/shell/open', (req, res) => {
        if (req.method !== 'POST' || fromAPage(req)) {
          res.statusCode = 403;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const { scene = 'main' } = JSON.parse(body || '{}');
          const path = scene.startsWith('labs/') ? `/${scene}` : '/';
          server.ws.send({ type: 'custom', event: 'vge:shell-open', data: { path } });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ path, pages: server.ws.clients.size }));
        });
      });
    },
  };
}

// The Fab window's calls (vge/shell/src/FabWindow.cpp -> content/fab.mjs), refused to web pages (fromAPage) other than
// the kit's shell, which goes out with an Origin as a browser does and proves itself with X-Vge-Shell (shellSecret):
//   POST /__vge/fab           {"method":"addtoproject","args":[...]} -> one JSON object per line as the call goes:
//                             {"progress":{"stage":"downloading","percent":42}} ..., then {"result":...} or {"error":"..."}
//   POST /__vge/fab/open      {"url":"https://www.fab.com/listings/<id>"}: the shell page opens the Fab window on it
//                             (ui/shell/fab.ts); answers how many pages heard it
//   GET  /__vge/fab/installs  every install from the Fab window, with its state and where it landed (tools/fab.mjs)
//   POST /__vge/fab/pack      {"name":"<Pack>","from":"<folder holding Content/<Pack>>"}: a pack already on disk (the
//                             launcher's VaultCache download) into Content/<Pack> and its container, as Add to Project
//   POST /__vge/fab/plugin    {"from":"<folder holding <Name>.uplugin>"}: a plugin already on disk into
//                             Plugins/Marketplace/<Name> and the runtime, as Install Plugin after its download
// Its middleware goes ahead of the lean transport's, which holds a response back until it ends.
function fabPlugin() {
  return {
    name: 'vge:fab',
    configureServer(server) {
      const unreal = () => server.environments.unreal.hot;
      const fab = createFab({
        projectDir: resolve(process.cwd(), 'unreal'),
        devDir: process.cwd(),
        pipeline,
        broadcast: (manifest) => unreal().send('vge:content', manifest),
        // The shell page's notices (ui/shell/FabNotices.tsx) follow each install.
        notify: (entry) => server.ws.send({ type: 'custom', event: 'vge:fab-install', data: entry }),
      });
      const readJson = (req) =>
        new Promise((resolvePromise) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => resolvePromise(JSON.parse(body || '{}')));
        });
      const secret = shellSecret();
      server.middlewares.use('/__vge/fab', async (req, res) => {
        if (fromAPage(req) && req.headers['x-vge-shell'] !== secret) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const path = new URL(req.url, 'http://localhost').pathname;
        if (req.method === 'GET' && path === '/installs') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(fab.installs(), null, 2));
          return;
        }
        if (req.method === 'POST' && path === '/open') {
          const { url } = await readJson(req);
          server.ws.send({ type: 'custom', event: 'vge:fab-open', data: { url } });
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ pages: server.ws.clients.size }));
          return;
        }
        if (req.method === 'POST' && path === '/plugin') {
          // Answered at once: the runtime build takes half an hour; /installs follows it (id `plugin:<Name>`).
          const { from } = await readJson(req);
          res.setHeader('content-type', 'application/json');
          try {
            fab.addPlugin(from).catch(() => {});
            res.end(JSON.stringify({ started: true }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        if (req.method === 'POST' && path === '/pack') {
          const { name, from } = await readJson(req);
          res.setHeader('content-type', 'application/json');
          try {
            res.end(JSON.stringify(await fab.addPack(name, from)));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
        if (req.method !== 'POST' || path !== '/') {
          res.statusCode = 404;
          res.end();
          return;
        }
        const { method, args = [] } = await readJson(req);
        res.setHeader('content-type', 'application/x-ndjson');
        res.setHeader('content-encoding', 'identity');
        const line = (value) => res.write(`${JSON.stringify(value)}\n`);
        try {
          line({ result: (await fab.call(method, args, (progress) => line({ progress }))) ?? null });
        } catch (err) {
          line({ error: err.message });
        }
        res.end();
      });
    },
  };
}

// React Fast Refresh for the game code, the browser's own: @vitejs/plugin-react gives it to the `client`
// environment only, and Vite's oxc plugin turns JSX refresh off for any `server` consumer (vite:oxc,
// getModifiedOxcTransformOptions). The same oxc transform with refresh, and the same refresh wrapper
// (vite/internal reactRefreshWrapperPlugin: registers exports, accepts the module, falls back to a reload),
// run here for `unreal`. The runtime is plugin-react's /@react-refresh, whose preamble src/app/refresh.ts runs.
function unrealReactRefresh() {
  const isUnreal = (environment) => environment.name === 'unreal';
  const filter = { include: makeIdFiltersToMatchWithQuery(/\.[tj]sx?$/), exclude: makeIdFiltersToMatchWithQuery(/\/node_modules\//) };
  return [
    {
      name: 'vge:react-refresh-transform',
      enforce: 'pre',
      applyToEnvironment: isUnreal,
      async transform(code, id) {
        const [file] = id.split('?');
        if (!/\.[tj]sx$/.test(file) || file.includes('/node_modules/')) return;
        const result = await transformWithOxc(code, file, { jsx: { runtime: 'automatic', development: true, refresh: true }, sourcemap: true });
        return { code: result.code, map: result.map };
      },
    },
    {
      name: 'vge:react-refresh-wrapper',
      applyToEnvironment: (environment) =>
        isUnreal(environment) && reactRefreshWrapperPlugin({ cwd: process.cwd(), ...filter, jsxImportSource: 'react', reactRefreshHost: '' }),
    },
  ];
}

// chokidar's ignore test for the dev server's watch: the checkout's root itself (so it is walked into) and src/.
function watchesOnlySrc(path) {
  const rel = relative(process.cwd(), path);
  return rel !== '' && rel !== 'src' && !rel.startsWith(`src${sep}`) && !rel.startsWith('src/');
}

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  appType: 'mpa',
  logLevel: 'info',
  // The shell's inspection surfaces (the web-starter-kit's lab index and UI-kit gallery) exist in dev only.
  define: { __SHOWCASE_SURFACES__: 'true' },
  plugins: [fabPlugin(), devLeanTransportPlugin({ compress: true, stripSourcemaps: true }), react(), reactCompilerPlugin(), unrealReactRefresh(), uiKitClientPlugins(), contentPlugins(), evalPlugin(), shellPlugin(), liveEditPlugins({ root: process.cwd() })],
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    // Watch only what the runtimes execute: the game's code and UI in src/. The root also holds the Unreal project
    // (unreal/: Content, Saved, Intermediate, links into the runtime), which a whole-root watch would walk and track.
    watch: { ignored: [watchesOnlySrc, '**/node_modules/**', '**/*.log'] },
  },
  environments: {
    unreal: {
      consumer: 'server',
      resolve: unrealResolve,
      optimizeDeps: unrealOptimizeDeps,
      dev: {
        createEnvironment: (name, config) =>
          new DevEnvironment(name, config, { hot: true, transport: unrealChannel, remoteRunner: { inlineSourceMap: false } }),
      },
    },
    materials: materialsEnvironment,
    client: {
      // The shell page reads the game's lab manifests (ui/app/labs/labRegistry.ts), whose loaders point at game
      // code; the dependency scan follows them, and Puerts' native modules exist only inside the engine.
      optimizeDeps: { exclude: ['ue', 'puerts'] },
    },
  },
});
await server.listen();
trackProcess('dev', process.pid);
registerRuntimeUse(runtimeDir());
console.log(`[vge] waiting for Unreal on ws://127.0.0.1:${PORT}${PATH}; the shell's app is http://127.0.0.1:${PORT}/`);

// If this process is killed outright, the service sees its stdin close and exits by itself.
async function stop() {
  pipeline.stopService();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', stop);

// One dev session: the dev server and the shell, where the human sees the game and agents open their scenes
// (npm run open, game.mjs --scene). The shell opens with the server, or the one already open is kept (the server was
// restarted under it; its page reconnects). Closing the shell ends the session. --no-shell (or VGE_NO_SHELL=1): the
// server alone, for headless checks.
if (!process.argv.includes('--no-shell') && process.env.VGE_NO_SHELL !== '1') {
  const shell = startShell();
  console.log(shell.started ? `[vge] shell opened, pid ${shell.pid}` : `[vge] shell already open, pid ${shell.pid}`);
  setInterval(() => {
    if (isAlive(shell.pid)) return;
    console.log('[vge] the shell was closed: the dev session ends');
    stop();
  }, 1000);
}
