// The release game: `npm run build` -> Build/Release/Windows/VibeGameEngine.exe.
// What goes in is what the program imports, as in any Vite build:
//   1. Vite bundles src/release.ts and everything it imports into Content/JavaScript/vge/game.js, and the UI
//      into Content/UI. Each model file the bundle imports (vite/contentAssetsPlugin.mjs) is imported by the
//      content service into /Game/Vge/Imported/<folder>/<Name>, and its objects' paths go into the bundle.
//   2. BuildCookRun stages the shared runtime's Shipping game (which runs game.js, UVgeGameInstance) and cooks the base content
//      plus /Game/Vge/Imported (Config/DefaultGame.ini), so a model nothing imports is not in the game.
//   3. The imported content, the bundle and the UI page are removed again, so a dev package never has them.
// This kit's dev server must be stopped: the build runs a content service of its own on this kit's project content.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import { createBuilder, createServer } from 'vite';
import { importSpec, modelsOf, specOfModelKey } from '../content/characters.mjs';
import { createContentService } from '../content/service.mjs';
import { assetName, createDecoder } from '../content/decode.mjs';
import { createMaterialModules, handleModule } from '../content/materials.mjs';
import { buildNiagaraSystem, createNiagaraModules, NIAGARA_MODULE, niagaraHandleModule } from '../content/niagara.mjs';
import { buildTerrainLevel, createTerrainModules, TERRAIN_MODULE, terrainHandleModule } from '../content/terrain.mjs';
import { buildMotionMatching, createMotionModules, MOTION_MODULE, motionHandleModule } from '../content/motion.mjs';
import { buildComputeGraph, COMPUTE_MODULE, computeHandleModule, createComputeModules } from '../content/compute.mjs';
import { buildPcgGraph, createPcgModules, PCG_MODULE, pcgHandleModule } from '../content/pcg.mjs';
import { buildFracture, createFractureModules, FRACTURE_MODULE, fractureHandleModule } from '../content/fracture.mjs';
import { buildVehicle, createVehicleModules, VEHICLE_MODULE, vehicleHandleModule } from '../content/vehicle.mjs';
import { buildGroomBinding, createGroomModules, GROOM_MODULE, groomHandleModule } from '../content/groom.mjs';
import { contentAssetsPlugin } from '../vite/contentAssetsPlugin.mjs';
import { materialsEnvironment, uiKitClientPlugins, unrealResolve } from '../vite/environments.mjs';
import { materialAssetsPlugin } from '../vite/materialAssetsPlugin.mjs';
import { reactCompilerPlugin } from '../vite/reactCompiler.mjs';
import { prepareSound } from '../content/sound.mjs';
import { clothOf } from '../content/cloth.mjs';
import { meshSettingsOf } from '../content/meshSettings.mjs';
import { engine, project, repoRoot, runtimeDir, unrealRoot } from './engine.mjs';
import { ensureShipping } from './runtime.mjs';
import { refuseWhileOwnDevServerRuns, step } from './steps.mjs';

const TAG = 'build';
const IMPORTED = '/Game/Vge/Imported';
const devDir = repoRoot;
const importedDir = join(unrealRoot, 'Content', 'Vge', 'Imported');
const scriptDir = join(unrealRoot, 'Content', 'JavaScript', 'vge');
const bundle = join(scriptDir, 'game.js');
const uiDir = join(unrealRoot, 'Content', 'UI');
const workDir = join(unrealRoot, 'Saved', 'Release');
const archive = join(unrealRoot, 'Build', 'Release');

function removeReleaseInputs() {
  rmSync(importedDir, { recursive: true, force: true });
  rmSync(bundle, { force: true });
  rmSync(uiDir, { recursive: true, force: true });
}

// Vite takes production from NODE_ENV and sets it once for the process: the material server below (a `serve` config)
// would set it to development first, and the bundle would be a development build (import.meta.env.DEV, so the dev
// labs and their models, React's jsxDEV with this machine's source paths).
process.env.NODE_ENV = 'production';
refuseWhileOwnDevServerRuns('the release build imports into the same project content');
const started = Date.now();
removeReleaseInputs();
// 3. Nothing of the release stays in the project's content, whether the build finishes, a step exits early or it
// is interrupted (Ctrl+C ends a Node process without 'exit' unless SIGINT is handled; process.exit raises it).
// Left behind, they would go into the next dev package: Config/DefaultGame.ini stages Content/UI and cooks
// /Game/Vge/Imported whenever they exist.
process.on('exit', removeReleaseInputs);
process.on('SIGINT', () => process.exit(130));
mkdirSync(workDir, { recursive: true });

