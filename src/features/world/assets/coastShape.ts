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

export const LAGOON = { x: -1500, y: -10500, radiusX: 4500, radiusY: 3000 };
const LAGOON_WARP = { amplitude: 900, scale: 4000 };
const OCEAN_EDGE = -17500;
const MOUTH_HALF_WIDTH = 1300;
const ISLET = { x: -300, y: -10900, radius: 600 };
const BLEND = 1200;

function softMin(a: number, b: number) {
  if (Math.abs(a - b) > BLEND) return Math.min(a, b);
  const h = clamp01(0.5 + (b - a) / (2 * BLEND));
  return lerp(b, a, h) - BLEND * h * (1 - h);
}

function warped(x: number, y: number): [number, number] {
  const { amplitude, scale } = LAGOON_WARP;
  return [x + amplitude * fbm(x / scale, y / scale, 4), y + amplitude * fbm(x / scale + 5.2, y / scale + 1.7, 4)];
}

function lagoonDistance([wx, wy]: readonly [number, number]) {
  return (Math.hypot((wx - LAGOON.x) / LAGOON.radiusX, (wy - LAGOON.y) / LAGOON.radiusY) - 1) * LAGOON.radiusY;
}

function oceanDistance(x: number, y: number) {
  return y - (OCEAN_EDGE + 3200 * fbm(x / 11000, 3.3, 5));
}

function mouthDistance(x: number, y: number) {
  if (y > LAGOON.y) return 1e9;
  return Math.abs(x - LAGOON.x - 700 * fbm(y / 3000, 7.1, 3)) - MOUTH_HALF_WIDTH * (1 + 0.8 * smooth(clamp01((OCEAN_EDGE + 2500 - y) / 2500)));
}

const isletLand = (x: number, y: number) => ISLET.radius * (1 + 0.35 * fbm(x / 1500, y / 1500, 3)) - Math.hypot(x - ISLET.x, (y - ISLET.y) * 1.3);

function bayUndulation(x: number, y: number) {
  return 340 * fbm(x / 17000, y / 17000, 4) + 500 * fbm(x / 26000 + 4.3, y / 26000 - 2.9, 2);
}

export function shoreDistance(x: number, y: number) {
  const w = warped(x, y);
  const ocean = oceanDistance(x, y);
  const ragged = 700 * fbm(x / 3800, y / 3800, 3);
  const bay = smooth(clamp01((sandinessAt(x, y, w, ocean) - 0.25) / 0.5));
  const water = softMin(softMin(lagoonDistance(w), ocean), mouthDistance(x, y)) + lerp(ragged, bayUndulation(x, y), bay);
  return Math.max(water, isletLand(x, y));
}

function sandinessAt(x: number, y: number, [wx, wy]: readonly [number, number], ocean: number) {
  const angle = Math.atan2(wy - LAGOON.y, wx - LAGOON.x);
  const northArc = smooth(clamp01((Math.sin(angle) - 0.15) / 0.4));
  const cove = smooth(clamp01((fbm(x / 7000 + 2.1, y / 7000, 3) + 0.05) / 0.25)) * smooth(clamp01((-y - 15000) / 3000));
  const inLagoon = smooth(clamp01((ocean - 2500) / 3000));
  return Math.max(northArc * inLagoon, cove);
}

export const sandiness = (x: number, y: number) => sandinessAt(x, y, warped(x, y), oceanDistance(x, y));

function plateau(x: number, y: number) {
  const rise = smooth(clamp01((y + 2000) / 22000)) * 1100;
  const hills = 700 * fbm(x / 9000, y / 9000, 5) + 180 * fbm(x / 1500, y / 1500, 3);
  return 1150 + rise + hills;
}

function seabedFloor(depth: number, x: number, y: number) {
  const lagoonFloor = -140 - 260 * smooth(clamp01(depth / 5000));
  const ocean = smooth(clamp01((-oceanDistance(x, y) - 800) / 6000));
  return lerp(lagoonFloor, -1500, ocean);
}

function bayDepth(d: number) {
  if (d < 7000) return d * 0.05;
  if (d < 26000) return 350 + (d - 7000) * 0.06;
  if (d < 70000) return 1490 + (d - 26000) * 0.07;
  return 4570 + (d - 70000) * 0.05;
}

const FLOOR_BLEND = 60;

