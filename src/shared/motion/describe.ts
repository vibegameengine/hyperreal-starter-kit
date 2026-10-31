import { hashOf } from '../material/describe';
import type { MotionMatchingDefinition } from './index';

export interface MotionMatchingExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  description: Record<string, unknown>;
  request: { skeleton: string; clips: string[]; models: string[]; playRate?: readonly [number, number] };
  materials: never[];
}

const FORMAT = 6;

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
  const result: MotionMatchingExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isMotionMatching(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    const clips = value.description.clips.map((clip) => (clip.startsWith('.') ? clipFileKeyOf(fileKey, clip) : clip));
    const request = { skeleton: value.description.skeleton, clips, models: clips.filter((clip) => !clip.startsWith('/')), ...(value.description.playRate ? { playRate: value.description.playRate } : {}) };
    if (!request.clips.length) throw new Error(`${exportKey}: a motion matching database needs clips`);
    const name = exportAssetName(fileKey, exportName);
    const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
    result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}_C`, description: { clips: request.clips.length }, request, materials: [] });
  }
  return result;
}