// 1. Program, UI and the models the program imports.
const { editorCmd } = engine();
const service = createContentService({ editorCmd, project, logFile: join(workDir, 'content-service.log') });
const decode = createDecoder();
const imported = [];
// src/features/demo/assets/flight-case.glb -> /Game/Vge/Imported/src/features/demo/assets/FlightCase
const destOf = (key) => [IMPORTED, ...dirname(key).split('/').filter((part) => part !== '.').map((part) => part.replace(/[^A-Za-z0-9_]/g, '_')), assetName(key)].join('/');
// Each model file imported once, also when clips or retargets are built on it (content/characters.mjs). Vite resolves
// the imports concurrently, so `importing` holds the import in flight: a second import over the same assets reports
// only the objects it replaced (no Skeleton), and the clips built on it would have no skeleton to go on.
const importing = new Map();
const importedModels = new Map();
function importModel(file, key) {
  if (!importing.has(key)) {
    importing.set(key, (async () => {
      const decoded = await decode(file, join(workDir, key.replace(/\.[^.]+$/, '.glb')));
      const cloth = clothOf(file);
      const meshSettings = meshSettingsOf(file);
      const result = await service.call('import', { source: decoded.file, dest: destOf(key), ...(cloth ? { cloth: cloth.description } : {}), ...(meshSettings ? { mesh: meshSettings.description } : {}) });
      console.log(`[${TAG}] ${key} -> ${destOf(key)} (${result.objects.length} objects)`);
      imported.push(key);
      importedModels.set(key, result.objects);
      return result.objects;
    })());
  }
  return importing.get(key);
}

async function importSound(spec) {
  const target = join(workDir, spec.key.replace(/\?.*$/, '').replace(/\.[^.]+$/, '.wav'));
  mkdirSync(dirname(target), { recursive: true });
  const prepared = await prepareSound(spec.file, target, { optimize: spec.optimize });
  const result = await service.call('import-sound', { source: prepared.file, dest: destOf(spec.key.replace(/\?.*$/, '')) });
  console.log(`[${TAG}] ${spec.key} -> ${destOf(spec.key.replace(/\?.*$/, ''))} (${result.objects.length} objects)`);
  imported.push(spec.key);
  return result.objects;
}

// Material modules the bundle imports (vite/materialAssetsPlugin.mjs) are evaluated in a `materials` environment, as
// in the dev server, and each export is built by the content service under /Game/Vge/Imported/<folder>; the handles
// in the bundle carry the cooked object paths.
const materialServer = await createServer({
  configFile: false,
  root: devDir,
  logLevel: 'warn',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  // It only evaluates material modules: no client page to pre-bundle dependencies for.
  optimizeDeps: { noDiscovery: true },
  environments: { materials: materialsEnvironment },
});
const materialFolderOf = (key) => [IMPORTED, ...dirname(key).split('/').filter((part) => part !== '.').map((part) => part.replace(/[^A-Za-z0-9_]/g, '_'))].join('/');
const materialModules = createMaterialModules({
  root: devDir,
  environment: () => materialServer.environments.materials,
  folderRoot: materialFolderOf,
});
const builtMaterials = new Set();
async function buildMaterialModule(file, key) {
  const exports = await materialModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    for (const asset of [entry.base, entry].filter(Boolean)) {
      if (builtMaterials.has(asset.path)) continue;
      await service.call(asset.kind === 'instance' ? 'material-instance' : 'material', asset.request);
      builtMaterials.add(asset.path);
      console.log(`[${TAG}] ${key} -> ${asset.path}`);
    }
    paths[entry.exportKey] = entry.path;
  }
  imported.push(key);
  return handleModule(exports, paths);
}

