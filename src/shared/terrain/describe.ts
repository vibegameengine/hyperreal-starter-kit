import { describeInstance, describeMaterial, engineMaterial, hashOf, type MaterialAsset } from '../material/describe';
import type { TerrainDefinition, TerrainDescription, TerrainSample } from './index';

export interface TerrainExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  size: number;
  description: Record<string, unknown>;
  request: Record<string, unknown>;
  materials: MaterialAsset[];
}

const FORMAT = 4;
const MID = 32768;
const UNITS_PER_SCALE = 128;
const MAX_UNITS = 32000;

const isTerrain = (value: unknown): value is TerrainDefinition => (value as any)?.kind === 'terrain-definition';
const isMaterial = (value: unknown) => (value as any)?.kind === 'material-definition';
const isInstance = (value: unknown) => (value as any)?.kind === 'instance-definition';
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const terrainModuleName = (fileKey: string) =>
  fileKey
    .replace(/^.*\//, '')
    .replace(/\.terrain\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  exportName === 'default' ? terrainModuleName(fileKey) : `${terrainModuleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`;

const BASE64_CHUNK = 0x8000;

function base64(bytes: Uint8Array) {
  let text = '';
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK) text += String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK));
  return btoa(text);
}

function sampleHeights(description: TerrainDescription) {
  const sections = description.sectionsPerComponent ?? 1;
  const quads = description.quadsPerSection ?? 63;
  const spacing = description.spacing ?? 100;
  const verts = description.components * sections * quads + 1;
  const half = ((verts - 1) * spacing) / 2;
  const heights = new Float64Array(verts * verts);
  for (let row = 0; row < verts; row++) {
    for (let column = 0; column < verts; column++) heights[row * verts + column] = description.height(column * spacing - half, row * spacing - half);
  }
  return { sections, quads, spacing, verts, half, heights };
}

function layerWeights(description: TerrainDescription, sampled: ReturnType<typeof sampleHeights>) {
  const layers = description.layers ?? [];
  if (!layers.length) return [];
  const { verts, spacing, half, heights } = sampled;
  const at = (column: number, row: number) => heights[Math.min(verts - 1, Math.max(0, row)) * verts + Math.min(verts - 1, Math.max(0, column))];
  const weights = layers.map(() => new Uint8Array(verts * verts));
  const raw = new Float64Array(layers.length);
  for (let row = 0; row < verts; row++) {
    for (let column = 0; column < verts; column++) {
      const dx = (at(column + 1, row) - at(column - 1, row)) / (2 * spacing);
      const dy = (at(column, row + 1) - at(column, row - 1)) / (2 * spacing);
      const sample: TerrainSample = { x: column * spacing - half, y: row * spacing - half, height: at(column, row), slope: (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI };
      let total = 0;
      layers.forEach((layer, index) => {
        raw[index] = Math.max(0, layer.weight(sample));
        total += raw[index];
      });
      if (total <= 0) {
        raw.fill(0);
        raw[0] = 1;
        total = 1;
      }
      let given = 0;
      layers.forEach((_, index) => {
        const value = index === layers.length - 1 ? 255 - given : Math.round((raw[index] / total) * 255);
        weights[index][row * verts + column] = value;
        given += value;
      });
    }
  }
  return layers.map((layer, index) => ({ name: layer.name, weights: base64(weights[index]) }));
}

function modelKeyOf(fileKey: string, model: string) {
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of model.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function materialPathOf(material: unknown, materialRoot: string, names: WeakMap<object, string>, materials: MaterialAsset[]) {
  if (material === undefined) return undefined;
  if (typeof material === 'string') return material;
  const name = names.get(material as object);
  if (isMaterial(material) && name) {
    const asset = describeMaterial(material as any, materialRoot, name);
    materials.push(asset);
    return asset.path;
  }
  if (isInstance(material)) {
    const base = (material as any).base;
    if (!name) throw new Error('material: the material instance is not exported by a material module');
    if (typeof base === 'string') {
      const asset = describeInstance(material as any, engineMaterial(base, (material as any).params), materialRoot, name);
      materials.push(asset);
      return asset.path;
    }
    const baseName = names.get(base);
    if (!baseName) throw new Error('material: the material instance is not exported by a material module');
    const baseAsset = describeMaterial(base, materialRoot, baseName);
    const asset = describeInstance(material as any, baseAsset, materialRoot, name);
    materials.push(baseAsset, asset);
    return asset.path;
  }
  throw new Error("material: a material module's export or an asset path");
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string, materialRoot: string, names: WeakMap<object, string>): TerrainExport[] {
  const result: TerrainExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isTerrain(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    try {
      const description = value.description;
      const materials: MaterialAsset[] = [];
      const sampled = sampleHeights(description);
      const highest = sampled.heights.reduce((max, h) => Math.max(max, Math.abs(h)), 0);
      const scaleZ = Math.max(100, Math.ceil((highest * UNITS_PER_SCALE) / MAX_UNITS));
      const units = new Uint16Array(sampled.heights.length);
      sampled.heights.forEach((h, index) => {
        units[index] = Math.round(MID + (h * UNITS_PER_SCALE) / scaleZ);
      });
      const material = materialPathOf(description.material, materialRoot, names, materials);
      const request = {
        components: description.components,
        sectionsPerComponent: sampled.sections,
        quadsPerSection: sampled.quads,
        scale: [sampled.spacing, sampled.spacing, scaleZ],
        heights: base64(new Uint8Array(units.buffer)),
        layers: layerWeights(description, sampled),
        grass: (description.grass ?? []).map((g) => ({ ...g, model: modelKeyOf(fileKey, g.model), material: materialPathOf(g.material, materialRoot, names, materials) })),
        ...(material ? { material } : {}),
        ...(description.runtimeMaterialParameters ? { runtimeMaterialParameters: true } : {}),
        ...(description.water ? { water: description.water } : {}),
      };
      const summary = { components: description.components, sections: sampled.sections, quads: sampled.quads, spacing: sampled.spacing, scaleZ, material, layers: (description.layers ?? []).map((l) => l.name) };
      const name = exportAssetName(fileKey, exportName);
      const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
      result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}`, size: (sampled.verts - 1) * sampled.spacing, description: summary, request, materials });
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
