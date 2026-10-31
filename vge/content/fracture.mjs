import { contentModule } from './contentKind.mjs';

export const FRACTURE_MODULE = contentModule('fracture');
const DESCRIBE = '/src/shared/fracture/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createFractureModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key));
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, FRACTURE_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function fractureHandleModule(exports, paths = {}) {
  const lines = [`import { geometryCollectionAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'geometry-collection', key: entry.exportKey, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `geometryCollectionAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

const TOOLS = 'DataflowAgent.DataflowAgentToolset.';
const LIBRARY = '/Script/DataflowEngine.DataflowBlueprintLibrary';
const COLUMN = 300;

const ref = (refPath) => ({ refPath });

export async function buildFracture(service, entry, { objectsOf }) {
  const run = async (tool, input) => (await service.call('niagara-tools', { calls: [{ tool: TOOLS + tool, input }] })).results[0];
  const fail = (message) => {
    throw new Error(`${entry.exportKey}: ${message}`);
  };
  const call = async (tool, input) => {
    const reply = await run(tool, input);
    if (!reply || reply.error) fail(`${tool}: ${reply?.error ?? 'no reply'}`);
    return reply.returnValue;
  };
  const { nodes, edges, collection } = entry.request;
  const meshOf = (model) => (objectsOf(model) ?? []).find((object) => object.class === 'StaticMesh')?.path ?? fail(`${model} has no built static mesh; import it from the game code`);

  await service.call('delete', { path: entry.folder });
  const asset = await call('CreateDataflowCompatibleAsset', { className: 'GeometryCollection', name: entry.name, path: entry.folder });
  if (asset !== entry.path) fail(`the geometry collection was created at '${asset}', not ${entry.path}`);
  const graph = ref(`${asset}:EmbeddedDataflow`);

  const added = new Map();
  for (const [row, node] of nodes.entries()) {
    const values = node.model ? { ...node.params, StaticMesh: meshOf(node.model) } : node.params;
    const created = await call('AddNode', { graph, typeName: node.type, nodeName: node.id, jsonParams: Object.keys(values).length ? JSON.stringify(values) : '', x: row * COLUMN, y: 0 });
    if (!created?.refPath) fail(`${node.id}: no node type '${node.type}'`);
    added.set(node.id, ref(created.refPath));
  }
  for (const { from, fromPin, to, toPin } of edges) {
    if (!(await call('ConnectNodePins', { fromNode: added.get(from), fromPin, toNode: added.get(to), toPin }))) fail(`${from}:${fromPin} does not connect to ${to}:${toPin}`);
  }

  if (Object.keys(collection).length) {
    const set = await service.call('set-properties', { path: asset, properties: collection });
    if (set.error) fail(`collection: ${set.error}`);
  }
  const regenerated = await service.call('call', { class: LIBRARY, function: 'RegenerateAssetFromDataflow', args: { AssetToRegenerate: asset, bRegenerateDependentAssets: true } });
  if (regenerated.error || !regenerated.result?.returnValue) fail(`the dataflow did not build the collection: ${regenerated.error ?? 'see the service log'}`);

  const saved = await service.call('save', { paths: [asset] });
  if (saved.error || !saved.saved) fail(`the geometry collection did not save: ${saved.error ?? 'see the service log'}`);
  return { path: asset, structure: await call('GetGraphStructure', { graph }) };
}