// Niagara modules the bundle imports (content/niagara.mjs) are described the same way, and each system is built by the
// content service with the materials its renderers use; the handles carry the cooked paths.
const niagaraModules = createNiagaraModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildNiagaraModule(file, key) {
  const exports = await niagaraModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    for (const asset of entry.materials) {
      if (builtMaterials.has(asset.path)) continue;
      await service.call(asset.kind === 'instance' ? 'material-instance' : 'material', asset.request);
      builtMaterials.add(asset.path);
    }
    await buildNiagaraSystem(service, entry);
    console.log(`[${TAG}] ${key} -> ${entry.path}`);
    paths[entry.exportKey] = entry.path;
  }
  imported.push(key);
  return niagaraHandleModule(exports, paths);
}

const terrainModules = createTerrainModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
const terrainLevels = [];
async function buildTerrainModule(file, key) {
  const exports = await terrainModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    for (const asset of entry.materials) {
      if (builtMaterials.has(asset.path)) continue;
      await service.call(asset.kind === 'instance' ? 'material-instance' : 'material', asset.request);
      builtMaterials.add(asset.path);
    }
    for (const grass of entry.request.grass ?? []) await importModel(join(devDir, grass.model), grass.model);
    await buildTerrainLevel(service, entry, { objectsOf: (model) => importedModels.get(model) });
    console.log(`[${TAG}] ${key} -> ${entry.path}`);
    paths[entry.exportKey] = entry.path;
    terrainLevels.push(entry.path.replace(/\.[^./]+$/, ''));
  }
  imported.push(key);
  return terrainHandleModule(exports, paths);
}

const importedSpecs = new Map();
async function importContent(spec) {
  if (importedSpecs.has(spec.key)) return importedSpecs.get(spec.key);
  for (const model of modelsOf(spec)) await importModel(join(devDir, model), model);
  if (spec.kind === 'sound') return importSound(spec);
  if (spec.kind === 'model') return importModel(spec.file, spec.key);
  const dest = `${destOf(spec.key.replace(/\?.*$/, ''))}_${spec.kind === 'clips' ? (spec.retarget ? `On_${spec.retarget.character ?? assetName(spec.retarget.model)}` : 'Clips') : `From_${spec.from.character ?? assetName(spec.from.model)}`}`;
  const objects = await importSpec(service, spec, dest, { modelObjects: (key) => importedModels.get(key) });
  console.log(`[${TAG}] ${spec.key} -> ${dest} (${objects.length} objects)`);
  imported.push(spec.key);
  importedSpecs.set(spec.key, objects);
  return objects;
}

const motionModules = createMotionModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildMotionModule(file, key) {
  const exports = await motionModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    const clipObjects = new Map();
    for (const model of entry.request.models) clipObjects.set(model, await importContent(specOfModelKey(devDir, model)));
    const built = await buildMotionMatching(service, entry, { objectsOf: (model) => clipObjects.get(model) });
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return motionHandleModule(exports, paths);
}

const computeModules = createComputeModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildComputeModule(file, key) {
  const exports = await computeModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    const built = await buildComputeGraph(service, entry);
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return computeHandleModule(exports, paths);
}

const pcgModules = createPcgModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildPcgModule(file, key) {
  const exports = await pcgModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    for (const model of entry.request.models) await importModel(join(devDir, model), model);
    const built = await buildPcgGraph(service, entry, { objectsOf: (model) => importedModels.get(model) });
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return pcgHandleModule(exports, paths);
}

