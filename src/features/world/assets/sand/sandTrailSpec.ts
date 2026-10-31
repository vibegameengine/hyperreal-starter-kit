export const TRAIL_RES = 1024;
export const TRAIL_TEXEL = 0.02;
export const TRAIL_SPAN = TRAIL_RES * TRAIL_TEXEL;
export const PRINT_DEPTH = 0.012;

export const SAND = {
  firmFrom: 0.05,
  firmFull: 0.6,
  wetDepth: 0.4,
  wetWallStart: 0.93,
  dryRim: 0.3,
  wetRim: 0.04,
  coverWet: 0.96,
  swashDiffusion: 0.000015,
  fillRate: 0.06,
  rimWashRate: 0.4,
  boreRate: 0.3,
  drainDry: 4,
  drainSaturated: 40,
  seepFrom: 0.75,
  seepFull: 0.97,
  seepLevel: 0.8,
} as const;

export const STILL_WATER_LIMIT_CM = 30;
