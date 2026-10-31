export type Vector3 = readonly [number, number, number];

export interface TextureResource {
  readonly kind: 'texture';
}

export interface BufferResource {
  readonly kind: 'buffer';
  readonly elements: number;
  readonly components: 1 | 2 | 3 | 4;
}

export interface ParamsResource {
  readonly kind: 'params';
  readonly names: readonly string[];
}

export type ComputeResource = TextureResource | BufferResource | ParamsResource;

export interface ComputeKernel {
  readonly group: Vector3;
  readonly threads: Vector3;
  readonly uses: readonly string[];
  readonly shared?: string;
  readonly body: string;
}

export interface ComputeDescription {
  readonly resources: Readonly<Record<string, ComputeResource>>;
  readonly kernels: Readonly<Record<string, ComputeKernel>>;
}

export interface ComputeDefinition {
  kind: 'compute-definition';
  description: ComputeDescription;
}

export interface ComputeRef {
  readonly kind: 'compute';
  readonly key: string;
  readonly textures: readonly string[];
  readonly params: readonly string[];
  readonly path?: string;
}

export const texture = (): TextureResource => ({ kind: 'texture' });
export const buffer = (elements: number, components: 1 | 2 | 3 | 4 = 4): BufferResource => ({ kind: 'buffer', elements, components });
export const params = (...names: string[]): ParamsResource => ({ kind: 'params', names });

export function defineCompute(description: ComputeDescription): ComputeRef {
  return { kind: 'compute-definition', description } as unknown as ComputeRef;
}
