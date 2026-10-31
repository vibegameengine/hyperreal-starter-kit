export const GROOM_MODULE = /\.groom\.[jt]sx?$/;
const DESCRIBE = '/src/shared/groom/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createGroomModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key));
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, GROOM_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function groomHandleModule(exports, paths = {}, objects = {}) {
  const lines = [`import { groomAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const source = { key: entry.source, ...(objects[entry.source] ? { objects: objects[entry.source] } : {}) };
    const handle = { kind: 'groom', key: entry.exportKey, source, bindTo: entry.bindTo, groomName: `${entry.name}_Groom`, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `groomAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildGroomBinding(service, entry, { objectsOf }) {
  const fail = (message) => {
    throw new Error(`${entry.exportKey}: ${message}`);
  };
  const groom = (objectsOf(entry.request.source) ?? []).find((object) => object.class === 'GroomAsset')?.path ?? fail(`${entry.request.source} imported no GroomAsset`);
  await service.call('delete', { path: entry.folder });
  const copyName = `${entry.name}_Groom`;
  const copy = `${entry.folder}/${copyName}.${copyName}`;
  const duplicated = await service.call('call', { class: '/Script/EditorScriptingUtilities.EditorAssetLibrary', function: 'DuplicateAsset', args: { SourceAssetPath: groom, DestinationAssetPath: `${entry.folder}/${copyName}` } });
  if (duplicated.error || !duplicated.result?.returnValue) fail(`the groom did not copy: ${duplicated.error ?? 'see the service log'}`);
  const physics = await service.call('set-properties', { path: copy, properties: { HairGroupsPhysics: entry.request.groups.map(() => ({ SolverSettings: { EnableSimulation: entry.request.simulate } })) } });
  if (physics.error) fail(`physics: ${physics.error}`);
  const bound = await service.call('groom-binding', { groom: copy, skeletalMesh: entry.request.bindTo, path: `${entry.folder}/${entry.name}`, interpolationPoints: entry.request.interpolationPoints });
  if (bound.error) fail(bound.error);
  const saved = await service.call('save', { paths: [copy, entry.path] });
  if (saved.error || !saved.saved) fail(`the binding did not save: ${saved.error ?? 'see the service log'}`);
  return { path: entry.path };
}
