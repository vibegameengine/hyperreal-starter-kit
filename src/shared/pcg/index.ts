import type { MaterialRef } from '../material';

export type PcgParamType = 'float' | 'int' | 'bool';

export interface PcgParamDefault {
  readonly type: PcgParamType;
  readonly value: number | boolean;
}

export interface PcgParamLink {
  readonly kind: 'pcg-param';
  readonly name: string;
}

export interface PcgMesh {
  readonly model: string;
  readonly weight?: number;
  readonly materials?: readonly MaterialRef[];
}

export interface PcgNode {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly meshes?: readonly PcgMesh[];
}

export type PcgEdge = readonly [string, string];

export interface PcgGraphDescription {
  readonly params?: Readonly<Record<string, PcgParamDefault>>;
  readonly nodes: Readonly<Record<string, PcgNode>>;
  readonly edges: readonly PcgEdge[];
}

export interface PcgGraphDefinition {
  kind: 'pcg-definition';
  description: PcgGraphDescription;
}

export interface PcgGraphRef {
  readonly kind: 'pcg';
  readonly key: string;
  readonly params: Readonly<Record<string, PcgParamType>>;
  readonly path?: string;
}

export const float = (value: number): PcgParamDefault => ({ type: 'float', value });
export const int = (value: number): PcgParamDefault => ({ type: 'int', value: Math.round(value) });
export const bool = (value: boolean): PcgParamDefault => ({ type: 'bool', value });
export const param = (name: string): PcgParamLink => ({ kind: 'pcg-param', name });

export function defineGraph(description: PcgGraphDescription): PcgGraphRef {
  return { kind: 'pcg-definition', description } as unknown as PcgGraphRef;
}
