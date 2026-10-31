export const PCG_MODULE = /\.pcg\.[jt]sx?$/;
const DESCRIBE = '/src/shared/pcg/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createPcgModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports, names, materialRoot) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key), materialRoot(key), names);
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, PCG_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function pcgHandleModule(exports, paths = {}) {
  const lines = [`import { pcgAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'pcg', key: entry.exportKey, params: entry.params, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `pcgAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

const TOOLS = 'PCGToolset.PCGToolset.';
const GET_PARAM = 'Get Graph Parameter';
const PARAM_TYPES = { float: 'Float', int: 'Integer32', bool: 'Boolean' };
const COLUMN = 300;

const ref = (refPath) => ({ refPath });

export async function buildPcgGraph(service, entry, { objectsOf }) {
  const call = async (tool, input) => (await service.call('niagara-tools', { calls: [{ tool: TOOLS + tool, input }] })).results[0]?.returnValue;
  const fail = (message) => {
    throw new Error(`${entry.exportKey}: ${message}`);
  };
  const { params, nodes, edges } = entry.request;
  const meshOf = (model) => (objectsOf(model) ?? []).find((object) => object.class === 'StaticMesh')?.path ?? fail(`${model} has no built static mesh; import it from the game code`);
  const modelInstance = async (name, model, { parent, textures }) => {
    const found = new Map((objectsOf(model) ?? []).filter((object) => object.class === 'Texture2D').map((object) => [object.path.slice(object.path.lastIndexOf('.') + 1).replace(/^T_/, ''), object.path]));
    const texture = Object.fromEntries(textures.filter((param) => found.has(param)).map((param) => [param, found.get(param)]));
    if (textures.length && !Object.keys(texture).length) fail(`${model} has no texture named like ${parent}'s parameters ${textures.join(', ')} (its textures: ${[...found.keys()].join(', ') || 'none'})`);
    const path = `${entry.folder}/Materials/${name}`;
    const built = await service.call('material-instance', { path, parent, scalar: {}, vector: {}, texture });
    if (built.error) fail(`${name}: ${built.error}`);
    return `${path}.${name}`;
  };

  await service.call('delete', { path: entry.folder });
  const graph = ref((await call('CreateGraph', { name: entry.name, path: entry.folder })).refPath);
  if (params.length) {
    await call('SetGraphParams', {
      graph,
      params: params.map(({ name, type, value }) => ({ name, type: PARAM_TYPES[type], description: '', containerType: 'None', defaultValueJson: JSON.stringify(value) })),
    });
  }

  const added = new Map();
  const add = async (nodeName, nativeNodeType, values, column, row) => {
    const node = await call('AddNode', { graph, nativeNodeType, nodeName, jsonParams: Object.keys(values).length ? JSON.stringify(values) : '', nodeTitle: '', nodeComment: '', xPositionIdx: column * COLUMN, yPositionIdx: row * COLUMN });
    return ref(node.refPath);
  };
  for (const [row, node] of nodes.entries()) added.set(node.id, await add(node.id, node.type, node.params, 1, row));
  for (const { from, fromPin, to, toPin } of edges) await call('ConnectNodePins', { fromNode: added.get(from), fromPinLabel: fromPin, toNode: added.get(to), toPinLabel: toPin });
  for (const [row, node] of nodes.entries()) {
    for (const link of node.links) {
      const getter = await add(`${node.id}_${link.pin}`, GET_PARAM, { propertyPath: link.param }, 0, row);
      await call('ConnectNodePins', { fromNode: getter, fromPinLabel: 'Out', toNode: added.get(node.id), toPinLabel: link.pin });
    }
  }
  for (const node of nodes.filter((n) => n.meshes.length)) {
    const info = await call('GetNodeInfo', { node: added.get(node.id) });
    const selector = JSON.stringify(info).match(/"meshSelectorParameters":\{"refPath":"([^"]+)"/)?.[1] ?? fail(`${node.id} has no mesh selector; meshes go on a Static Mesh Spawner`);
    const entries = [];
    for (const [index, { model, weight, materials }] of node.meshes.entries()) {
      const overrides = [];
      for (const [slot, material] of materials.entries()) overrides.push(await modelInstance(`${node.id}_${index}_${slot}`, model, material));
      entries.push({ Descriptor: { StaticMesh: meshOf(model), ...(overrides.length ? { OverrideMaterials: overrides } : {}) }, Weight: weight });
    }
    const set = await service.call('set-properties', { path: selector, properties: { MeshEntries: entries } });
    if (set.error) fail(`${node.id}.meshes: ${set.error}`);
  }

  const saved = await service.call('save', { paths: [entry.path] });
  if (saved.error || !saved.saved) fail(`the graph did not save: ${saved.error ?? 'see the service log'}`);
  return { path: entry.path, structure: await call('GetGraphStructure', { graph }) };
}
