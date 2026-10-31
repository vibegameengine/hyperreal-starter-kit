import type { MaterialRef } from '../material';

export interface TerrainSample {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly slope: number;
}

export interface TerrainLayer {
  readonly name: string;
  readonly weight: (sample: TerrainSample) => number;
}

export interface TerrainGrass {
  readonly layer: string;
  readonly model: string;
  readonly material?: MaterialRef | string;
  readonly density: number;
  readonly startCull: number;
  readonly endCull: number;
  readonly scale?: readonly [number, number];
}

export interface TerrainDescription {
  readonly components: number;
  readonly sectionsPerComponent?: 1 | 2;
  readonly quadsPerSection?: 7 | 15 | 31 | 63 | 127 | 255;
  readonly spacing?: number;
  readonly height: (x: number, y: number) => number;
  readonly material?: MaterialRef | string;
  readonly runtimeMaterialParameters?: boolean;
  readonly layers?: readonly TerrainLayer[];
  readonly grass?: readonly TerrainGrass[];
}

export interface TerrainDefinition {
  kind: 'terrain-definition';
  description: TerrainDescription;
}

export interface TerrainRef {
  readonly kind: 'terrain';
  readonly key: string;
  readonly size: number;
  readonly path?: string;
}

export function defineTerrain(description: TerrainDescription): TerrainRef {
  return { kind: 'terrain-definition', description } as unknown as TerrainRef;
}
