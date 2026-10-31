export interface MotionMatchingDescription {
  readonly skeleton: string;
  readonly clips: readonly string[];
  readonly playRate?: readonly [number, number];
}

export interface MotionMatchingDefinition {
  kind: 'motion-matching-definition';
  description: MotionMatchingDescription;
}

export interface MotionMatchingRef {
  readonly kind: 'motion-matching';
  readonly key: string;
  readonly path?: string;
}

export function defineMotionMatching(description: MotionMatchingDescription): MotionMatchingRef {
  return { kind: 'motion-matching-definition', description } as unknown as MotionMatchingRef;
}
