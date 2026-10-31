// Content pipeline: turns a model file the game code imports into a cooked content container that a running
// VibeGameEngine mounts. Only files imported by the game code are built (vge/vite/contentAssetsPlugin.mjs asks
// for them); nothing is picked up from a folder. Every step is a stock engine tool, run the way BuildCookRun
// runs it for a DLC plugin:
//   decode   - gltf-transform removes what Interchange cannot read (content/decode.mjs)
//   import   - resident VgeContentService: Interchange import, Nanite on, save into the VgeLive plugin
//   cook     - stock CookCommandlet (-dlcname=VgeLive -basedonreleaseversion=<release>) in a standby process, limited
//              to the content folders of this build (VgeAssetManager.h) and not following references
//   package  - UnrealPak -CreateMultiple (.pak) and UnrealPak -CreateDLCContainer (.utoc/.ucas)
// Each build has a container of its own, holding only what that build imported: a build never cooks or packages
// content another build made, builds of different files run at the same time (COOKERS standby cook processes), and
// a running game mounts every container the manifest lists. References between containers (clips on a model's
// skeleton, a system's materials) are resolved by the game from the container that holds the referenced package.
// An asset pack added from Fab (content/fab.mjs) is cooked and packaged the same way into a container of its own
// (buildPack below).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { engine, runtimeDir } from '../tools/engine.mjs';
import { clipsRequests, importSpec, modelsOf, specOfModelKey } from './characters.mjs';
import { clothOf } from './cloth.mjs';
import { createStandbyCooker } from './cooker.mjs';
import { buildNiagaraSystem } from './niagara.mjs';
import { buildTerrainLevel } from './terrain.mjs';
import { buildMotionMatching } from './motion.mjs';
import { buildComputeGraph } from './compute.mjs';
import { buildPcgGraph } from './pcg.mjs';
import { buildFracture } from './fracture.mjs';
import { buildVehicle } from './vehicle.mjs';
import { buildGroomBinding } from './groom.mjs';
import { assetName, createDecoder } from './decode.mjs';
import { prepareSound } from './sound.mjs';
import { createContentService } from './service.mjs';

const { editorCmd: EDITOR_CMD, unrealPak: UNREAL_PAK } = engine();
const PLUGIN = 'VgeLive';
// Cooked files that go into the IoStore container (shader info files stay metadata, as in UAT staging).
const CONTAINER_FILES = /\.(uasset|umap|uexp|ubulk|uptnl|ushaderbytecode)$/i;
// live-state.json layout; state written by another layout is dropped together with the content it describes.
const STATE_VERSION = 4;
// Cook processes kept in standby: builds of this many files cook at the same time.
const COOKERS = 3;

function materialCompileFailures(log) {
  const failures = new Map();
  const lines = log.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const failed = line.match(/[\\/]Content[\\/](.+?)\.uasset: Failed to compile Material/);
    const material = failed?.[1].replaceAll('\\', '/');
    const reason = lines[index + 1]?.trim();
    if (material && (reason || !failures.has(material))) failures.set(material, reason || 'see the cook log');
  }
  return [...failures].map(([material, reason]) => `${material}: ${reason}`);
}

