import { hashOf } from '../material/describe';
import type { GroomDefinition } from './index';

export interface GroomExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  description: Record<string, unknown>;
  source: string;
  bindTo: string;
  request: { source: string; bindTo: string; interpolationPoints: number; simulate: boolean; groups: number[]; models: string[] };
  materials: never[];
}

const FORMAT = 3;

const isGroom = (value: unknown): value is GroomDefinition => !!value && typeof value === 'object' && (value as GroomDefinition).kind === 'groom-definition';

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.groom\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

function modelKeyOf(fileKey: string, model: string) {
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of model.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string): GroomExport[] {
  const result: GroomExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isGroom(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    try {
      const { source, bindTo, interpolationPoints = 100, simulate = true, groups = 1 } = value.description;
      if (!/\.abc$/i.test(source)) throw new Error(`'${source}' is not an Alembic groom (.abc)`);
      if (!bindTo.includes('.')) throw new Error(`bindTo '${bindTo}' is not an object path (/Game/.../Mesh.Mesh)`);
      const name = `GB_${moduleName(fileKey)}${exportName === 'default' ? '' : `_${exportName.replace(/[^A-Za-z0-9]/g, '')}`}`;
      const sourceKey = modelKeyOf(fileKey, source);
      const request = { source: sourceKey, bindTo, interpolationPoints, simulate, groups: Array.from({ length: groups }, (_, index) => index), models: [sourceKey] };
      const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
      result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}`, description: { bindTo }, source: sourceKey, bindTo, request, materials: [] });
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
