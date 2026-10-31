import { isValidElement, type ReactElement } from 'react';
import elementsJson from '../../../unreal/Typing/ue/ue-material-jsx.json';
import type { InstanceDefinition, MaterialDefinition } from './index';
import type { MaterialParam, MaterialParamType, MaterialParamValues } from './types';


interface ElementEntry {
  class: string;
  inputs: string[];
}
const ELEMENTS = elementsJson as unknown as Record<string, ElementEntry>;

interface Link {
  node: number;
  output: string;
}
interface GraphNode {
  class: string;
  props: Record<string, unknown>;
  inputs: Record<string, Link>;
}
export interface MaterialRequest {
  path: string;
  settings: Record<string, unknown>;
  usage: string[];
  nodes: GraphNode[];
  outputs: Record<string, Link>;
}
export interface InstanceRequest {
  path: string;
  parent: string;
  scalar: Record<string, number>;
  vector: Record<string, readonly number[]>;
  texture: Record<string, string>;
}

export interface MaterialAsset {
  kind: 'material' | 'instance';
  folder: string;
  path: string;
  usage: string[];
  params: Record<string, MaterialParamType>;
  request: MaterialRequest | InstanceRequest;
}
export interface MaterialExport extends MaterialAsset {
  exportName: string;
  exportKey: string;
  base?: MaterialAsset;
}

const FORMAT = 1;

const isDefinition = (value: unknown): value is MaterialDefinition => (value as any)?.kind === 'material-definition' && isValidElement((value as any).element);
const isInstanceDefinition = (value: unknown): value is InstanceDefinition => (value as any)?.kind === 'instance-definition';
const isParam = (value: unknown): value is MaterialParam => (value as any)?.kind === 'param' && typeof (value as any).name === 'string';

export function hashOf(text: string) {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return (fnv(0x811c9dc5) + fnv(0x2f6b4a91)).slice(0, 12);
}

function expand(element: ReactElement): ReactElement {
  let current: any = element;
  for (let depth = 0; typeof current?.type === 'function'; depth++) {
    if (depth > 64) throw new Error('a material component renders itself without end');
    current = current.type(current.props);
  }
  if (!isValidElement(current) || typeof current.type !== 'string') throw new Error(`a material element must render an expression element, got ${String(current?.type ?? current)}`);
  return current;
}

function json(value: unknown, where: string): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item, i) => json(item, `${where}[${i}]`));
  if (typeof value === 'object' && !isValidElement(value) && !isParam(value)) {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, json(v, `${where}.${k}`)]));
  }
  throw new Error(`${where} takes a plain value, not ${isValidElement(value) || isParam(value) ? 'an expression' : typeof value}`);
}

class GraphBuilder {
  nodes: GraphNode[] = [];
  private index = new Map<string, number>();
  params: Record<string, MaterialParamType> = {};
  private paramValues = new Map<string, string>();

  private add(node: GraphNode): number {
    const key = JSON.stringify(node);
    let found = this.index.get(key);
    if (found === undefined) {
      found = this.nodes.push(node) - 1;
      this.index.set(key, found);
    }
    return found;
  }

  private param(p: MaterialParam, where: string): number {
    const type: MaterialParamType = typeof p.value === 'number' ? 'scalar' : typeof p.value === 'string' ? 'texture' : 'vector';
    const { coordinates, ...settings } = (p.options ?? {}) as Record<string, unknown>;
    const signature = JSON.stringify([type, p.value, settings]);
    const previous = this.paramValues.get(p.name);
    if (previous !== undefined && previous !== signature) throw new Error(`${where}: parameter '${p.name}' is given two different defaults or types`);
    this.paramValues.set(p.name, signature);
    this.params[p.name] = type;
    const options = (json(settings, where) as Record<string, unknown>) ?? {};
    if (type === 'scalar') return this.add({ class: 'MaterialExpressionScalarParameter', props: { parameterName: p.name, defaultValue: p.value, ...options }, inputs: {} });
    if (type === 'texture') {
      const uv = coordinates === undefined ? undefined : this.link(coordinates, `${where} '${p.name}'.coordinates`);
      return this.add({ class: 'MaterialExpressionTextureSampleParameter2D', props: { parameterName: p.name, texture: p.value, ...options }, inputs: uv ? { coordinates: uv } : {} });
    }
    const v = p.value as readonly number[];
    return this.add({ class: 'MaterialExpressionVectorParameter', props: { parameterName: p.name, defaultValue: [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 1], ...options }, inputs: {} });
  }

