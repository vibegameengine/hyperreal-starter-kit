import type { MotionSituations, SituationDatabases } from '../entities/motionSituation';
import { mannyJog, mannyJogIdle, mannyJogPivots, mannyJogStarts, mannyJogStops, mannyMotion, mannyWalkIdle, mannyWalkPivots, mannyWalkStarts, mannyWalkStops } from './manny.motion';

const DATABASES: SituationDatabases = {
  'idle:walk': mannyWalkIdle,
  'idle:jog': mannyJogIdle,
  'starting:walk': mannyWalkStarts,
  'starting:jog': mannyJogStarts,
  'moving:walk': mannyMotion,
  'moving:jog': mannyJog,
  'stopping:walk': mannyWalkStops,
  'stopping:jog': mannyJogStops,
  'pivoting:walk': mannyWalkPivots,
  'pivoting:jog': mannyJogPivots,
};

export const MANNY_SITUATIONS: MotionSituations = { databases: DATABASES, speeds: { walk: 147, jog: 292 }, braking: { walk: 86, jog: 263 }, jogFromInput: 0.75 };
