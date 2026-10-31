export type Triple = readonly [number, number, number];

export type SignedAxis = readonly [0 | 1 | 2, 1 | -1];

export interface BoneAxes {
  along: SignedAxis;
  up: SignedAxis;
  side: SignedAxis;
}

export interface TissueRange {
  along: readonly [number, number];
  up: readonly [number, number];
  side: readonly [number, number];
}

export interface TissueResponse {
  along: number;
  up: number;
  side: number;
}

export interface TissueBone {
  bone: string;
  response: TissueResponse;
  spring: number;
  angularSpring: number;
  decayPerSecond: number;
  maxSwingDegrees?: number;
  linear: TissueRange;
  angularDegrees: TissueRange;
  centerAlong: number;
  extents: number;
}

export interface TissueCollider {
  bone: string;
  offset: Triple;
  radius: number;
}

export interface TissueChain {
  axes: BoneAxes;
  spaceBone: string;
  bones: readonly TissueBone[];
  colliders: readonly TissueCollider[];
}

export interface SoftTissueRig {
  gravityScale: number;
  bounce: number;
  accelerationClamp: number;
  chains: readonly TissueChain[];
}

export const BREAST_AXES_AFTER_FBX_IMPORT: BoneAxes = { along: [1, -1], up: [2, -1], side: [0, 1] };
export const BUTT_AXES_AFTER_FBX_IMPORT: BoneAxes = { along: [1, -1], up: [2, 1], side: [0, 1] };

const PINNED: TissueRange = { along: [0, 0], up: [0, 0], side: [0, 0] };
const FREE_SWING: TissueRange = { along: [0, 0], up: [-170, 170], side: [-170, 170] };

type SwingTuning = Pick<TissueBone, 'angularSpring' | 'decayPerSecond' | 'response' | 'centerAlong' | 'maxSwingDegrees'>;

const swingingTissue = (bone: string, tuning: SwingTuning): TissueBone => ({ bone, spring: 0, linear: PINNED, angularDegrees: FREE_SWING, extents: 8, ...tuning });

const MIXAMO_SIDE = { l: 'Left', r: 'Right' } as const;

const armColliders = (side: 'l' | 'r'): TissueCollider[] => [
  { bone: `${MIXAMO_SIDE[side]}Arm`, offset: [0, -15, 0], radius: 6 },
  { bone: `${MIXAMO_SIDE[side]}ForeArm`, offset: [0, -10, 0], radius: 5 },
  { bone: `${MIXAMO_SIDE[side]}Hand`, offset: [0, -6, 0], radius: 5 },
];

const breast = (side: 'l' | 'r'): TissueChain => ({
  axes: BREAST_AXES_AFTER_FBX_IMPORT,
  spaceBone: 'Spine2',
  bones: [
    swingingTissue(`breast_01_${side}`, { angularSpring: 1500, decayPerSecond: 7, centerAlong: 4.5, maxSwingDegrees: 20, response: { along: 0.21, up: 0.58, side: 0.4 } }),
  ],
  colliders: armColliders(side),
});

const butt = (side: 'l' | 'r'): TissueChain => ({
  axes: BUTT_AXES_AFTER_FBX_IMPORT,
  spaceBone: 'Hips',
  bones: [swingingTissue(`butt_${side}`, { angularSpring: 3000, decayPerSecond: 8, centerAlong: 5, maxSwingDegrees: 18, response: { along: 0.25, up: 0.37, side: 0.43 } })],
  colliders: [],
});

export const CURVY_BODY: SoftTissueRig = {
  gravityScale: 0.04,
  bounce: 2,
  accelerationClamp: 3000,
  chains: [breast('l'), breast('r'), butt('l'), butt('r')],
};
