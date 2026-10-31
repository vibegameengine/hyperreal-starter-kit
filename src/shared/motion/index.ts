export interface MotionMatchingDescription {
  readonly skeleton: string;
  readonly clips: readonly string[];
  readonly playRate?: readonly [number, number];
  readonly node?: Readonly<Record<string, unknown>>;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly database?: Readonly<Record<string, unknown>>;
  readonly channels?: readonly { readonly class: string; readonly fields?: Readonly<Record<string, unknown>> }[];
  readonly continuingPoseCostBias?: number;
}

export interface MotionMatchingDefinition {
  kind: 'motion-matching-definition';
  description: MotionMatchingDescription;
}

export interface MotionMatchingRef {
  readonly kind: 'motion-matching';
  readonly key: string;
  readonly path?: string;
  readonly continuingPoseCostBias?: number;
}

export function defineMotionMatching(description: MotionMatchingDescription): MotionMatchingRef {
  return { kind: 'motion-matching-definition', description } as unknown as MotionMatchingRef;
}
