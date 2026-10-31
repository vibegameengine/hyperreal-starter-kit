export const COMPUTE_MODULE = /\.compute\.[jt]sx?$/;
const DESCRIBE = '/src/shared/compute/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createComputeModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key));
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, COMPUTE_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function computeHandleModule(exports, paths = {}) {
  const lines = [`import { computeAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'compute', key: entry.exportKey, textures: entry.textures, params: entry.params, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `computeAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildComputeGraph(service, entry) {
  const result = await service.call('compute', { path: entry.path.replace(/\.[^./]+$/, ''), ...entry.request });
  if (result.error) throw new Error(`${entry.exportKey}: ${result.error}`);
  return { path: result.path };
}
