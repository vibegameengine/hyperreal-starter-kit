import { hashOf } from '../material/describe';
import type { FractureDefinition } from './index';

export interface FractureNodeRequest {
  id: string;
  type: string;
  params: Record<string, unknown>;
  model?: string;
}

export interface FractureExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  description: Record<string, unknown>;
  materials: never[];
  request: {
    nodes: FractureNodeRequest[];
    edges: { from: string; fromPin: string; to: string; toPin: string }[];
    collection: Record<string, unknown>;
    models: string[];
  };
}

const FORMAT = 1;
const NODE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

const isFracture = (value: unknown): value is FractureDefinition => !!value && typeof value === 'object' && (value as FractureDefinition).kind === 'fracture-definition';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.fracture\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  `GC_${exportName === 'default' ? moduleName(fileKey) : `${moduleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`}`;

function modelKeyOf(fileKey: string, model: string) {
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of model.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function endpoint(text: string, nodes: Record<string, unknown>, where: string) {
  const colon = text.indexOf(':');
  if (colon < 0) throw new Error(`${where}: '${text}' names no pin; an edge end is 'node:Pin'`);
  const node = text.slice(0, colon);
  if (!(node in nodes)) throw new Error(`${where}: '${node}' is not a node (nodes: ${Object.keys(nodes).join(', ')})`);
  return { node, pin: text.slice(colon + 1) };
}

function describeFracture(fileKey: string, definition: FractureDefinition) {
  const { nodes, edges, collection = {} } = definition.description;
  if (!Object.keys(nodes).length) throw new Error('a fracture has at least one node');
  const nodeRequests = Object.entries(nodes).map(([id, node]): FractureNodeRequest => {
    if (!NODE_ID.test(id)) throw new Error(`'${id}' is not a node name (a letter, then letters, digits or _)`);
    return { id, type: node.type, params: { ...(node.params ?? {}) }, ...(node.model ? { model: modelKeyOf(fileKey, node.model) } : {}) };
  });
  const edgeRequests = edges.map(([from, to], index) => {
    const source = endpoint(from, nodes, `edges[${index}]`);
    const target = endpoint(to, nodes, `edges[${index}]`);
    return { from: source.node, fromPin: source.pin, to: target.node, toPin: target.pin };
  });
  const models = [...new Set(nodeRequests.flatMap((node) => (node.model ? [node.model] : [])))];
  return { nodes: nodeRequests, edges: edgeRequests, collection: { ...collection }, models };
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string): FractureExport[] {
  const result: FractureExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isFracture(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    try {
      const request = describeFracture(fileKey, value);
      const name = exportAssetName(fileKey, exportName);
      const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
      result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}`, description: { nodes: request.nodes.length }, request, materials: [] });
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