const fractureModules = createFractureModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildFractureModule(file, key) {
  const exports = await fractureModules.describe(file);
  const paths = {};
  for (const entry of exports) {
    for (const model of entry.request.models) await importModel(join(devDir, model), model);
    const built = await buildFracture(service, entry, { objectsOf: (model) => importedModels.get(model) });
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return fractureHandleModule(exports, paths);
}

const vehicleModules = createVehicleModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildVehicleModule(file, key) {
  const exports = await vehicleModules.describe(file);
  const paths = {};
  const objects = {};
  for (const entry of exports) {
    for (const model of entry.request.models) {
      await importModel(join(devDir, model), model);
      objects[model] = importedModels.get(model);
    }
    const built = await buildVehicle(service, entry);
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return vehicleHandleModule(exports, paths, objects);
}

const groomModules = createGroomModules({ materials: materialModules, folderRoot: (key) => materialFolderOf(key) });
async function buildGroomModule(file, key) {
  const exports = await groomModules.describe(file);
  const paths = {};
  const objects = {};
  for (const entry of exports) {
    for (const model of entry.request.models) {
      await importModel(join(devDir, model), model);
      objects[model] = importedModels.get(model);
    }
    const built = await buildGroomBinding(service, entry, { objectsOf: (model) => importedModels.get(model) });
    console.log(`[${TAG}] ${key} -> ${built.path}`);
    paths[entry.exportKey] = built.path;
  }
  imported.push(key);
  return groomHandleModule(exports, paths, objects);
}

const builder = await createBuilder({
  configFile: false,
  root: devDir,
  base: './',
  logLevel: 'info',
  plugins: [
    react(),
    reactCompilerPlugin(),
    uiKitClientPlugins(),
    contentAssetsPlugin({
      root: devDir,
      onImport: importContent,
    }),
    materialAssetsPlugin({ root: devDir, onImport: buildMaterialModule }),
    materialAssetsPlugin({ root: devDir, onImport: buildNiagaraModule, pattern: NIAGARA_MODULE, name: 'vge:niagara-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildTerrainModule, pattern: TERRAIN_MODULE, name: 'vge:terrain-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildMotionModule, pattern: MOTION_MODULE, name: 'vge:motion-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildComputeModule, pattern: COMPUTE_MODULE, name: 'vge:compute-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildPcgModule, pattern: PCG_MODULE, name: 'vge:pcg-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildFractureModule, pattern: FRACTURE_MODULE, name: 'vge:fracture-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildVehicleModule, pattern: VEHICLE_MODULE, name: 'vge:vehicle-assets' }),
    materialAssetsPlugin({ root: devDir, onImport: buildGroomModule, pattern: GROOM_MODULE, name: 'vge:groom-assets' }),
  ],
  environments: {
    unreal: {
      consumer: 'server',
      resolve: unrealResolve,
      // Bare V8 inside the engine has no `process`.
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      build: {
        outDir: scriptDir,
        emptyOutDir: false,
        minify: true,
        rolldownOptions: {
          input: join(devDir, 'src', 'release.ts'),
          // Platform "neutral" for the reason the dev server's dependency optimizer uses it (vite/environments.mjs).
          platform: 'neutral',
          // Puerts loads one CommonJS file and gives it `require` for its native modules.
          output: { format: 'cjs', entryFileNames: 'game.js', inlineDynamicImports: true },
        },
      },
    },
    client: {
      build: {
        outDir: uiDir,
        emptyOutDir: true,
        // The world HUD only: the shell (src/ui/index.html) is a dev surface.
        rolldownOptions: { input: join(devDir, 'src', 'ui', 'hud.html') },
      },
    },
  },
  builder: {},
});
try {
  await builder.buildApp();
} finally {
  // The service holds the editor target's DLLs, which BuildCookRun rebuilds if they are out of date.
  await service.stop();
  await materialServer.close();
}
if (!existsSync(bundle)) {
  console.error(`[${TAG}] the bundle ${bundle} was not written`);
  process.exit(1);
}
console.log(`[${TAG}] program bundled with ${imported.length} imported model file(s): ${imported.join(', ') || 'none'}`);

// 2. The Shipping game with the cooked base content and the imported models. The staging folder is made afresh, the
// archive is copied over whatever is there: without this a release keeps the UI files of every earlier one.
rmSync(archive, { recursive: true, force: true });
// The runtime is built without a Shipping game (tools/runtime.mjs): the first release of a runtime adds it.
await ensureShipping(TAG, runtimeDir());
step(TAG, 'shipping game', engine().runUat, [
  'BuildCookRun',
  `-project="${project}"`,
  '-noP4',
  '-platform=Win64',
  '-clientconfig=Shipping',
  '-cook',
  '-stage',
  '-pak',
  '-iostore',
  '-nodebuginfo',
  '-archive',
  `-archivedirectory="${archive}"`,
  ...(terrainLevels.length ? [`-MapsToCook=${terrainLevels.join('+')}`] : []),
  '-unattended',
]);
console.log(`[${TAG}] ${join(archive, 'Windows', 'VibeGameEngine.exe')} in ${((Date.now() - started) / 60000).toFixed(1)} min`);
