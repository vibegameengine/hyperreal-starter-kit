import type { MaterialRef } from '../material';


export type NiagaraVector = readonly [number, number] | readonly [number, number, number] | readonly [number, number, number, number];
export type NiagaraValue =
  | number
  | boolean
  | NiagaraVector
  | { link: string }
  | { hlsl: string }
  | { option: string }
  | { asset: string }
  | { dynamic: string; inputs?: Record<string, NiagaraValue> };

export const user = (name: string): { link: string } => ({ link: `User.${name}` });
export const attribute = (name: string): { link: string } => ({ link: `Particles.${name}` });
export const linked = (name: string): { link: string } => ({ link: name });
export const hlsl = (expression: string): NiagaraValue => ({ hlsl: expression });
export const option = (name: string): NiagaraValue => ({ option: name });
export const asset = (path: string): NiagaraValue => ({ asset: path });
export const dynamicInput = (script: string, inputs?: Record<string, NiagaraValue>): NiagaraValue => ({ dynamic: script, inputs });

export type NiagaraStage = 'emitterSpawn' | 'emitterUpdate' | 'particleSpawn' | 'particleUpdate';

export interface NiagaraModule {
  stage: NiagaraStage;
  script: string;
  inputs?: Record<string, NiagaraValue>;
}

export interface NiagaraRenderer {
  type: 'sprite' | 'mesh' | 'ribbon' | 'light';
  material?: MaterialRef | string;
  meshes?: string[];
  properties?: Record<string, unknown>;
}

export interface NiagaraEmitter {
  template?: string;
  sim?: 'cpu' | 'gpu';
  properties?: Record<string, unknown>;
  remove?: string[];
  inputs?: Record<string, NiagaraValue>;
  constants?: Record<string, number | boolean | string | NiagaraVector | { link: string }>;
  modules?: NiagaraModule[];
  renderers?: NiagaraRenderer[];
}

export type NiagaraUserValue = number | boolean | NiagaraVector;

export interface NiagaraSystemDescription {
  template?: string;
  user?: Record<string, NiagaraUserValue>;
  emitters: Record<string, NiagaraEmitter>;
}

export interface NiagaraSystemDefinition {
  kind: 'niagara-definition';
  description: NiagaraSystemDescription;
}

export interface NiagaraSystemRef {
  readonly kind: 'niagara';
  readonly key: string;
  readonly user: Record<string, 'float' | 'bool' | 'vector' | 'color'>;
  readonly path?: string;
}

export function defineSystem(description: NiagaraSystemDescription): NiagaraSystemRef {
  return { kind: 'niagara-definition', description } as unknown as NiagaraSystemRef;
}