export function createContentPipeline({ projectDir, release = 'dev', log = console.log }) {
  const project = resolve(projectDir, 'VibeGameEngine.uproject');
  const devDir = resolve(projectDir, '..');
  const modelKeysOf = (entry) => [...(entry.request?.grass ?? []).map((grass) => grass.model), ...(entry.request?.models ?? [])].map((model) => specOfModelKey(devDir, model).key);
  const toolsVersion = (() => {
    const hash = createHash('sha1');
    const walk = (dir) => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else hash.update(name).update(readFileSync(path));
      }
    };
    walk(resolve(projectDir, 'Source', 'VibeGameEngineTools'));
    return hash.digest('hex');
  })();
  const versionOf = (entry) => {
    const models = modelKeysOf(entry);
    const builds = createHash('sha1').update(JSON.stringify([toolsVersion, models.map((model) => state.assets[model]?.build ?? 0)])).digest('hex').slice(0, 8);
    const folder = `${entry.folder}_${builds}`;
    return { ...entry, folder, path: entry.path.split(entry.folder).join(folder) };
  };
  const pluginDir = resolve(projectDir, 'Plugins', PLUGIN);
  const contentDir = join(pluginDir, 'Content');
  // Each build cooks into a folder of its own under the project's Saved, not the plugin's: a cooked texture's path
  // under Plugins/VgeLive/Saved/Cooked/Windows/VibeGameEngine/Plugins/VgeLive/... went past Windows' 260 characters
  // (game-jam-test: 262) and failed the cook.
  const cookedRootOf = (tag) => join(projectDir, 'Saved', 'VgeCook', tag);
  const cookedPluginOf = (cookedRoot) => join(cookedRoot, 'VibeGameEngine', 'Plugins', PLUGIN);
  const workDir = join(pluginDir, 'Saved', 'Pipeline');
  const outDir = join(pluginDir, 'Saved', 'Containers');
  const statePath = join(pluginDir, 'Saved', 'live-state.json');
  mkdirSync(workDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  let state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null;
  // Version 3 kept one container holding everything: it becomes the container of every asset it holds, so nothing is
  // built again.
  if (state?.version === 3) {
    state.containers = {};
    const holder = state.container;
    if (holder?.pak) {
      const name = basename(holder.pak).replace(/\.pak$/i, '');
      const folders = [
        ...Object.values(state.assets ?? {}).map((asset) => `${asset.dest}/`),
        ...Object.values(state.materialAssets ?? {}).map((asset) => `${asset.folder}/`),
        ...Object.values(state.niagaraAssets ?? {}).map((asset) => `${asset.folder}/`),
      ];
      state.containers[name] = { pak: holder.pak, shaderLibrary: holder.shaderLibrary ?? '', build: holder.build, folders };
      for (const records of [state.assets, state.materialAssets, state.niagaraAssets]) {
        for (const record of Object.values(records ?? {})) record.container = name;
      }
    }
    delete state.container;
    state.version = STATE_VERSION;
  }
  if (state?.version !== STATE_VERSION) {
    // Read before the service starts, so no process holds the packages being removed. Build numbers keep
    // counting: a running game may still have older containers mounted under their names.
    for (const name of existsSync(contentDir) ? readdirSync(contentDir) : []) {
      if (name !== '.keep') rmSync(join(contentDir, name), { recursive: true, force: true });
    }
    // Asset packs live in the project's Content, not in the plugin: their containers stay valid.
    state = { version: STATE_VERSION, build: state?.build ?? 0, assets: {}, containers: {}, packs: state?.packs ?? {} };
  }
  state.containers ??= {};
  // Containers are found by name in this checkout's container folder: the state keeps the path they were written at,
  // which is another one once the checkout or its Unreal project folder moved.
  const here = (pak) => join(outDir, basename(pak)).replaceAll('\\', '/');
  for (const container of Object.values(state.containers)) container.pak = here(container.pak);
  // An import's file is the key's path (without its query) in this checkout: the state keeps the absolute path it was
  // read from, which is another one once the checkout or its code folder moved.
  for (const [key, asset] of Object.entries(state.assets)) asset.source = resolve(devDir, key.split('?')[0]);
  for (const pack of Object.values(state.packs ?? {})) if (pack.pak) pack.pak = here(pack.pak);
  const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  // Builds in progress per id (schedule), ids waiting for another run, and the tags of builds whose containers are
  // being written and are not in the state yet (left alone by collectOldBuilds).
  const running = new Map();
  const queued = new Set();
  const writing = new Set();

  const decode = createDecoder();
  // Import and deletion run inside the resident service; the cook stays an external commandlet,
  // which is how the editor itself cooks since 5.7 (UnrealEdEngine.cpp: in-editor cook is deprecated).
  const service = createContentService({ editorCmd: EDITOR_CMD, project, logFile: join(pluginDir, 'Saved', 'content-service.log'), log });
  // That external cook is started ahead of time and waits in standby, so its engine startup is not on
  // the path of an asset edit.
  const cooker = createStandbyCooker({
    editorCmd: EDITOR_CMD,
    project,
    cookArgs: ['-TargetPlatform=Windows', '-unversioned', '-SkipZenStore', `-dlcname=${PLUGIN}`, `-basedonreleaseversion=${release}`],
    logDir: workDir,
    count: COOKERS,
    log,
  });

  function run(label, exe, args, logFile) {
    return new Promise((resolvePromise, reject) => {
      const started = Date.now();
      const child = spawn(exe, args, { windowsHide: true });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      child.on('error', reject);
      child.on('close', (code) => {
        writeFileSync(logFile, output);
        const seconds = (Date.now() - started) / 1000;
        if (code === 0) resolvePromise(seconds);
        else reject(new Error(`${label} failed with exit code ${code}; log: ${logFile}\n${output.split('\n').filter((l) => /Error|error:/.test(l)).slice(0, 10).join('\n')}`));
      });
    });
  }

  function listFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
  }

  // Path inside the container, the same mount-relative form the staged DLC uses.
  const mountPath = (cookedPlugin, file) => `../../../VibeGameEngine/Plugins/${PLUGIN}/${relative(cookedPlugin, file).replaceAll('\\', '/')}`;

  // A build's number names its work folder, its container and the content folders it imports into. The number is
  // saved only after a successful cook, so after a failed build and a restart the same number would be given again
  // and an import would land on the failed build's leftovers (game-jam-test: a SkeletalMesh with no Skeleton). A
  // number is taken by creating its work folder, starting past the highest one on disk.
  let reservedBuild = readdirSync(workDir).reduce((highest, name) => Math.max(highest, Number(/^b(\d+)(?:-|$)/.exec(name)?.[1] ?? 0)), state.build);
  const newBuild = (suffix = '') => {
    for (;;) {
      const buildId = ++reservedBuild;
      const tag = `b${String(buildId).padStart(4, '0')}`;
      const logs = join(workDir, `${tag}${suffix}`);
      try {
        mkdirSync(logs);
      } catch (err) {
        if (err.code === 'EEXIST') continue;
        throw err;
      }
      state.build = buildId;
      writing.add(tag);
      return { buildId, tag, logs };
    }
  };

  // The stock DLC cook of one build's content folders (`folders`, /VgeLive/FlightCase_b0051/) and its packaging into
  // a container of its own, `VgeLive-<tag>`. The cook takes only those folders' packages (VgeAssetManager.h) and does
  // not follow references: what they reference is in the base release or in the container of the build that made it.
  // The shader library the cook writes under the plugin's name is renamed after the build: a library is one component
  // per name and directory (FNamedShaderLibrary::OpenShaderCode, HasContentFrom), so a second container with a library
  // of the same name adds no component and the game would never see its new shaders. A name per build is a library of
  // its own, opened beside the others; an IoStore library is found by that name (FIoStoreShaderCodeArchive::Create).
  async function cookAndPackage({ tag, logs, folders }) {
    const timings = {};
    const cookedRoot = cookedRootOf(tag);
    const cookedPlugin = cookedPluginOf(cookedRoot);
    rmSync(cookedRoot, { recursive: true, force: true });
    try {
      const cooked = await cooker.cook({ args: [`-OutputDir=${cookedRoot}`, '-CookSkipHardRefs', '-CookSkipSoftRefs'], folders });
      copyFileSync(cooked.logFile, join(logs, 'cook.log'));
      const brokenMaterials = materialCompileFailures(readFileSync(cooked.logFile, 'utf8'));
      if (brokenMaterials.length) throw new Error(`the cook could not compile ${brokenMaterials.join('; ')}`);
      timings.cook = cooked.seconds;
      if (cooked.waited > 0.05) timings.cookWait = cooked.waited;

      const shaderLibrary = `${PLUGIN}${tag}`;
      let library = null;
      for (const file of listFiles(join(cookedPlugin, 'Content'))) {
        const base = file.replace(/^.*[\\/]/, '');
        const renamed = base.replace(`-${PLUGIN}-`, `-${shaderLibrary}-`);
        if (renamed === base || !/^(ShaderArchive|ShaderAssetInfo)-/.test(base)) continue;
        renameSync(file, join(cookedPlugin, 'Content', renamed));
        if (renamed.endsWith('.ushaderbytecode')) library = renamed;
      }
      const packaged = listFiles(join(cookedPlugin, 'Content')).filter((f) => CONTAINER_FILES.test(f));
      if (!packaged.some((f) => /\.(uasset|umap)$/i.test(f))) throw new Error(`the cook wrote nothing for ${folders.join(', ')}; log: ${join(logs, 'cook.log')}`);

      const container = `${PLUGIN}-${tag}`;
      const pak = join(outDir, `${container}.pak`);
      // UAT writes the project's crypto settings next to the cooked metadata while staging; a DLC uses the
      // same settings as the base game, so take the copy the base staging wrote.
      const crypto = join(cookedPlugin, 'Metadata', 'Crypto.json');
      copyFileSync(join(runtimeDir(), 'Saved', 'Cooked', 'Windows', 'VibeGameEngine', 'Metadata', 'Crypto.json'), crypto);
      // Loose cook: the package store manifest stands in for the Zen project store, as in UAT's non-Zen staging.
      const manifestFile = join(cookedPlugin, 'Metadata', 'packagestore.manifest');
      // The .pak carries only a note of what the container is (as an asset pack's does); the packages go into its
      // IoStore container. A plugin asset registry in every container would be one file at one path in many.
      const note = join(logs, 'container.json');
      writeFileSync(note, JSON.stringify({ build: tag, folders, shaderLibrary: library ? shaderLibrary : '' }, null, 2));
      writeFileSync(join(logs, 'PakList.txt'), `"${note}" "../../../VibeGameEngine/Plugins/${PLUGIN}/${container}.json" -compress`);
      writeFileSync(join(logs, 'PakListIoStore.txt'), packaged.map((f) => `"${f}" "${mountPath(cookedPlugin, f)}"${f.endsWith('.ushaderbytecode') ? '' : ' -compress'}`).join('\n'));
      writeFileSync(join(logs, 'PakCommands.txt'), `"${pak}" -create="${join(logs, 'PakList.txt')}"`);
      writeFileSync(join(logs, 'IoStoreCommands.txt'), `-Output="${join(outDir, `${container}.utoc`)}" -ContainerName=${container} -ResponseFile="${join(logs, 'PakListIoStore.txt')}"`);
      const compression = ['-patchpaddingalign=2048', '-compressionformats=Oodle', '-compresslevel=4', '-compressmethod=Kraken'];
      timings.pak = await run('pak', UNREAL_PAK, [project, `-cryptokeys=${crypto}`, '-unattended', ...compression, '-platform=Windows', `-CreateMultiple=${join(logs, 'PakCommands.txt')}`], join(logs, 'pak.log'));
      timings.iostore = await run('iostore', UNREAL_PAK, [project, project, `-CreateDLCContainer=${join(pluginDir, `${PLUGIN}.uplugin`)}`, `-PackageStoreManifest=${manifestFile}`, `-ScriptObjects=${join(cookedPlugin, 'Metadata', 'scriptobjects.bin')}`, `-CookedDirectory=${cookedRoot}`, `-Commands=${join(logs, 'IoStoreCommands.txt')}`, ...compression, `-cryptokeys=${crypto}`, '-compressionMinBytesSaved=1024', '-compressionMinPercentSaved=5', '-WriteBackMetadataToAssetRegistry=Disabled', '-platform=Windows', `-BasedOnReleaseVersionPath=${resolve(projectDir, 'Releases', release, 'Windows')}`, '-unattended'], join(logs, 'iostore.log'));
      return { timings, container, pak: pak.replaceAll('\\', '/'), shaderLibrary: library ? shaderLibrary : '', cookLog: join(logs, 'cook.log') };
    } catch (err) {
      writing.delete(tag);
      throw err;
    } finally {
      // The cooked files are in the container now; the folder would only fill the disk.
      rmSync(cookedRoot, { recursive: true, force: true });
    }
  }

  // Records a build's container: what the game mounts for the records that name it (manifest), and the folders to
  // cook again if its files go missing (restoreMissing).
  function addContainer(packaged, buildId, folders) {
    state.containers[packaged.container] = { pak: packaged.pak, shaderLibrary: packaged.shaderLibrary, build: buildId, folders };
    writing.delete(packaged.container.slice(PLUGIN.length + 1));
    return packaged.container;
  }

  // A model file decoded and imported into its own content folder; the version it replaces is deleted.
  async function prepareModel(spec, job) {
    const sourcePath = spec.file;
    const settingsTag = spec.key.includes('?') ? `_${createHash('sha1').update(spec.key).digest('hex').slice(0, 6)}` : '';
    const name = `${assetName(sourcePath)}${settingsTag}`;
    const decoded = await decode(sourcePath, join(job.logs, `${name}.glb`));
    // Each version lives in its own content path, so a new version never collides with a mounted one.
    const dest = `/${PLUGIN}/${name}_${job.tag}`;
    const cloth = clothOf(devDir, spec);
    const request = { source: decoded.file, dest, ...(cloth ? { cloth: cloth.description } : {}), ...(spec.mesh ? { mesh: spec.mesh } : {}) };
    return { sourcePath, name, decoded, dest, cloth, request, settings: { mesh: spec.mesh, cloth: spec.cloth } };
  }

  async function recordModel(prepared, imported, key, job) {
    const { sourcePath, name, decoded, dest, cloth, settings } = prepared;
    writeFileSync(join(job.logs, `import-${name}.json`), JSON.stringify(imported, null, 2));
    if (imported.itemError) throw new Error(`${key}: ${imported.itemError}`);
    const clothErrors = (imported.cloth ?? []).flatMap((mesh) => [mesh.error, ...(mesh.sections ?? []).map((section) => section.error)]).filter(Boolean);
    if (clothErrors.length) throw new Error(`cloth of ${key}: ${clothErrors.join('; ')}`);
    const previous = job.assets[key] ?? state.assets[key];
    if (previous) job.retired.push(previous.dest);
    job.assets[key] = { source: sourcePath, sourceMtimeMs: statSync(sourcePath).mtimeMs, clothMtimeMs: cloth?.mtimeMs, dest, objects: imported.objects, build: job.buildId, decoded: decoded.decoded, spec: { kind: 'model', ...settings } };
    return imported.objects;
  }

  async function importModel(spec, job) {
    const prepared = await prepareModel(spec, job);
    return recordModel(prepared, await service.call('import', prepared.request), spec.key, job);
  }

  async function importModelsTogether(specs, job, failed) {
    const prepared = await Promise.all(specs.map((spec) => prepareModel(spec, job).catch((err) => (failed.set(spec.key, err), null))));
    const ready = specs.map((spec, index) => ({ spec, prepared: prepared[index] })).filter((entry) => entry.prepared);
    if (!ready.length) return;
    const imported = await service.call('import-many', { items: ready.map((entry) => entry.prepared.request) });
    for (const [index, { spec, prepared: entry }] of ready.entries()) {
      try {
        await recordModel(entry, imported.items[index], spec.key, job);
      } catch (err) {
        failed.set(spec.key, err);
      }
    }
  }

  async function importSound(spec, job) {
    const { buildId, tag, logs } = job;
    const name = assetName(spec.file);
    const prepared = await prepareSound(spec.file, join(logs, `${name}.wav`), { optimize: spec.optimize });
    const previous = job.assets[spec.key] ?? state.assets[spec.key];
    const dest = `/${PLUGIN}/${name}_${tag}`;
    const imported = await service.call('import-sound', { source: prepared.file, dest });
    writeFileSync(join(logs, `import-${name}.json`), JSON.stringify({ prepared, imported }, null, 2));
    if (previous) job.retired.push(previous.dest);
    job.assets[spec.key] = { source: spec.file, sourceMtimeMs: statSync(spec.file).mtimeMs, dest, objects: imported.objects, build: buildId, spec: { kind: 'sound', optimize: spec.optimize } };
  }

  // What an import asks for (content/characters.mjs contentSpec): a model file, animation clips on a model's skeleton
  // (optionally retargeted onto another character), or a character's clips retargeted onto a model. The models it
  // needs are imported first in the same build when they have no build yet. `spec.key` is the identity the game
  // code's import carries.
  // Imports one spec into a build's job. A model it is built on and that has no build yet is imported earlier in the
  // same job when the same batch carries it (`batchKeys`), and otherwise built first by its own build into its own
  // container; the clips of one character asked for together wait for that one build instead of each importing it.
  async function importForBuild(spec, job, batchKeys = new Set()) {
    for (const model of modelsOf(spec)) {
      if (state.assets[model] || job.assets[model]) continue;
      if (batchKeys.has(model)) throw new Error(`${spec.key} needs ${model}, whose import failed`);
      if (!running.has(model)) schedule(model, () => build(specOfModelKey(devDir, model)), (err) => err && log(`[content] ${model}: ${err.message}`));
      await running.get(model);
      if (!state.assets[model]) throw new Error(`${spec.key} needs ${model}, whose build failed`);
    }
    if (spec.kind === 'sound') {
      await importSound(spec, job);
    } else if (spec.kind === 'model') {
      await importModel(spec, job);
      // Clips and retargets built on the model reference its skeleton, deleted with its previous version: they are
      // built again in this build, before the cook, which would otherwise load them without their skeleton.
      for (const dependent of dependentsOf(spec.key)) if (!batchKeys.has(dependent.key)) await importVariant(dependent, job);
    } else {
      await importVariant(spec, job);
    }
  }

  async function packageJob(job, timings) {
    const folders = Object.values(job.assets).map((asset) => `${asset.dest}/`);
    const packaged = await cookAndPackage({ ...job, folders });
    Object.assign(timings, packaged.timings);
    const container = addContainer(packaged, job.buildId, folders);
    for (const [key, asset] of Object.entries(job.assets)) state.assets[key] = { ...asset, container };
    saveState();
    deleteRetired(job.retired);
    return packaged.container;
  }

  function deleteRetired(paths) {
    if (!paths.length) return;
    const t0 = Date.now();
    service
      .call('delete', { paths })
      .then(() => log(`[content] deleted ${paths.length} replaced version(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`))
      .catch((err) => console.error(`[content] deleting replaced versions: ${err.message}`));
  }

  async function build(spec) {
    // What this build imports is published, with its container, only once the container is written.
    const job = { ...newBuild(), assets: {}, retired: [] };
    const timings = {};
    const t0 = Date.now();
    await importForBuild(spec, job);
    timings.import = (Date.now() - t0) / 1000;
    const container = await packageJob(job, timings);
    timings.total = (Date.now() - t0) / 1000;
    log(`[content] ${spec.key} -> ${container} in ${timings.total.toFixed(1)} s ${JSON.stringify(timings)}`);
    return { key: spec.key, timings, manifest: manifest() };
  }

  async function buildBatch(entries) {
    const stale = entries.filter(({ spec }) => isStale(spec));
    const unchanged = entries.filter((entry) => !stale.includes(entry));
    for (const { spec, done } of unchanged) for (const onDone of done) onDone(null, { key: spec.key, timings: null, manifest: manifest() });
    if (!stale.length) return;
    const job = { ...newBuild(), assets: {}, retired: [] };
    const timings = {};
    const t0 = Date.now();
    const batchKeys = new Set(stale.map(({ spec }) => spec.key));
    const isModel = (spec) => spec.kind === 'model';
    const models = stale.map(({ spec }) => spec).filter(isModel);
    const failed = new Map();
    await importModelsTogether(models, job, failed);
    for (const spec of models) {
      if (failed.has(spec.key)) continue;
      try {
        for (const dependent of dependentsOf(spec.key)) if (!batchKeys.has(dependent.key)) await importVariant(dependent, job);
      } catch (err) {
        failed.set(spec.key, err);
      }
    }
    const ready = (spec) => spec.kind === 'clips' && modelsOf(spec).every((model) => (state.assets[model] || job.assets[model]) && !failed.has(model));
    const together = stale.map(({ spec }) => spec).filter(ready);
    await importClipsTogether(together, job, failed);
    for (const { spec } of stale.filter((entry) => !isModel(entry.spec) && !together.includes(entry.spec))) {
      try {
        await importForBuild(spec, job, batchKeys);
      } catch (err) {
        failed.set(spec.key, err);
      }
    }
    timings.import = (Date.now() - t0) / 1000;
    let packagingError = null;
    let container = null;
    if (Object.keys(job.assets).length) {
      try {
        container = await packageJob(job, timings);
      } catch (err) {
        packagingError = err;
      }
    } else {
      writing.delete(job.tag);
    }
    timings.total = (Date.now() - t0) / 1000;
    if (container) log(`[content] ${stale.length} import(s) -> ${container} in ${timings.total.toFixed(1)} s ${JSON.stringify(timings)}`);
    for (const { spec, done } of stale) {
      const err = failed.get(spec.key) ?? packagingError;
      for (const onDone of done) onDone(err, err ? undefined : { key: spec.key, timings, manifest: manifest() });
    }
  }

  // A clips or retargetFrom import into its own content folder; the version it replaces is deleted after packaging.
  async function importVariant(spec, job) {
    const assetOf = (key) => job.assets[key] ?? state.assets[key];
    const dest = variantDest(spec, job);
    const objects = await importSpec(service, spec, dest, { modelObjects: (key) => assetOf(key)?.objects });
    recordVariant(spec, dest, objects, job);
  }

  function variantDest(spec, job) {
    return `/${PLUGIN}/${assetName(spec.file)}${variantName(spec)}_${job.tag}`;
  }

  function recordVariant(spec, dest, objects, job) {
    const assetOf = (key) => job.assets[key] ?? state.assets[key];
    const previous = assetOf(spec.key);
    writeFileSync(join(job.logs, `${assetName(spec.file)}${variantName(spec)}.json`), JSON.stringify({ spec, objects }, null, 2));
    if (previous) job.retired.push(previous.dest);
    const models = Object.fromEntries(modelsOf(spec).map((model) => [model, assetOf(model).build]));
    job.assets[spec.key] = { source: spec.file, sourceMtimeMs: statSync(spec.file).mtimeMs, dest, objects, build: job.buildId, spec: { ...spec, file: undefined }, models };
  }

  async function importClipsTogether(specs, job, failed) {
    const assetOf = (key) => job.assets[key] ?? state.assets[key];
    const items = specs.flatMap((spec) => {
      const dest = variantDest(spec, job);
      try {
        return [{ spec, dest, ...clipsRequests(spec, dest, { modelObjects: (key) => assetOf(key)?.objects }) }];
      } catch (err) {
        failed.set(spec.key, err);
        return [];
      }
    });
    if (!items.length) return;
    const imported = (await service.call('many', { requests: items.map((item) => item.importRequest) })).results;
    const retargets = items.map((item, index) => (item.retarget && !imported[index].error ? item.retarget(imported[index].objects ?? []) : null));
    const pending = retargets.filter(Boolean);
    const retargeted = pending.length ? (await service.call('many', { requests: pending })).results : [];
    let next = 0;
    items.forEach((item, index) => {
      const result = retargets[index] ? retargeted[next++] : imported[index];
      const error = imported[index].error ?? result.error;
      if (error) failed.set(item.spec.key, new Error(`${item.spec.key}: ${error}`));
      else recordVariant(item.spec, item.dest, result.objects, job);
    });
  }

  // The content-folder name part that tells variants of one file apart: IdleOnManny, DefaultHumanoidFromManny.
  function variantName(spec) {
    const pascal = (text) => text.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
    if (spec.kind === 'clips') return spec.retarget ? `On${pascal(spec.retarget.character ?? spec.retarget.model)}` : 'Clips';
    if (spec.kind === 'retargetFrom') return `From${pascal(spec.from.character ?? spec.from.model)}`;
    return '';
  }

  // The imports built on a model, rebuilt after the model is: clips on its skeleton, retargets to or from it.
  function dependentsOf(modelKey) {
    return Object.entries(state.assets)
      .filter(([, asset]) => asset.models && modelKey in asset.models)
      .map(([key, asset]) => ({ kind: 'model', ...asset.spec, key, file: asset.source }));
  }

  // The materials of one material module (`*.material.tsx`, content/materials.mjs): `exports` are its exports as
  // described there, each with the content service request of its asset. An asset's path carries the hash of its
  // description, so a description built before is not built again (an edit undone needs no cook), and assets no
  // export uses any more are deleted. Returns the build's timings, or null when nothing had to be built or removed.
  const materialsInBuild = new Set();
  async function buildMaterials(key, exports) {
    const taking = new Set();
    try {
      return await buildMaterialsTaking(key, exports, taking);
    } finally {
      for (const path of taking) materialsInBuild.delete(path);
    }
  }

  async function buildMaterialsTaking(key, exports, taking) {
    const t0 = Date.now();
    state.materialAssets ??= {};
    const timings = {};
    const assets = new Map();
    for (const entry of exports) {
      if (entry.base) assets.set(entry.base.path, entry.base);
      assets.set(entry.path, entry);
    }
    const missing = [...assets.values()].filter((asset) => !state.materialAssets[asset.path] || state.materialAssets[asset.path].failed || !existsSync(join(contentDir, asset.folder.slice(PLUGIN.length + 2))));
    const job = missing.length ? newBuild() : null;
    const built = [];
    let t = Date.now();
    for (const asset of missing) {
      const result = await service.call(asset.kind === 'instance' ? 'material-instance' : 'material', asset.request);
      // Taken while the build runs, so another build needing the same asset does not make it again; it is published
      // with this build's container.
      state.materialAssets[asset.path] = { folder: asset.folder, kind: asset.kind };
      taking.add(asset.path);
      materialsInBuild.add(asset.path);
      built.push({ path: asset.path, kind: asset.kind, seconds: result.seconds });
    }
    timings.create = (Date.now() - t) / 1000;
    if (job) writeFileSync(join(job.logs, 'materials.json'), JSON.stringify({ key, built, requests: missing.map((a) => a.request) }, null, 2));

    const previous = Object.fromEntries(Object.entries(state.materials ?? {}).filter(([name]) => name.startsWith(`${key}#`)));
    const publish = (build) => {
      for (const name of Object.keys(previous)) delete state.materials[name];
      state.materials = { ...state.materials };
      for (const entry of exports) {
        state.materials[entry.exportKey] = { path: entry.path, class: entry.kind === 'instance' ? 'MaterialInstanceConstant' : 'Material', kind: entry.kind, usage: entry.usage, params: entry.params, parent: entry.base?.path ?? null, build };
      }
    };

    if (!job) {
      publish(state.build);
      saveState();
      log(`[content] ${key}: every material is in the mounted build already`);
      return { key, timings: null, manifest: manifest() };
    }
    const { buildId, tag, logs } = job;
    const folders = missing.map((asset) => `${asset.folder}/`);
    const packaged = await cookAndPackage({ tag, logs, folders });
    Object.assign(timings, packaged.timings);
    const container = addContainer(packaged, buildId, folders);
    for (const asset of missing) state.materialAssets[asset.path].container = container;
    publish(buildId);
    saveState();
    timings.total = (Date.now() - t0) / 1000;
    const errors = materialErrors(packaged.cookLog, [...assets.values()].map((a) => a.path.replace(/\.[^./]+$/, '')));
    // A material whose shaders failed would draw as the default material: its exports keep the asset they had, and
    // the failed asset is left for removal, so the game goes on showing the last material that compiled.
    const failed = (asset) => asset && errors.some((line) => line.includes(asset.path.replace(/\.[^./]+$/, '')));
    for (const entry of exports) {
      if (!failed(entry) && !failed(entry.base)) continue;
      if (previous[entry.exportKey]) state.materials[entry.exportKey] = previous[entry.exportKey];
      else delete state.materials[entry.exportKey];
      for (const asset of [entry, entry.base]) if (failed(asset)) state.materialAssets[asset.path].failed = true;
    }
    saveState();
    writeFileSync(join(logs, 'timings.json'), JSON.stringify({ key, built: built.map((b) => b.path), timings, errors }, null, 2));
    log(`[content] ${key} -> ${packaged.container} in ${timings.total.toFixed(1)} s ${JSON.stringify(timings)}${errors.length ? ` with ${errors.length} material error line(s)` : ''}`);
    return { key, timings, errors, manifest: manifest() };
  }

  function describedAssets({ table, assetTable, noun, buildOne }) {
    const inBuild = new Set();

    async function buildTaking(key, describedExports, taking) {
      const exports = describedExports.map(versionOf);
      const t0 = Date.now();
      state[assetTable] ??= {};
      state.materialAssets ??= {};
      const timings = {};
      const inContent = (folder) => existsSync(join(contentDir, folder.slice(PLUGIN.length + 2)));
      const materials = new Map(exports.flatMap((entry) => entry.materials).map((asset) => [asset.path, asset]));
      const missingMaterials = [...materials.values()].filter((asset) => !state.materialAssets[asset.path] || state.materialAssets[asset.path].failed || !inContent(asset.folder));
      const modelsOfEntry = (entry) => modelKeysOf(entry);
      const modelBuildsOf = (entry) => Object.fromEntries(modelsOfEntry(entry).map((model) => [model, state.assets[model]?.build]));
      const modelsMoved = (entry) => modelsOfEntry(entry).some((model) => state[assetTable][entry.path]?.modelBuilds?.[model] !== state.assets[model]?.build);
      const missing = exports.filter((entry) => !state[assetTable][entry.path] || !inContent(entry.folder) || modelsMoved(entry));
      const job = missing.length || missingMaterials.length ? newBuild() : null;
      for (const asset of materials.values()) {
        taking.materials.add(asset.path);
        materialsInBuild.add(asset.path);
      }
      for (const entry of exports) {
        taking.assets.add(entry.path);
        inBuild.add(entry.path);
      }
      for (const asset of missingMaterials) {
        await service.call(asset.kind === 'instance' ? 'material-instance' : 'material', asset.request);
        state.materialAssets[asset.path] = { folder: asset.folder, kind: asset.kind };
      }
      const built = [];
      for (const entry of missing) {
        const result = await buildOne(service, entry, { objectsOf: (key) => state.assets[specOfModelKey(devDir, key).key]?.objects });
        const clips = result?.clips?.map(({ path, length, rootSpeed }) => ({ path, length, rootSpeed }));
        state[assetTable][entry.path] = { folder: entry.folder, modelBuilds: modelBuildsOf(entry), ...(clips ? { clips } : {}) };
        built.push(result);
      }
      timings.create = (Date.now() - t0) / 1000;
      if (job) writeFileSync(join(job.logs, `${table}.json`), JSON.stringify({ key, built, descriptions: missing.map((e) => e.description) }, null, 2));

      const publish = (build) => {
        state[table] = Object.fromEntries(Object.entries(state[table] ?? {}).filter(([name]) => !name.startsWith(`${key}#`)));
        for (const entry of exports) {
          const models = modelKeysOf(entry);
          const modelBuilds = Object.fromEntries(models.map((model) => [model, state.assets[model]?.build]));
          const clips = state[assetTable][entry.path]?.clips;
          state[table][entry.exportKey] = { path: entry.path, user: entry.user, materials: entry.materials.map((m) => m.path), models, modelBuilds, build, ...(clips ? { clips } : {}) };
        }
      };

      if (!job) {
        publish(state.build);
        saveState();
        log(`[content] ${key}: every ${noun} is in the mounted build already`);
        return { key, timings: null, manifest: manifest() };
      }
      const { buildId, tag, logs } = job;
      const folders = [...missingMaterials.map((asset) => `${asset.folder}/`), ...missing.map((entry) => `${entry.folder}/`)];
      const packaged = await cookAndPackage({ tag, logs, folders });
      Object.assign(timings, packaged.timings);
      const container = addContainer(packaged, buildId, folders);
      for (const asset of missingMaterials) state.materialAssets[asset.path].container = container;
      for (const entry of missing) state[assetTable][entry.path].container = container;
      publish(buildId);
      saveState();
      timings.total = (Date.now() - t0) / 1000;
      const errors = materialErrors(packaged.cookLog, [...exports.map((e) => e.path.replace(/\.[^./]+$/, '')), ...[...materials.keys()].map((p) => p.replace(/\.[^./]+$/, ''))]);
      writeFileSync(join(logs, 'timings.json'), JSON.stringify({ key, built: missing.map((e) => e.path), timings, errors }, null, 2));
      log(`[content] ${key} -> ${packaged.container} in ${timings.total.toFixed(1)} s ${JSON.stringify(timings)}${errors.length ? ` with ${errors.length} error line(s)` : ''}`);
      return { key, timings, errors, manifest: manifest() };
    }

    async function build(key, exports) {
      const taking = { materials: new Set(), assets: new Set() };
      try {
        return await buildTaking(key, exports, taking);
      } finally {
        for (const path of taking.materials) materialsInBuild.delete(path);
        for (const path of taking.assets) inBuild.delete(path);
      }
    }

    async function collect() {
      const used = new Set(Object.values(state[table] ?? {}).map((n) => n.path));
      for (const [path, asset] of Object.entries(state[assetTable] ?? {})) {
        if (used.has(path) || inBuild.has(path)) continue;
        await service.call('delete', { path: asset.folder });
        delete state[assetTable][path];
        saveState();
      }
    }

    const latest = new Map();
    const enqueue = (key, exports, onDone) => {
      latest.set(key, exports);
      schedule(`${table}:${key}`, () => build(key, latest.get(key)), (err, result) => {
        onDone(err, result);
        schedule(`${table}:collect`, async () => {
          await collect();
          await collectMaterials();
        }, (gcErr) => gcErr && log(`[content] removing unused ${noun}s failed: ${gcErr.message}`));
      });
    };
    const currentState = () => ({ [table]: state[table] ?? {}, assets: state[assetTable] ?? {}, materialAssets: state.materialAssets ?? {}, models: state.assets ?? {} });

    return { table, assetTable, collect, enqueue, currentState };
  }

  const niagara = describedAssets({ table: 'niagara', assetTable: 'niagaraAssets', noun: 'system', buildOne: buildNiagaraSystem });
  const terrain = describedAssets({ table: 'terrain', assetTable: 'terrainAssets', noun: 'terrain', buildOne: buildTerrainLevel });
  const motion = describedAssets({ table: 'motion', assetTable: 'motionAssets', noun: 'motion matching graph', buildOne: buildMotionMatching });
  const compute = describedAssets({ table: 'compute', assetTable: 'computeAssets', noun: 'compute graph', buildOne: buildComputeGraph });
  const pcg = describedAssets({ table: 'pcg', assetTable: 'pcgAssets', noun: 'PCG graph', buildOne: buildPcgGraph });
  const fracture = describedAssets({ table: 'fracture', assetTable: 'fractureAssets', noun: 'geometry collection', buildOne: buildFracture });
  const vehicle = describedAssets({ table: 'vehicle', assetTable: 'vehicleAssets', noun: 'vehicle', buildOne: buildVehicle });
  const groom = describedAssets({ table: 'groom', assetTable: 'groomAssets', noun: 'groom binding', buildOne: buildGroomBinding });
  const described = [niagara, terrain, motion, compute, pcg, fracture, vehicle, groom];
  const collectDescribed = async () => {
    for (const kind of described) await kind.collect();
  };

  // Material assets nothing refers to any more (neither an export, the parent of an exported instance, nor a material a
  // Niagara system uses) are deleted after the build that replaced them has gone to the games, off the path of the
  // edit; the next cook leaves them out.
  async function collectMaterials() {
    const used = new Set([
      ...Object.values(state.materials ?? {}).flatMap((m) => [m.path, m.parent].filter(Boolean)),
      ...described.flatMap((kind) => Object.values(state[kind.table] ?? {}).flatMap((n) => n.materials ?? [])),
    ]);
    for (const [path, asset] of Object.entries(state.materialAssets ?? {})) {
      if (used.has(path) || materialsInBuild.has(path)) continue;
      await service.call('delete', { path: asset.folder });
      delete state.materialAssets[path];
      saveState();
    }
  }

  // What the cook said about these materials' shaders: a material that fails to compile is cooked with the default
  // material in its place (MaterialShared.cpp), so its errors are the answer to "why is it grey".
  function materialErrors(cookLog, packagePaths) {
    // A log line about one of these materials with an error or a warning, and the compiler's own lines after it (they
    // carry no timestamp: "Material.ush:3759:31: error: use of undeclared identifier ...").
    const lines = readFileSync(cookLog, 'utf8').split(/\r?\n/);
    const found = [];
    const filePaths = packagePaths.map((p) => p.replace(new RegExp(`^/${PLUGIN}/`), '').replaceAll('/', '\\'));
    const names = (line) => packagePaths.some((p) => line.includes(p)) || filePaths.some((p) => line.includes(p));
    const kernelCompilerLines = (failedIndex) => {
      const block = [];
      for (let index = failedIndex - 1; index >= 0 && !/Missing cached shader map for kernel/.test(lines[index]); index--) block.unshift(lines[index]);
      return block.filter((line) => line.trim()).map((line) => line.replace(/^\[[^\]]*\]\[[^\]]*\]/, ''));
    };
    lines.forEach((line, index) => {
      if (!/Error|Warning|Failed to compile|compilation failed/.test(line) || !names(line)) return;
      if (/Shader compilation failed/.test(line)) found.push(...kernelCompilerLines(index));
      found.push(line.replace(/^\[[^\]]*\]\[[^\]]*\]/, ''));
      for (let next = index + 1; next < lines.length && next <= index + 12 && !lines[next].startsWith('['); next++) {
        if (lines[next].trim() && !/^Shader debug info dumped/.test(lines[next])) found.push(lines[next]);
      }
    });
    return found;
  }

  // The containers the published records name: every model, clip, material and system the game may load.
  function containersInUse() {
    const names = [state.assets, state.materialAssets, ...described.map((kind) => state[kind.assetTable])].flatMap((records) => Object.values(records ?? {}).map((record) => record.container));
    return [...new Set(names.filter((name) => name && state.containers[name]))];
  }

  // What a runtime needs: every container in use, each with its own shader library; per imported file, its objects;
  // per material module and Niagara module export, its asset; and the container of each asset pack.
  function manifest() {
    const packs = state.packs ?? {};
    const containers = containersInUse().map((name) => ({ name, pak: state.containers[name].pak, shaderLibrary: state.containers[name].shaderLibrary, build: state.containers[name].build }));
    if (!containers.length && !Object.keys(packs).length) return null;
    const assets = Object.fromEntries(Object.entries(state.assets).filter(([, a]) => a.container).map(([key, a]) => [key, { build: a.build, objects: a.objects }]));
    // The manifest's build is the newest one published: a build that failed or is still running does not change it.
    const build = containers.length ? Math.max(...containers.map((container) => container.build)) : state.build;
    return { plugin: PLUGIN, build, containers, assets, materials: state.materials ?? {}, niagara: state.niagara ?? {}, terrain: state.terrain ?? {}, motion: state.motion ?? {}, compute: state.compute ?? {}, pcg: state.pcg ?? {}, fracture: state.fracture ?? {}, vehicle: state.vehicle ?? {}, groom: state.groom ?? {}, packs };
  }

  // An asset pack in the project's Content/<name> (added from Fab, vge/content/fab.mjs): its packages keep their
  // /Game/<name>/ paths, which their references to each other use. It is cooked as DLC against the base release like
  // live content, with its folder given to the cook (-COOKDIR, CollectFilesToCook), into a container of its own that
  // holds only the pack's packages, so a model edit never re-cooks gigabytes of pack. The shader library the cook
  // writes under the DLC's name is renamed after the pack: an IoStore library is found by its name
  // (FIoStoreShaderCodeArchive::Create), so each pack's library is its own and MountContent opens it by that name.
  async function buildPack(name) {
    const packDir = resolve(projectDir, 'Content', name);
    if (!existsSync(packDir)) throw new Error(`no asset pack at ${packDir}`);
    const { buildId, tag, logs } = newBuild(`-${name}`);
    const t0 = Date.now();
    const timings = {};

    const cookedRoot = cookedRootOf(tag);
    const cookedPlugin = cookedPluginOf(cookedRoot);
    rmSync(cookedRoot, { recursive: true, force: true });
    // The pack's folder comes from -COOKDIR; `folders` leaves every live package of the plugin out of this cook.
    const cooked = await cooker.cook({ args: [`-OutputDir=${cookedRoot}`, `-COOKDIR="${packDir}"`], scan: [`/Game/${name}/`], folders: [`/Game/${name}/`] });
    copyFileSync(cooked.logFile, join(logs, 'cook.log'));
    timings.cook = cooked.seconds;

    // A DLC cook writes the project's packages under the project's name, beside the plugin's.
    const cookedPack = join(cookedRoot, 'VibeGameEngine', 'Content', name);
    const packaged = listFiles(cookedPack).filter((f) => CONTAINER_FILES.test(f));
    if (!packaged.length) throw new Error(`the cook wrote nothing for /Game/${name}; log: ${join(logs, 'cook.log')}`);
    const shaderLibrary = `VgePack${name.replace(/[^A-Za-z0-9]/g, '')}${tag}`;
    let library = null;
    for (const file of listFiles(join(cookedPlugin, 'Content'))) {
      const base = file.replace(/^.*[\\/]/, '');
      const renamed = base.replace(`-${PLUGIN}-`, `-${shaderLibrary}-`);
      if (renamed === base || !/^(ShaderArchive|ShaderAssetInfo)-/.test(base)) continue;
      renameSync(file, join(cookedPlugin, 'Content', renamed));
      if (renamed.endsWith('.ushaderbytecode')) library = join(cookedPlugin, 'Content', renamed);
    }

    const container = `Pack${name.replace(/[^A-Za-z0-9]/g, '')}-${tag}`;
    const pak = join(outDir, `${container}.pak`);
    const crypto = join(cookedPlugin, 'Metadata', 'Crypto.json');
    copyFileSync(join(runtimeDir(), 'Saved', 'Cooked', 'Windows', 'VibeGameEngine', 'Metadata', 'Crypto.json'), crypto);
    const manifestFile = join(cookedPlugin, 'Metadata', 'packagestore.manifest');
    // The .pak itself carries only a note of what the container is; the packages go into its IoStore container.
    const note = join(logs, 'pack.json');
    writeFileSync(note, JSON.stringify({ pack: name, build: buildId, shaderLibrary: library ? shaderLibrary : '' }, null, 2));
    const projectMount = (file) => `../../../VibeGameEngine/${relative(join(cookedRoot, 'VibeGameEngine'), file).replaceAll('\\', '/')}`;
    const ioStoreFiles = [...packaged.map((f) => `"${f}" "${projectMount(f)}" -compress`)];
    if (library) ioStoreFiles.push(`"${library}" "${mountPath(cookedPlugin, library)}"`);
    writeFileSync(join(logs, 'PakList.txt'), `"${note}" "../../../VibeGameEngine/Plugins/${PLUGIN}/Packs/${name}/pack.json" -compress`);
    writeFileSync(join(logs, 'PakListIoStore.txt'), ioStoreFiles.join('\n'));
    writeFileSync(join(logs, 'PakCommands.txt'), `"${pak}" -create="${join(logs, 'PakList.txt')}"`);
    writeFileSync(join(logs, 'IoStoreCommands.txt'), `-Output="${join(outDir, `${container}.utoc`)}" -ContainerName=${container} -ResponseFile="${join(logs, 'PakListIoStore.txt')}"`);
    const compression = ['-patchpaddingalign=2048', '-compressionformats=Oodle', '-compresslevel=4', '-compressmethod=Kraken'];
    timings.pak = await run('pak', UNREAL_PAK, [project, `-cryptokeys=${crypto}`, '-unattended', ...compression, '-platform=Windows', `-CreateMultiple=${join(logs, 'PakCommands.txt')}`], join(logs, 'pak.log'));
    timings.iostore = await run('iostore', UNREAL_PAK, [project, project, `-CreateDLCContainer=${join(pluginDir, `${PLUGIN}.uplugin`)}`, `-PackageStoreManifest=${manifestFile}`, `-ScriptObjects=${join(cookedPlugin, 'Metadata', 'scriptobjects.bin')}`, `-CookedDirectory=${cookedRoot}`, `-Commands=${join(logs, 'IoStoreCommands.txt')}`, ...compression, `-cryptokeys=${crypto}`, '-compressionMinBytesSaved=1024', '-compressionMinPercentSaved=5', '-WriteBackMetadataToAssetRegistry=Disabled', '-platform=Windows', `-BasedOnReleaseVersionPath=${resolve(projectDir, 'Releases', release, 'Windows')}`, '-unattended'], join(logs, 'iostore.log'));

    state.packs = { ...state.packs, [name]: { name, pak: pak.replaceAll('\\', '/'), shaderLibrary: library ? shaderLibrary : '', build: buildId, packages: packaged.length } };
    saveState();
    rmSync(cookedRoot, { recursive: true, force: true });
    timings.total = (Date.now() - t0) / 1000;
    log(`[content] pack ${name} -> ${container} (${packaged.length} files) in ${timings.total.toFixed(1)} s ${JSON.stringify(timings)}`);
    return { name, timings, manifest: manifest() };
  }

  // A build that replaces an asset leaves the asset's previous container behind, and every build leaves a work folder.
  // Containers no published record names and that no running build is writing, and their records, are removed. A running
  // game keeps the containers it mounted open, and a cooked game opens them without FILE_SHARE_DELETE
  // (WindowsPlatformFile.cpp: only editor builds share delete), so Windows refuses to delete exactly those; they stay
  // until that game exits and go on a later collection. Of the work folders, the last few builds' are kept to read.
  const KEEP_WORK_FOLDERS = 10;
  function collectOldBuilds() {
    const inUse = containersInUse();
    for (const name of Object.keys(state.containers)) if (!inUse.includes(name)) delete state.containers[name];
    const current = new Set([...inUse.map((name) => state.containers[name].pak), ...Object.values(state.packs ?? {}).map((pack) => pack.pak)].filter(Boolean).map((pak) => resolve(pak).replace(/\.pak$/i, '').toLowerCase()));
    const stems = new Set(readdirSync(outDir).filter((name) => /\.(pak|utoc|ucas)$/i.test(name)).map((name) => join(outDir, name.replace(/\.(pak|utoc|ucas)$/i, ''))));
    let removed = 0;
    let held = 0;
    for (const stem of stems) {
      if (current.has(resolve(stem).toLowerCase()) || [...writing].some((tag) => stem.endsWith(`-${tag}`))) continue;
      try {
        for (const ext of ['.ucas', '.utoc', '.pak']) rmSync(`${stem}${ext}`, { force: true });
        removed++;
      } catch (err) {
        if (err.code !== 'EBUSY' && err.code !== 'EPERM') throw err;
        held++;
      }
    }
    // Build folders, and the logs the cooker and the service back up on every start (name-backup-<date>.log).
    const keepNewest = (dir, pattern) => {
      const names = readdirSync(dir).filter((name) => pattern.test(name)).sort();
      for (const name of names.slice(0, Math.max(0, names.length - KEEP_WORK_FOLDERS))) rmSync(join(dir, name), { recursive: true, force: true });
    };
    if (!running.size) keepNewest(workDir, /^b\d+/);
    keepNewest(workDir, /-backup-.*\.log$/);
    keepNewest(join(pluginDir, 'Saved'), /-backup-.*\.log$/);
    if (removed || held) log(`[content] removed ${removed} old container(s)${held ? `, ${held} still mounted by a running game` : ''}`);
  }
  collectOldBuilds();

  // Builds of different files (ids) run at the same time; their cooks share the standby cook processes (COOKERS). One
  // id builds once at a time: a file saved again while it builds is built once more afterwards, from what it is then.
  // Collection runs after every build, and once more a little later: a game unmounts the containers a build replaced
  // only some seconds after it mounts the new ones (shared/engine/content.ts unmountSuperseded), and a mounted
  // container's files cannot be deleted.
  const COLLECT_AGAIN_MS = 10000;
  let collectLater;
  function collectSoon() {
    const collect = () => {
      try {
        collectOldBuilds();
        saveState();
      } catch (err) {
        log(`[content] removing old builds failed: ${err.message}`);
      }
    };
    collect();
    clearTimeout(collectLater);
    collectLater = setTimeout(collect, COLLECT_AGAIN_MS);
  }

  function schedule(id, work, onDone) {
    if (queued.has(id)) return;
    queued.add(id);
    const before = running.get(id) ?? Promise.resolve();
    const next = before.then(async () => {
      queued.delete(id);
      try {
        onDone(null, await work());
      } catch (err) {
        onDone(err);
      }
      collectSoon();
    });
    running.set(id, next);
    next.then(() => running.get(id) === next && running.delete(id));
  }
  // A save gives the watcher more than one event; a batch that finds a file as the last build left it does nothing
  // for it. A file saved again while its batch builds goes into the next batch, built from what it is then.
  const pendingImports = new Map();
  let importBatch = null;
  function startImportBatch() {
    if (importBatch || !pendingImports.size) return;
    const entries = [...pendingImports.values()];
    pendingImports.clear();
    const batch = buildBatch(entries)
      .catch((err) => log(`[content] import batch failed: ${err.message}`))
      .finally(() => {
        for (const { spec } of entries) if (running.get(spec.key) === batch) running.delete(spec.key);
        importBatch = null;
        collectSoon();
        startImportBatch();
      });
    importBatch = batch;
    for (const { spec } of entries) running.set(spec.key, batch);
  }
  function enqueue(spec, onDone) {
    const entry = pendingImports.get(spec.key) ?? { spec, done: [] };
    entry.spec = spec;
    entry.done.push(onDone);
    pendingImports.set(spec.key, entry);
    startImportBatch();
  }
  const enqueuePack = (name, onDone) => schedule(`pack:${name}`, () => buildPack(name), onDone);
  // Builds of content no source file imports any more (content/imports.mjs importedContent) are removed: their
  // records and their content folders, and with them their containers at the next collection. Nothing is removed while
  // some source file cannot be read, since its imports are then unknown.
  async function removeUnused({ models, modules, unreadable }) {
    if (unreadable.length) return { key: 'unused', timings: null, removedAssets: [], removedModules: [], manifest: manifest() };
    let removed = 0;
    const removedAssets = [];
    const removedModules = new Set();
    const usedByAssets = new Set(described.flatMap((kind) => Object.values(state[kind.table] ?? {}).flatMap((entry) => entry.models ?? [])));
    for (const [key, asset] of Object.entries(state.assets)) {
      if (models.has(key) || usedByAssets.has(key) || running.has(key)) continue;
      await service.call('delete', { path: asset.dest });
      delete state.assets[key];
      removedAssets.push(key);
      removed++;
    }
    const moduleOf = (exportKey) => exportKey.slice(0, exportKey.indexOf('#'));
    const tables = ['materials', ...described.map((kind) => kind.table)];
    for (const name of tables) {
      for (const exportKey of Object.keys(state[name] ?? {})) {
        if (modules.has(moduleOf(exportKey)) || tables.some((t) => running.has(`${t}:${moduleOf(exportKey)}`))) continue;
        delete state[name][exportKey];
        removedModules.add(moduleOf(exportKey));
        removed++;
      }
    }
    await collectDescribed();
    await collectMaterials();
    saveState();
    if (removed) log(`[content] removed ${removed} build(s) of content no code imports any more`);
    return { key: 'unused', timings: null, removedAssets, removedModules: [...removedModules], manifest: manifest() };
  }
  const removeUnusedContent = (content, onDone) => schedule('unused', () => removeUnused(content), onDone);

  // A container in use whose files are not on disk (deleted by hand or by another checkout's collection) is cooked
  // again from its folders into a new container, so a game gets what the state says it has.
  const restoreMissing = (onDone) => {
    for (const [name, pack] of Object.entries(state.packs ?? {})) if (!existsSync(pack.pak)) enqueuePack(name, onDone);
    for (const name of containersInUse()) {
      const lost = state.containers[name];
      if (existsSync(lost.pak)) continue;
      schedule(`restore:${name}`, async () => {
        const { buildId, tag, logs } = newBuild();
        const packaged = await cookAndPackage({ tag, logs, folders: lost.folders });
        const container = addContainer(packaged, buildId, lost.folders);
        for (const records of [state.assets, state.materialAssets, ...described.map((kind) => state[kind.assetTable])]) {
          for (const record of Object.values(records ?? {})) if (record.container === name) record.container = container;
        }
        saveState();
        log(`[content] container ${name} was missing: cooked again as ${container}`);
        return { key: name, manifest: manifest() };
      }, onDone);
    }
  };

  // A material module saved again while its build waits is built once, from its newest description.
  const latestMaterials = new Map();
  const enqueueMaterials = (key, exports, onDone) => {
    latestMaterials.set(key, exports);
    schedule(`materials:${key}`, () => buildMaterials(key, latestMaterials.get(key)), (err, result) => {
      onDone(err, result);
      schedule('materials:collect', collectMaterials, (gcErr) => gcErr && log(`[content] removing unused materials failed: ${gcErr.message}`));
    });
  };

  // True when the import has no build yet, its file changed since, or a model it is built on was built again.
  const isStale = (spec) => {
    const asset = state.assets[spec.key];
    if (asset?.sourceMtimeMs !== statSync(spec.file).mtimeMs) return true;
    if ((spec.kind ?? 'model') === 'model' && asset.clothMtimeMs !== clothOf(devDir, spec)?.mtimeMs) return true;    return Object.entries(asset.models ?? {}).some(([model, build]) => state.assets[model]?.build !== build);
  };
  // Every import of a file, for a save of it: the file itself and its variants (clips, retargets).
  const specsOf = (file) =>
    Object.entries(state.assets)
      .filter(([, asset]) => resolve(asset.source) === resolve(file))
      .map(([key, asset]) => ({ kind: 'model', ...asset.spec, key, file: asset.source }));

  return {
    enqueue,
    enqueuePack,
    enqueueMaterials,
    enqueueNiagara: niagara.enqueue,
    enqueueTerrain: terrain.enqueue,
    enqueueMotion: motion.enqueue,
    enqueueCompute: compute.enqueue,
    enqueuePcg: pcg.enqueue,
    enqueueFracture: fracture.enqueue,
    enqueueVehicle: vehicle.enqueue,
    enqueueGroom: groom.enqueue,
    // The material assets each export of a material module has now (content/materials.mjs: is a build needed).
    materialState: () => ({ materials: state.materials ?? {}, assets: state.materialAssets ?? {} }),
    // The same for the systems of Niagara modules and the levels of terrain modules.
    niagaraState: niagara.currentState,
    terrainState: terrain.currentState,
    motionState: motion.currentState,
    versionOf,
    computeState: compute.currentState,
    pcgState: pcg.currentState,
    fractureState: fracture.currentState,
    vehicleState: vehicle.currentState,
    groomState: groom.currentState,
    isStale,
    specsOf,
    manifest,
    // The resident content service, for other work that runs in it (vge/content/fab.mjs).
    service,
    startService: () => {
      service.start();
      cooker.ensure();
    },
    restoreMissing,
    removeUnusedContent,
    stopService: () => {
      service.stop();
      cooker.stop();
    },
  };
}
