export interface FractureNode {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly model?: string;
}

export type FractureEdge = readonly [string, string];

export interface FractureDescription {
  readonly nodes: Readonly<Record<string, FractureNode>>;
  readonly edges: readonly FractureEdge[];
  readonly collection?: Readonly<Record<string, unknown>>;
}

export interface FractureDefinition {
  kind: 'fracture-definition';
  description: FractureDescription;
}

export interface GeometryCollectionRef {
  readonly kind: 'geometry-collection';
  readonly key: string;
  readonly path?: string;
}

export function defineFracture(description: FractureDescription): GeometryCollectionRef {
  return { kind: 'fracture-definition', description } as unknown as GeometryCollectionRef;
}
