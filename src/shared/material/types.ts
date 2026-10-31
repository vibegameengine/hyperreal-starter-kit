import type { Key, ReactElement } from 'react';


export type MaterialTuple = readonly number[];

export interface ParamOptions {
  group?: string;
  sortPriority?: number;
  sliderMin?: number;
  sliderMax?: number;
}

export interface TextureParamOptions extends Omit<ParamOptions, 'sliderMin' | 'sliderMax'> {
  samplerType?: 'Color' | 'Grayscale' | 'Alpha' | 'Normal' | 'Masks' | 'LinearColor' | 'LinearGrayscale';
  samplerSource?: 'SSM_FromTextureAsset' | 'SSM_Wrap_WorldGroupSettings' | 'SSM_Clamp_WorldGroupSettings';
  coordinates?: ReactElement;
}

export interface MaterialParam {
  readonly kind: 'param';
  readonly name: string;
  readonly value: number | MaterialTuple | string;
  readonly options?: ParamOptions | TextureParamOptions;
}

export type MaterialInput = number | MaterialTuple | MaterialParam | ReactElement | null | undefined | false;

export interface MaterialElement {
  key?: Key;
  output?: string;
}

export interface MaterialRootElement {
  key?: Key;
  children?: ReactElement | ReadonlyArray<ReactElement>;
}

export type MaterialParamType = 'scalar' | 'vector' | 'texture';
export type MaterialParamValue = number | MaterialTuple | string;
export type MaterialParamValues = Readonly<Record<string, MaterialParamValue>>;

export interface MaterialRef {
  readonly kind: 'material' | 'instance';
  readonly key: string;
  readonly path?: string;
  readonly usage: readonly string[];
  readonly params: Readonly<Record<string, MaterialParamType>>;
}

export interface DynamicMaterial {
  readonly kind: 'dynamic';
  readonly base: MaterialRef;
  readonly params: MaterialParamValues;
}

export type MaterialValue = MaterialRef | DynamicMaterial;
