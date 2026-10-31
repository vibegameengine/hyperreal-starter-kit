import { contentModule } from './contentKind.mjs';

export const TERRAIN_MODULE = contentModule('terrain');
const DESCRIBE = '/src/shared/terrain/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createTerrainModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports, names, materialRoot) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key), materialRoot(key), names);
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, TERRAIN_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function terrainHandleModule(exports, paths = {}) {
  const lines = [`import { terrainAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'terrain', key: entry.exportKey, size: entry.size, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `terrainAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildTerrainLevel(service, entry, { objectsOf }) {
  const grass = (entry.request.grass ?? []).map(({ model, ...rest }) => {
    const mesh = (objectsOf(model) ?? []).find((object) => object.class === 'StaticMesh');
    if (!mesh) throw new Error(`${entry.exportKey}: grass model ${model} has no built static mesh; import it from the game code`);
    return { ...rest, mesh: mesh.path };
  });
  const result = await service.call('terrain', { path: entry.path.replace(/\.[^./]+$/, ''), ...entry.request, grass });
  if (result.error) throw new Error(`${entry.exportKey}: ${result.error}`);
  return { path: entry.path, vertices: result.vertices, components: result.components };
}
