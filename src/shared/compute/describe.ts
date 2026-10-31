import { hashOf } from '../material/describe';
import type { ComputeDefinition, ComputeKernel, ComputeResource } from './index';

export interface ComputeExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  textures: string[];
  params: string[];
  description: Record<string, unknown>;
  request: { resources: Record<string, unknown>[]; kernels: Record<string, unknown>[] };
  materials: never[];
}

const FORMAT = 3;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isCompute = (value: unknown): value is ComputeDefinition => !!value && typeof value === 'object' && (value as ComputeDefinition).kind === 'compute-definition';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.compute\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  exportName === 'default' ? moduleName(fileKey) : `${moduleName(fileKey)}_${capitalize(exportName.replace(/[^A-Za-z0-9]/g, ''))}`;

function resourceRequest(name: string, resource: ComputeResource) {
  if (resource.kind === 'buffer') return { name, kind: 'buffer', elements: resource.elements, components: resource.components };
  if (resource.kind === 'params') return { name, kind: 'params', names: [...resource.names] };
  return { name, kind: 'texture' };
}

function access(kernel: ComputeKernel, resources: Readonly<Record<string, ComputeResource>>) {
  const code = `${kernel.shared ?? ''}\n${kernel.body}`;
  const calls = (pattern: string) => new RegExp(`\\b${pattern}\\s*\\(`).test(code);
  const reads = kernel.uses.filter((used) => resources[used].kind === 'params' || calls(`${used}(Load|Size|Count)`));
  const writes = kernel.uses.filter((used) => resources[used].kind !== 'params' && calls(`${used}Store`));
  return { reads, writes };
}

const WRAPPED_GROUP_STRIDE = 128;

const groupGrid = (kernel: ComputeKernel) => kernel.threads.map((count, axis) => Math.ceil(count / kernel.group[axis])) as [number, number, number];

function linearThreads(kernel: ComputeKernel) {
  const [nx, ny, nz] = groupGrid(kernel);
  return [nx * ny * nz * kernel.group[0], 1, 1];
}

function kernelSource(name: string, kernel: ComputeKernel) {
  const [x, y, z] = kernel.group;
  const [nx, ny, nz] = groupGrid(kernel);
  return `${kernel.shared ?? ''}
void ${name}Body(uint Gidx, uint3 Gid, uint3 GTid, uint3 DTid)
{
${kernel.body}
}
[numthreads(${x}, ${y}, ${z})]
KERNEL_ENTRY_POINT(${name})
{
  uint flatGroup = Gid.x + (Gid.z * ${WRAPPED_GROUP_STRIDE}u + Gid.y) * ${WRAPPED_GROUP_STRIDE}u;
  if (flatGroup >= ${nx * ny * nz}u) return;
  uint3 groupId = uint3(flatGroup % ${nx}u, (flatGroup / ${nx}u) % ${ny}u, flatGroup / ${nx * ny}u);
  ${name}Body(Gidx, groupId, GTid, groupId * uint3(${x}u, ${y}u, ${z}u) + GTid);
}
`;
}

function check(exportKey: string, definition: ComputeDefinition) {
  const { resources, kernels } = definition.description;
  for (const name of [...Object.keys(resources), ...Object.keys(kernels)]) {
    if (!IDENTIFIER.test(name)) throw new Error(`${exportKey}: '${name}' is not an HLSL identifier`);
  }
  for (const [name, kernel] of Object.entries(kernels)) {
    const unknown = kernel.uses.filter((used) => !(used in resources));
    if (unknown.length) throw new Error(`${exportKey}: kernel ${name} uses ${unknown.join(', ')}, which are not resources (${Object.keys(resources).join(', ')})`);
  }
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string): ComputeExport[] {
  const result: ComputeExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isCompute(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    check(exportKey, value);
    const { resources, kernels } = value.description;
    const request = {
      resources: Object.entries(resources).map(([name, resource]) => resourceRequest(name, resource)),
      kernels: Object.entries(kernels).map(([name, kernel]) => ({ name, group: [...kernel.group], threads: linearThreads(kernel), ...access(kernel, resources), source: kernelSource(name, kernel) })),
    };
    const name = exportAssetName(fileKey, exportName);
    const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, request]))}`;
    const textures = Object.entries(resources).filter(([, r]) => r.kind === 'texture').map(([n]) => n);
    const params = Object.values(resources).flatMap((r) => (r.kind === 'params' ? [...r.names] : []));
    result.push({ exportName, exportKey, folder, name, path: `${folder}/${name}.${name}`, textures, params, description: { kernels: request.kernels.length }, request, materials: [] });
  }
  return result;
}
