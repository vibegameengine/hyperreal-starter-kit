import { clamp01 } from './valleyShape';

export const HILL_HEIGHT = 3000;
export const HILL_RADIUS = 6000;
const STEEP_SIDE = 2.5;

export function pcgLabHeight(x: number, y: number) {
  const along = x > 0 ? x * STEEP_SIDE : x;
  const r = Math.hypot(along, y) / HILL_RADIUS;
  return HILL_HEIGHT * Math.exp(-r * r) + 25 * Math.sin(x / 700) * Math.cos(y / 900);
}

const PATH_XY: readonly (readonly [number, number])[] = [
  [-8200, -1600],
  [-6200, -900],
  [-4400, 500],
  [-2800, 1500],
  [-1300, 1100],
  [-300, 200],
];

export const PATH: readonly (readonly [number, number, number])[] = PATH_XY.map(([x, y]) => [x, y, pcgLabHeight(x, y)]);
export const PATH_WIDTH = 260;

export function pathDistance(x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, ay] = PATH[i];
    const [bx, by] = PATH[i + 1];
    const t = clamp01(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2));
    best = Math.min(best, Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t)));
  }
  return best;
}