function seabed(d: number, rock: number, x: number, y: number) {
  const floor = seabedFloor(d, x, y);
  const slope = -bayDepth(d);
  const h = clamp01(0.5 + (slope - floor) / (2 * FLOOR_BLEND));
  const profile = lerp(floor, slope, h) + FLOOR_BLEND * h * (1 - h);
  const ripple = 60 * fbm(x / 4500, y / 4500, 3) * smooth(clamp01((d - 800) / 3200));
  const rubble = rock * 60 * fbm(x / 1200, y / 1200, 3) * smooth(clamp01(d / 2000));
  return profile + ripple + rubble;
}

function bayBeach(e: number) {
  if (e < 3800) return e * 0.068;
  if (e < 7000) return 258.4 + (e - 3800) * 0.03;
  return 354.4 + (e - 7000) * 0.075;
}

export const SWASH_RUNUP = 0.4;
const CUSP_SPACING = 2400 * SWASH_RUNUP;

function swashRelief(e: number, x: number) {
  const r = (lo: number, hi: number) => smooth(clamp01((e - lo * SWASH_RUNUP) / ((hi - lo) * SWASH_RUNUP)));
  const cusp = Math.sin(((x + 2 * fbm(x / 6000, 3.3, 1) * 900) * 2 * Math.PI) / CUSP_SPACING);
  const berm = 14 * Math.exp(-(((e - 3800 * SWASH_RUNUP) / (500 * SWASH_RUNUP)) ** 2));
  return cusp * 9 * r(400, 1200) * (1 - r(2000, 3200)) + berm;
}

function longshoreBar(d: number, x: number) {
  const bar = Math.exp(-(((d - 4400) / 1000) ** 2)) * 28 - Math.exp(-(((d - 2600) / 900) ** 2)) * 31;
  return bar * (0.7 + 0.3 * 2 * fbm(x / 5000, 7.7, 1)) * smooth(clamp01((d - 500) / 1000));
}

function beachProfile(s: number, top: number, x: number) {
  const dunes = smooth(clamp01((s - 2500) / 7000));
  return lerp(bayBeach(s) + swashRelief(s, x), top, dunes);
}

export const CLIFF_FOOT = 400;
export const CLIFF_BACK = 900;
const RAGGED_FADE = 1500;

const rockLineFrom = (s: number, x: number, y: number) => s + 200 * fbm(x / 2600 + 3.1, y / 2600 - 1.7, 3);

export const rockLine = (x: number, y: number) => rockLineFrom(shoreDistance(x, y), x, y);

function cliffProfile(r: number, top: number, x: number, y: number) {
  const ragged = 160 * fbm(x / 600, y / 600, 3) * smooth(clamp01((r - CLIFF_BACK) / RAGGED_FADE));
  return lerp(-380, top + ragged, smooth(clamp01((r - CLIFF_FOOT) / (CLIFF_BACK - CLIFF_FOOT))));
}

const ROCK_SHELF = 400;

function heightFrom(x: number, y: number, s: number, raw: number) {
  const bay = smooth(clamp01((raw - 0.25) / 0.5));
  if (s >= 0) {
    const top = plateau(x, y);
    return lerp(cliffProfile(rockLineFrom(s, x, y), top, x, y), beachProfile(s, top, x), bay);
  }
  const sea = seabed(-s, 1 - bay, x, y) + longshoreBar(-s, x) * bay;
  const foot = smooth(clamp01((s + ROCK_SHELF) / ROCK_SHELF)) * (1 - bay);
  return foot > 0 ? lerp(sea, cliffProfile(rockLineFrom(s, x, y), plateau(x, y), x, y), foot) : sea;
}

export const coastHeight = (x: number, y: number) => heightFrom(x, y, shoreDistance(x, y), sandiness(x, y));

export const rockiness = (x: number, y: number) => 1 - sandiness(x, y);

export const CLIFF_ROCKINESS = 0.45;
const CLIFF_FACE_WIDTH = 400;

function groundFrom(x: number, y: number, s: number, raw: number, ground: number) {
  const rocky = smooth(clamp01((1 - raw - CLIFF_ROCKINESS) / 0.1));
  if (rocky <= 0) return ground;
  const face = smooth(clamp01(rockLineFrom(s, x, y) / CLIFF_FACE_WIDTH));
  return Math.max(ground, lerp(ground, plateau(x, y), face * rocky));
}

export function coastHeights(x: number, y: number): [ground: number, wave: number] {
  const s = shoreDistance(x, y);
  const raw = sandiness(x, y);
  const ground = heightFrom(x, y, s, raw);
  return [ground, groundFrom(x, y, s, raw, ground)];
}

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
