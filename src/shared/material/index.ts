import type { ReactElement } from 'react';
import type { MaterialProps } from '../../../unreal/Typing/ue/ue-material-jsx';
import type { DynamicMaterial, MaterialParam, MaterialParamValues, MaterialRef, MaterialTuple, MaterialValue, ParamOptions, TextureParamOptions } from './types';

export type * from './types';


export interface MaterialDefinition {
  readonly kind: 'material-definition';
  readonly element: ReactElement;
}
export interface InstanceDefinition {
  readonly kind: 'instance-definition';
  readonly base: MaterialDefinition | string;
  readonly params: MaterialParamValues;
}

export function defineMaterial(element: ReactElement<MaterialProps>): MaterialRef {
  const definition: MaterialDefinition = { kind: 'material-definition', element };
  return definition as unknown as MaterialRef;
}

export function defineInstance(base: MaterialRef | string, params: MaterialParamValues): MaterialRef {
  const definition: InstanceDefinition = { kind: 'instance-definition', base: typeof base === 'string' ? base : (base as unknown as MaterialDefinition), params };
  return definition as unknown as MaterialRef;
}

export function param(name: string, value: number, options?: ParamOptions): MaterialParam;
export function param(name: string, value: MaterialTuple, options?: Omit<ParamOptions, 'sliderMin' | 'sliderMax'>): MaterialParam;
export function param(name: string, texture: string, options?: TextureParamOptions): MaterialParam;
export function param(name: string, value: number | MaterialTuple | string, options?: ParamOptions | TextureParamOptions): MaterialParam {
  return { kind: 'param', name, value, options };
}

export function instance(base: MaterialRef, params: MaterialParamValues): DynamicMaterial {
  return { kind: 'dynamic', base, params };
}

export const isMaterialValue = (value: unknown): value is MaterialValue =>
  typeof value === 'object' && value !== null && ((value as any).kind === 'dynamic' ? typeof (value as any).base?.key === 'string' : ((value as any).kind === 'material' || (value as any).kind === 'instance') && typeof (value as any).key === 'string');
