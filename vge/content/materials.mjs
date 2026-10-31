// Material modules (modules that call defineMaterial or defineInstance from src/shared/material): evaluated in Node in
// a Vite environment of their own (`materials`, a runnable server environment: the game never runs them), described
// as content service requests by src/shared/material/describe.ts, and turned into the handle module the game imports
// in their place.
import { relative } from 'node:path';
import { contentModule } from './contentKind.mjs';
import { createModuleGraph } from './moduleGraph.mjs';

export const MATERIAL_MODULE = contentModule('material');
const DESCRIBE = '/src/shared/material/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

// `environment()` is the `materials` environment (RunnableDevEnvironment); `folderRoot` the content path assets go
// under (/VgeLive/Materials in the dev server, /Game/Vge/Imported/... in the release build: a function of the key).
export function createMaterialModules({ root, environment, folderRoot }) {
  const keyOf = (file) => relative(root, file).replaceAll('\\', '/');
  const urlOf = (file) => `/${keyOf(file)}`;
  const graph = createModuleGraph(environment);
  // Definitions exported by every material module evaluated so far, by object: their asset names.
  let names = new WeakMap();
  // One evaluation at a time: a re-evaluation clears the runner's cache.
  let chain = Promise.resolve();

  const affectedBy = (file) => graph.affectedBy(file, MATERIAL_MODULE);

  function invalidate(file) {
    graph.invalidate(file);
    names = new WeakMap();
  }

  // Describes the material modules `file` imports (dependencies first), so `names` knows their definitions, then
  // `file` itself with `describeOwn(runner, exports, names, rootFor)`. Niagara modules (content/niagara.mjs) describe
  // through it too, since their renderers use materials.
  function describeWith(file, describeOwn) {
    const run = chain.then(async () => {
      const runner = environment().runner;
      const { describeModule } = await runner.import(DESCRIBE);
      const rootFor = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
      // Evaluated first: the module graph knows what a module imports only once it has been evaluated.
      const exports = await runner.import(urlOf(file));
      for (const dep of graph.dependencies(file, MATERIAL_MODULE)) describeModule(keyOf(dep), await runner.import(urlOf(dep)), rootFor(keyOf(dep)), names);
      return describeOwn(runner, exports, names, rootFor);
    });
    chain = run.catch(() => {});
    return run;
  }

  // The exports of a material module as MaterialExport[] (describe.ts).
  const describe = (file) =>
    describeWith(file, async (runner, exports, known, rootFor) => (await runner.import(DESCRIBE)).describeModule(keyOf(file), exports, rootFor(keyOf(file)), known));

  return { keyOf, describe, describeWith, invalidate, affectedBy, graph };
}

// The module the game imports in place of a material module: a handle per export (shared/engine/content.ts
// materialAsset). `paths` (release build) bakes in each export's cooked object path.
export function handleModule(exports, paths = {}) {
  const lines = [`import { materialAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: entry.kind, key: entry.exportKey, usage: entry.usage, params: entry.params, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `materialAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}
