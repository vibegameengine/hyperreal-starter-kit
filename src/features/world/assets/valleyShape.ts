export const VALLEY_HALF_SIZE = 12600;
const HILL_HEIGHT = 2400;
const VALLEY_FLOOR = 300;
export const PATH_WIDTH = 260;

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const meander = (x: number) => 1800 * Math.sin(x / 4200);
export const pathOffset = (x: number, y: number) => Math.abs(y + meander(x) * 0.6);

export const LAKE = { x: 6200, y: -meanderAt(6200), radius: 2600, depth: 420, level: VALLEY_FLOOR - 20 };

function meanderAt(x: number) {
  return 1800 * Math.sin(x / 4200);
}

export const LAKE_RIM = 1.6;

export const lakeShore =(x: number, y: number) => Math.hypot((x - LAKE.x) / 1.4, y - LAKE.y) / LAKE.radius;

export function valleyHeight(x: number, y: number) {
  const across = Math.abs(y + meander(x)) / VALLEY_HALF_SIZE;
  const walls = smooth(clamp01((across - 0.18) / 0.62)) * HILL_HEIGHT;
  const rolling = 260 * Math.sin(x / 1700) * Math.cos(y / 2300) + 140 * Math.sin((x + y) / 900);
  const ridges = 380 * Math.max(0, Math.sin(x / 2600 + y / 3100)) * clamp01(across * 1.6);
  const shore = lakeShore(x, y);
  const bowl = LAKE.depth * (1 - smooth(clamp01(shore)));
  const hollows = rolling < 0 ? rolling * smooth(clamp01((shore - LAKE_RIM) / 0.6)) : rolling * clamp01(shore);
  return VALLEY_FLOOR + walls + hollows + ridges - bowl;
}

export function valleySlope(x: number, y: number) {
  const step = 100;
  const dx = (valleyHeight(x + step, y) - valleyHeight(x - step, y)) / (2 * step);
  const dy = (valleyHeight(x, y + step) - valleyHeight(x, y - step)) / (2 * step);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}
