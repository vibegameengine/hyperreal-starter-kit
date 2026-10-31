import { clamp01, smooth } from './valleyShape';

export const LAKE_CENTER = [2500, 0] as const;
export const LAKE_RADIUS = 2600;
export const LAKE_DEPTH = 380;
export const WATER_LEVEL = -60;

export const RIVER: readonly (readonly [number, number, number])[] = [
  [-5600, -3600, 15],
  [-4200, -2400, 0],
  [-2700, -1700, -15],
  [-1200, -800, -35],
  [200, -300, WATER_LEVEL],
];
export const RIVER_WIDTH = 520;
export const RIVER_DEPTH = 160;

function distanceToRiver(x: number, y: number) {
  let best = { distance: Infinity, z: 0 };
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [ax, ay, az] = RIVER[i];
    const [bx, by, bz] = RIVER[i + 1];
    const t = clamp01(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
    const distance = Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t));
    if (distance < best.distance) best = { distance, z: az + (bz - az) * t };
  }
  return best;
}

const BANK = 40;

export function waterLabHeight(x: number, y: number) {
  const ground = BANK + 12 * Math.sin(x / 900) * Math.cos(y / 1100);
  const lake = Math.hypot(x - LAKE_CENTER[0], y - LAKE_CENTER[1]) / LAKE_RADIUS;
  const basin = -LAKE_DEPTH + (ground + LAKE_DEPTH) * smooth(clamp01((lake - 0.3) / 0.65));
  const river = distanceToRiver(x, y);
  const bed = river.z - RIVER_DEPTH;
  const nearBank = Math.min(ground, river.z + BANK);
  const bank = nearBank + (ground - nearBank) * smooth(clamp01((river.distance - RIVER_WIDTH * 0.65) / RIVER_WIDTH));
  const channel = bed + (bank - bed) * smooth(clamp01((river.distance - RIVER_WIDTH * 0.1) / (RIVER_WIDTH * 0.4)));
  return Math.min(ground, basin, channel);
}
