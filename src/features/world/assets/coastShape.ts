export const COAST_HALF_SIZE = 25200;
export const SEA_LEVEL = 0;

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function hash(x: number, y: number) {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const u = smooth(x - ix);
  const v = smooth(y - iy);
  const top = lerp(hash(ix, iy), hash(ix + 1, iy), u);
  const bottom = lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u);
  return lerp(top, bottom, v) * 2 - 1;
}

export function fbm(x: number, y: number, octaves = 5) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * frequency + i * 17.3, y * frequency - i * 9.1) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum;
}

export const LAGOON = { x: -1500, y: -5000, radiusX: 13500, radiusY: 8500 };
const OCEAN_EDGE = -17500;
const MOUTH_HALF_WIDTH = 4200;
const ISLET = { x: 5200, y: -9800, radius: 1700 };
const BLEND = 2200;

function softMin(a: number, b: number) {
  if (Math.abs(a - b) > BLEND) return Math.min(a, b);
  const h = clamp01(0.5 + (b - a) / (2 * BLEND));
  return lerp(b, a, h) - BLEND * h * (1 - h);
}

function warped(x: number, y: number): [number, number] {
  return [x + 2600 * fbm(x / 9000, y / 9000, 4), y + 2600 * fbm(x / 9000 + 5.2, y / 9000 + 1.7, 4)];
}

function lagoonDistance(x: number, y: number) {
  const [wx, wy] = warped(x, y);
  return (Math.hypot((wx - LAGOON.x) / LAGOON.radiusX, (wy - LAGOON.y) / LAGOON.radiusY) - 1) * 10000;
}

function oceanDistance(x: number, y: number) {
  return y - (OCEAN_EDGE + 3200 * fbm(x / 11000, 3.3, 5));
}

function mouthDistance(x: number, y: number) {
  if (y > LAGOON.y) return 1e9;
  return Math.abs(x - 1500 * fbm(y / 6000, 7.1, 3)) - MOUTH_HALF_WIDTH * (1 + 0.6 * smooth(clamp01((OCEAN_EDGE + 3000 - y) / 5000)));
}

const isletLand = (x: number, y: number) => ISLET.radius * (1 + 0.35 * fbm(x / 1500, y / 1500, 3)) - Math.hypot(x - ISLET.x, (y - ISLET.y) * 1.3);

export function shoreDistance(x: number, y: number) {
  const water = softMin(softMin(lagoonDistance(x, y), oceanDistance(x, y)), mouthDistance(x, y)) + 500 * fbm(x / 1800, y / 1800, 3);
  return Math.max(water, isletLand(x, y));
}

export function sandiness(x: number, y: number) {
  const [wx, wy] = warped(x, y);
  const angle = Math.atan2(wy - LAGOON.y, wx - LAGOON.x);
  const northArc = smooth(clamp01((Math.sin(angle) - 0.15) / 0.4));
  const cove = smooth(clamp01((fbm(x / 7000 + 2.1, y / 7000, 3) + 0.05) / 0.25)) * smooth(clamp01((-y - 15000) / 3000));
  const inLagoon = smooth(clamp01((oceanDistance(x, y) - 2500) / 3000));
  return Math.max(northArc * inLagoon, cove);
}

function plateau(x: number, y: number) {
  const rise = smooth(clamp01((y + 2000) / 22000)) * 1100;
  const hills = 700 * fbm(x / 9000, y / 9000, 5) + 180 * fbm(x / 1500, y / 1500, 3);
  return 1150 + rise + hills;
}

function seabed(depth: number, x: number, y: number) {
  const lagoonFloor = -140 - 260 * smooth(clamp01(depth / 5000));
  const ocean = smooth(clamp01((-oceanDistance(x, y) - 800) / 6000));
  return lerp(lagoonFloor, -1500, ocean) + 60 * fbm(x / 1200, y / 1200, 3);
}

function beachProfile(s: number, top: number) {
  const beach = s * 0.05;
  const dunes = smooth(clamp01((s - 2500) / 7000));
  return lerp(beach, top, dunes);
}

function cliffProfile(s: number, top: number, x: number, y: number) {
  const ragged = 160 * fbm(x / 600, y / 600, 3);
  return lerp(-380, top + ragged, smooth(clamp01((s - 300) / 900)));
}

export function coastHeight(x: number, y: number) {
  const s = shoreDistance(x, y);
  const top = plateau(x, y);
  if (s < -400) return seabed(-s, x, y);
  const land = lerp(cliffProfile(s, top, x, y), beachProfile(s, top), sandiness(x, y));
  return s < 0 ? lerp(seabed(-s, x, y), land, smooth(clamp01((s + 400) / 400))) : land;
}

export const rockiness = (x: number, y: number) => 1 - sandiness(x, y);

export function rockTop(x: number, y: number) {
  return plateau(x, y);
}

export function rockHeight(x: number, y: number) {
  const s = shoreDistance(x, y);
  return lerp(-450, plateau(x, y), smooth(clamp01((s + 600) / 320)));
}

export function coastSlope(x: number, y: number) {
  const step = 100;
  const dx = (coastHeight(x + step, y) - coastHeight(x - step, y)) / (2 * step);
  const dy = (coastHeight(x, y + step) - coastHeight(x, y - step)) / (2 * step);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}

export function seaward(x: number, y: number): [number, number] {
  const step = 200;
  const dx = shoreDistance(x + step, y) - shoreDistance(x - step, y);
  const dy = shoreDistance(x, y + step) - shoreDistance(x, y - step);
  const length = Math.hypot(dx, dy) || 1;
  return [-dx / length, -dy / length];
}
