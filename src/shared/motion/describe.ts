import { hashOf } from '../material/describe';
import type { MotionMatchingDefinition } from './index';

export interface MotionMatchingExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  description: Record<string, unknown>;
  request: { skeleton: string; clips: string[]; models: string[]; playRate?: readonly [number, number]; node?: Readonly<Record<string, unknown>>; schema?: Readonly<Record<string, unknown>>; database?: Readonly<Record<string, unknown>>; channels?: readonly { readonly class: string; readonly fields?: Readonly<Record<string, unknown>> }[]; normalization?: string };
  runtime: { continuingPoseCostBias?: number };
  materials: never[];
}

const FORMAT = 9;

function clipFileKeyOf(fileKey: string, clip: string) {
  const [path, query] = clip.split('?');
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return query ? `${parts.join('/')}?${query}` : parts.join('/');
}

const isMotionMatching = (value: unknown): value is MotionMatchingDefinition =>
  !!value && typeof value === 'object' && (value as MotionMatchingDefinition).kind === 'motion-matching-definition';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.motion\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  exportName === 'default' ? moduleName(fileKey) : `${moduleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`;

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string): MotionMatchingExport[] {
  const described = Object.entries(moduleExports).flatMap(([exportName, value]) => {
    if (!isMotionMatching(value)) return [];
    const exportKey = `${fileKey}#${exportName}`;
    const clips = value.description.clips.map((clip) => (clip.startsWith('.') ? clipFileKeyOf(fileKey, clip) : clip));
    const skeleton = value.description.skeleton.startsWith('.') ? clipFileKeyOf(fileKey, value.description.skeleton) : value.description.skeleton;
    const models = [...clips, skeleton].filter((key, index, all) => !key.startsWith('/') && all.indexOf(key) === index);
    const request = { skeleton, clips, models, ...(value.description.playRate ? { playRate: value.description.playRate } : {}), ...(value.description.node ? { node: value.description.node } : {}), ...(value.description.schema ? { schema: value.description.schema } : {}), ...(value.description.database ? { database: value.description.database } : {}), ...(value.description.channels ? { channels: value.description.channels } : {}) };
    if (!request.clips.length) throw new Error(`${exportKey}: a motion matching database needs clips`);
    return [{ exportName, exportKey, name: exportAssetName(fileKey, exportName), request, bias: value.description.continuingPoseCostBias }];
  });
  const together = hashOf(JSON.stringify([FORMAT, described.map(({ name, request }) => [name, request])]));
  const folderOf = (name: string) => `${folderRoot}/${name}_${together}`;
  const normalizationName = `${moduleName(fileKey)}_Normalization`;
  const normalization = described.length > 1 ? `${folderOf(described[0].name)}/${normalizationName}.${normalizationName}` : undefined;
  return described.map(({ exportName, exportKey, name, request, bias }) => {
    const folder = folderOf(name);
    return { exportName, exportKey, folder, name, path: `${folder}/${name}.${name}_C`, description: { clips: request.clips.length }, request: { ...request, ...(normalization ? { normalization } : {}) }, runtime: { continuingPoseCostBias: bias }, materials: [] };
  });
}
