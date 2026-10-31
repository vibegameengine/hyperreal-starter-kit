import { describeInstance, describeMaterial, hashOf, type MaterialAsset } from '../material/describe';
import type { PcgGraphDefinition, PcgParamLink, PcgParamType } from './index';

export interface PcgMeshMaterial {
  parent: string;
  textures: string[];
}

export interface PcgNodeRequest {
  id: string;
  type: string;
  params: Record<string, unknown>;
  links: { param: string; pin: string }[];
  meshes: { model: string; weight: number; materials: PcgMeshMaterial[] }[];
}

export interface PcgExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  params: Record<string, PcgParamType>;
  description: Record<string, unknown>;
  request: {
    params: { name: string; type: PcgParamType; value: number | boolean }[];
    nodes: PcgNodeRequest[];
    edges: { from: string; fromPin: string; to: string; toPin: string }[];
    models: string[];
  };
  materials: MaterialAsset[];
}

const FORMAT = 1;
const NODE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

const isGraph = (value: unknown): value is PcgGraphDefinition => !!value && typeof value === 'object' && (value as PcgGraphDefinition).kind === 'pcg-definition';
const isLink = (value: unknown): value is PcgParamLink => !!value && typeof value === 'object' && (value as PcgParamLink).kind === 'pcg-param';
const isMaterial = (value: unknown) => (value as any)?.kind === 'material-definition';
const isInstance = (value: unknown) => (value as any)?.kind === 'instance-definition';

interface MaterialContext {
  materialRoot: string;
  names: WeakMap<object, string>;
  materials: MaterialAsset[];
}

function meshMaterial(material: unknown, { materialRoot, names, materials }: MaterialContext): PcgMeshMaterial {
  const name = names.get(material as object);
  if (!name) throw new Error("a mesh material is a material module's export");
  let asset: MaterialAsset;
  if (isMaterial(material)) {
    asset = describeMaterial(material as any, materialRoot, name);
    materials.push(asset);
  } else if (isInstance(material)) {
    const base = (material as any).base;
    const baseName = names.get(base);
    if (!baseName) throw new Error('a mesh material instance is not on a material module export');
    const baseAsset = describeMaterial(base, materialRoot, baseName);
    asset = describeInstance(material as any, baseAsset, materialRoot, name);
    materials.push(baseAsset, asset);
  } else throw new Error("a mesh material is a material module's export");
  return { parent: asset.path, textures: Object.entries(asset.params).filter(([, type]) => type === 'texture').map(([param]) => param) };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.pcg\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  exportName === 'default' ? moduleName(fileKey) : `${moduleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`;

function modelKeyOf(fileKey: string, model: string) {
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of model.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

const pinOf = (property: string) => (/^b[A-Z]/.test(property) ? property : capitalize(property));

function endpoint(text: string, defaultPin: string, nodes: Record<string, unknown>, where: string) {
  const colon = text.indexOf(':');
  const node = colon < 0 ? text : text.slice(0, colon);
  if (!(node in nodes)) throw new Error(`${where}: '${node}' is not a node (nodes: ${Object.keys(nodes).join(', ')})`);
  return { node, pin: colon < 0 ? defaultPin : text.slice(colon + 1) };
}

function describeGraph(fileKey: string, definition: PcgGraphDefinition, context: MaterialContext) {
  const { params = {}, nodes, edges } = definition.description;
  if (!Object.keys(nodes).length) throw new Error('a graph has at least one node');
  const nodeRequests = Object.entries(nodes).map(([id, node]): PcgNodeRequest => {
    if (!NODE_ID.test(id)) throw new Error(`'${id}' is not a node name (a letter, then letters, digits or _)`);
    const values: Record<string, unknown> = {};
    const links: { param: string; pin: string }[] = [];
    for (const [property, value] of Object.entries(node.params ?? {})) {
      if (!isLink(value)) values[property] = value;
      else if (!(value.name in params)) throw new Error(`${id}.${property} links '${value.name}', which the graph's params do not have (${Object.keys(params).join(', ') || 'none'})`);
      else links.push({ param: value.name, pin: pinOf(property) });
    }
    const meshes = (node.meshes ?? []).map((mesh) => ({ model: modelKeyOf(fileKey, mesh.model), weight: mesh.weight ?? 1, materials: (mesh.materials ?? []).map((material) => meshMaterial(material, context)) }));
    return { id, type: node.type, params: values, links, meshes };
  });
  const edgeRequests = edges.map(([from, to], index) => {
    const source = endpoint(from, 'Out', nodes, `edges[${index}]`);
    const target = endpoint(to, 'In', nodes, `edges[${index}]`);
    return { from: source.node, fromPin: source.pin, to: target.node, toPin: target.pin };
  });
  const models = [...new Set(nodeRequests.flatMap((node) => node.meshes.map((mesh) => mesh.model)))];
  const paramRequests = Object.entries(params).map(([name, { type, value }]) => ({ name, type, value }));
  return { params: paramRequests, nodes: nodeRequests, edges: edgeRequests, models };
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string, materialRoot: string, names: WeakMap<object, string>): PcgExport[] {
  const result: PcgExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isGraph(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    try {
      const materials: MaterialAsset[] = [];
      const request = describeGraph(fileKey, value, { materialRoot, names, materials });
      const name = exportAssetName(fileKey, exportName);
      const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
      const params = Object.fromEntries(request.params.map((p) => [p.name, p.type]));
      result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}`, params, description: { nodes: request.nodes.length }, request, materials });
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