  link(value: unknown, where: string): Link | undefined {
    if (value === undefined || value === null || value === false) return undefined;
    if (typeof value === 'number') return { node: this.add({ class: 'MaterialExpressionConstant', props: { r: value }, inputs: {} }), output: '' };
    if (Array.isArray(value)) {
      const v = value as number[];
      if (!v.every((x) => typeof x === 'number') || v.length < 2 || v.length > 4) throw new Error(`${where}: a vector constant is 2 to 4 numbers`);
      if (v.length === 2) return { node: this.add({ class: 'MaterialExpressionConstant2Vector', props: { r: v[0], g: v[1] }, inputs: {} }), output: '' };
      if (v.length === 3) return { node: this.add({ class: 'MaterialExpressionConstant3Vector', props: { constant: [v[0], v[1], v[2], 1] }, inputs: {} }), output: '' };
      return { node: this.add({ class: 'MaterialExpressionConstant4Vector', props: { constant: v }, inputs: {} }), output: '' };
    }
    if (isParam(value)) return { node: this.param(value, where), output: '' };
    if (isValidElement(value)) return this.element(value, where);
    throw new Error(`${where} takes a number, a vector, param() or an expression element`);
  }

  private element(source: ReactElement, where: string): Link {
    const element = expand(source);
    const type = element.type as string;
    const entry = ELEMENTS[type];
    if (!entry || type === 'material') throw new Error(`${where}: <${type}> is not a material expression element`);
    const props = element.props as Record<string, unknown>;
    const node: GraphNode = { class: entry.class, props: {}, inputs: {} };
    const at = `${where} <${type}>`;
    const isCustom = entry.class === 'MaterialExpressionCustom';
    for (const [prop, value] of Object.entries(props)) {
      if (prop === 'children' || prop === 'key' || prop === 'output' || value === undefined) continue;
      if (isCustom && prop === 'inputs') {
        const named = Object.entries((value ?? {}) as Record<string, unknown>);
        node.props.inputs = named.map(([name]) => ({ inputName: name }));
        for (const [name, input] of named) {
          const link = this.link(input, `${at}.inputs.${name}`);
          if (link) node.inputs[name] = link;
        }
      } else if (isCustom && prop === 'additionalOutputs') {
        node.props.additionalOutputs = Object.entries(value as Record<string, string>).map(([outputName, outputType]) => ({ outputName, outputType }));
      } else if (isCustom && prop === 'additionalDefines') {
        node.props.additionalDefines = Object.entries(value as Record<string, unknown>).map(([defineName, defineValue]) => ({ defineName, defineValue: String(defineValue) }));
      } else if (entry.inputs.includes(prop)) {
        const link = this.link(value, `${at}.${prop}`);
        if (link) node.inputs[prop] = link;
      } else {
        node.props[prop] = json(value, `${at}.${prop}`);
      }
    }
    return { node: this.add(node), output: typeof props.output === 'string' ? props.output : '' };
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeMaterial(definition: MaterialDefinition, folderRoot: string, name: string): MaterialAsset {
  const root = expand(definition.element);
  if (root.type !== 'material') throw new Error(`defineMaterial takes a <material> element, got <${String(root.type)}>`);
  const entry = ELEMENTS.material;
  const graph = new GraphBuilder();
  const settings: Record<string, unknown> = {};
  const outputs: Record<string, Link> = {};
  let usage: string[] = [];
  for (const [prop, value] of Object.entries(root.props as Record<string, unknown>)) {
    if (prop === 'children') {
      [value].flat().filter(isValidElement).forEach((child, index) => graph.link(child, `<material> output node ${index}`));
      continue;
    }
    if (prop === 'key' || value === undefined) continue;
    if (prop === 'usage') usage = (value as string[]).map(capitalize);
    else if (entry.inputs.includes(prop)) {
      const link = graph.link(value, `<material>.${prop}`);
      if (link) outputs[prop] = link;
    } else settings[prop] = json(value, `<material>.${prop}`);
  }
  const description = { settings, usage, nodes: graph.nodes, outputs };
  const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, description]))}`;
  const path = `${folder}/${name}.${name}`;
  return { kind: 'material', folder, path, usage, params: graph.params, request: { path: `${folder}/${name}`, ...description } };
}

export function engineMaterial(path: string, values: MaterialParamValues): MaterialAsset {
  const params = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, typeof value === 'number' ? 'scalar' : typeof value === 'string' ? 'texture' : 'vector'] as const),
  ) as Record<string, MaterialParamType>;
  return { kind: 'material', folder: '', path, usage: [], params, request: {} as MaterialRequest };
}

export function describeInstance(definition: InstanceDefinition, base: MaterialAsset, folderRoot: string, name: string): MaterialAsset {
  const scalar: Record<string, number> = {};
  const vector: Record<string, readonly number[]> = {};
  const texture: Record<string, string> = {};
  for (const [param, value] of Object.entries(definition.params as MaterialParamValues)) {
    const type = base.params[param];
    if (!type) throw new Error(`the instance '${name}' sets '${param}', which its material does not have (parameters: ${Object.keys(base.params).join(', ') || 'none'})`);
    if (type === 'scalar' && typeof value === 'number') scalar[param] = value;
    else if (type === 'vector' && Array.isArray(value)) vector[param] = value;
    else if (type === 'texture' && typeof value === 'string') texture[param] = value;
    else throw new Error(`the instance '${name}' gives the ${type} parameter '${param}' a ${Array.isArray(value) ? 'vector' : typeof value}`);
  }
  const description = { parent: base.path, scalar, vector, texture };
  const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, description]))}`;
  const path = `${folder}/${name}.${name}`;
  return { kind: 'instance', folder, path, usage: base.usage, params: base.params, request: { path: `${folder}/${name}`, ...description } };
}

