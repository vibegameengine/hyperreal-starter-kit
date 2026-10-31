import { defineMotionMatching } from '../../../shared/motion';

const SKELETON = '/Game/Characters/Mannequins/Meshes/SK_Mannequin.SK_Mannequin';
const ANIMS = '/Game/Characters/Mannequins/Anims/Unarmed';
const SIDEWAYS = ['Fwd_Left', 'Fwd_Right', 'Left', 'Right', 'Bwd', 'Bwd_Left', 'Bwd_Right'] as const;
type Gait = 'walk' | 'jog';
const manny = (gait: Gait) => {
  const name = gait === 'walk' ? 'Walk' : 'Jog';
  return SIDEWAYS.map((direction) => `${ANIMS}/${name}/MF_Unarmed_${name}_${direction}.MF_Unarmed_${name}_${direction}`);
};
const rigforge = (gait: Gait, clips: readonly string[]) => clips.map((clip) => `./mixamo/motion/${gait}_${clip}.fbx?skeleton=rig.fbx&retarget=manny`);
const sides = (turns: readonly string[]) => turns.flatMap((turn) => [`${turn}_left`, `${turn}_right`]);

const SETTINGS = { skeleton: SKELETON, playRate: [0.85, 1.15] as const, continuingPoseCostBias: -0.01, node: { BlendTime: 0.5, BlendOption: 'HermiteCubic', PoseReselectHistory: 0.3, MaxActiveBlends: 4 } };
const PIVOT = { ...SETTINGS, continuingPoseCostBias: -0.05 };
const STOP = { ...SETTINGS, continuingPoseCostBias: -0.3 };
const STARTS = ['start_a', 'start_b', ...sides(['start_90', 'start_180'])];
const STOPS = ['stop_a', 'stop_b'];
const PIVOTS = sides(['pivot_90', 'pivot_180', 'turn_90', 'turn_180']);

export const mannyMotion = defineMotionMatching({ ...SETTINGS, clips: [...rigforge('walk', ['loop']), ...manny('walk')] });
export const mannyJog = defineMotionMatching({ ...SETTINGS, clips: rigforge('jog', ['loop']) });
export const mannyWalkIdle = defineMotionMatching({ ...SETTINGS, clips: rigforge('walk', ['idle_loop']) });
export const mannyJogIdle = defineMotionMatching({ ...SETTINGS, clips: rigforge('jog', ['idle_loop']) });
export const mannyWalkStarts = defineMotionMatching({ ...SETTINGS, clips: rigforge('walk', STARTS) });
export const mannyJogStarts = defineMotionMatching({ ...SETTINGS, clips: rigforge('jog', STARTS) });
export const mannyWalkStops = defineMotionMatching({ ...STOP, clips: rigforge('walk', STOPS) });
export const mannyJogStops = defineMotionMatching({ ...STOP, clips: rigforge('jog', STOPS) });
export const mannyWalkPivots = defineMotionMatching({ ...PIVOT, clips: rigforge('walk', PIVOTS) });
export const mannyJogPivots = defineMotionMatching({ ...PIVOT, clips: rigforge('jog', PIVOTS) });
