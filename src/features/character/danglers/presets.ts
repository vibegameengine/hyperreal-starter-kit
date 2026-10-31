export interface DanglerTuning {
  swingDegrees: number;
  angularSpring: number;
  decayPerSecond: number;
  gravityScale: number;
  inertiaScale: number;
  tipLength: number;
  thickness: number;
}

export interface DanglerChain {
  bones: readonly string[];
  spaceBone: string;
  tuning: DanglerTuning;
}

export interface DanglerRig {
  response: number;
  accelerationClamp: number;
  chains: readonly DanglerChain[];
}

const FREE_SWING_DEGREES = 170;

const HAIR: DanglerTuning = { swingDegrees: FREE_SWING_DEGREES, angularSpring: 2000, decayPerSecond: 10, gravityScale: 0.02, inertiaScale: 0.1, tipLength: 4, thickness: 6 };
const SHORT_LOCK: DanglerTuning = { ...HAIR, angularSpring: 3000, tipLength: 3 };
const EARRING: DanglerTuning = { swingDegrees: 60, angularSpring: 40, decayPerSecond: 3, gravityScale: 0.25, inertiaScale: 0.25, tipLength: 2, thickness: 4 };
const PENDANT: DanglerTuning = { ...EARRING, swingDegrees: 45, angularSpring: 120, tipLength: 3 };
const HARDWARE: DanglerTuning = { ...EARRING, swingDegrees: 45, angularSpring: 400, decayPerSecond: 4, tipLength: 3 };
const RIBBON: DanglerTuning = { swingDegrees: FREE_SWING_DEGREES, angularSpring: 3000, decayPerSecond: 8, gravityScale: 0.05, inertiaScale: 0.1, tipLength: 4, thickness: 4 };
const POUCH: DanglerTuning = { swingDegrees: FREE_SWING_DEGREES, angularSpring: 8000, decayPerSecond: 6, gravityScale: 0.3, inertiaScale: 0.3, tipLength: 5, thickness: 5 };
const FUSED_POUCH: DanglerTuning = { ...POUCH, angularSpring: 15000 };
const FUSED_POUCH_WEAKEST: DanglerTuning = { ...POUCH, angularSpring: 25000 };

const numbered = (stem: string, from: number, to: number, suffix = '') => Array.from({ length: to - from + 1 }, (_, index) => `${stem}_${String(from + index).padStart(2, '0')}${suffix}`);
const chain = (bones: readonly string[], spaceBone: string, tuning: DanglerTuning): DanglerChain => ({ bones, spaceBone, tuning });

const hair = (): DanglerChain[] => [
  chain(numbered('hair_tail', 1, 2), 'Head', HAIR),
  chain(numbered('hair_tail', 3, 6), 'Head', HAIR),
  chain(numbered('hair_tail', 3, 6, '_l'), 'Head', HAIR),
  chain(numbered('hair_tail', 3, 6, '_r'), 'Head', HAIR),
  chain(numbered('hair_lock_front', 1, 3, '_l'), 'Head', SHORT_LOCK),
  chain(numbered('hair_lock_front', 1, 3, '_r'), 'Head', SHORT_LOCK),
  chain(numbered('hair_lock_side', 1, 3, '_l'), 'Head', SHORT_LOCK),
  chain(numbered('hair_lock_side', 1, 4, '_r'), 'Head', SHORT_LOCK),
  chain(numbered('hair_lock_top', 1, 3, '_l'), 'Head', SHORT_LOCK),
  chain(numbered('hair_lock_top', 1, 3, '_r'), 'Head', SHORT_LOCK),
  chain(numbered('hair_bang', 1, 2, '_l'), 'Head', SHORT_LOCK),
  chain(numbered('hair_bang', 1, 2, '_r'), 'Head', SHORT_LOCK),
  chain(numbered('hair_strand', 1, 2, '_l'), 'Head', HAIR),
  chain(numbered('hair_strand', 1, 2, '_r'), 'Head', HAIR),
];

const jewellery = (): DanglerChain[] => [
  chain(['earring_01_l'], 'Head', EARRING),
  chain(['earring_01_r'], 'Head', EARRING),
  chain(numbered('earring_chain', 1, 2, '_l'), 'Head', EARRING),
  chain(['pendant_01'], 'Neck', PENDANT),
];

const gear = (): DanglerChain[] => [
  chain(['pouch_hip_01_l'], 'LeftUpLeg', FUSED_POUCH),
  chain(['pouch_thigh_01_l'], 'LeftUpLeg', POUCH),
  chain(numbered('ribbon_front', 1, 3, '_l'), 'LeftUpLeg', RIBBON),
  chain(numbered('strap_thigh', 1, 2, '_l'), 'LeftUpLeg', RIBBON),
  chain(['pouch_hip_01_r'], 'RightUpLeg', POUCH),
  chain(['pouch_thigh_01_r'], 'RightUpLeg', FUSED_POUCH),
  chain(['pouch_thigh_front_01_r'], 'RightUpLeg', FUSED_POUCH_WEAKEST),
  chain(numbered('ribbon_front', 1, 4, '_r'), 'RightUpLeg', RIBBON),
  chain(numbered('ribbon_back', 1, 3, '_r'), 'RightUpLeg', RIBBON),
  chain(['carabiner_01_r'], 'RightUpLeg', HARDWARE),
  chain(['loop_calf_01_r'], 'RightLeg', HARDWARE),
];

export const TRIPO_GIRL_DANGLERS: DanglerRig = {
  response: 1,
  accelerationClamp: 3000,
  chains: [...hair(), ...jewellery(), ...gear()],
};

export const danglerBones = (rig: DanglerRig) => rig.chains.flatMap((each) => each.bones);
