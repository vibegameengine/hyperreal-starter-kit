import type { ContentAssetRef } from '../engine/content';

export interface GroomDescription {
  readonly source: string;
  readonly bindTo: string;
  readonly interpolationPoints?: number;
  readonly simulate?: boolean;
  readonly groups?: number;
}

export interface GroomDefinition {
  kind: 'groom-definition';
  description: GroomDescription;
}

export interface GroomRef {
  readonly kind: 'groom';
  readonly key: string;
  readonly source: ContentAssetRef;
  readonly bindTo: string;
  readonly groomName: string;
  readonly path?: string;
}

export function defineGroom(description: GroomDescription): GroomRef {
  return { kind: 'groom-definition', description } as unknown as GroomRef;
}