export const materialModuleName = (fileKey: string) =>
  fileKey
    .replace(/^.*\//, '')
    .replace(/\.material\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

export const exportAssetName = (fileKey: string, exportName: string) =>
  exportName === 'default' ? materialModuleName(fileKey) : `${materialModuleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`;

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string, names: WeakMap<object, string>): MaterialExport[] {
  const result: MaterialExport[] = [];
  const materials = new Map<object, MaterialAsset>();
  const materialOf = (definition: MaterialDefinition) => {
    let asset = materials.get(definition);
    if (!asset) {
      asset = describeMaterial(definition, folderRoot, names.get(definition) ?? 'M');
      materials.set(definition, asset);
    }
    return asset;
  };
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (isDefinition(value)) names.set(value, exportAssetName(fileKey, exportName));
  }
  for (const [exportName, value] of Object.entries(moduleExports)) {
    const exportKey = `${fileKey}#${exportName}`;
    const name = exportAssetName(fileKey, exportName);
    try {
      if (isDefinition(value)) {
        result.push({ ...materialOf(value), exportName, exportKey });
      } else if (isInstanceDefinition(value) && typeof value.base === 'string') {
        result.push({ ...describeInstance(value, engineMaterial(value.base, value.params), folderRoot, name), exportName, exportKey });
      } else if (isInstanceDefinition(value)) {
        if (!isDefinition(value.base)) throw new Error('defineInstance takes a material made with defineMaterial, or an asset path');
        const base = materialOf(value.base);
        result.push({ ...describeInstance(value, base, folderRoot, name), exportName, exportKey, base });
      }
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
