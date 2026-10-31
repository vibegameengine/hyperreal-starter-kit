import { join } from 'node:path';
import { fbm, rockiness, rockTop, shoreDistance } from '../../../src/features/world/assets/coastShape.ts';
import { blockTile, TILE_SIZE } from './blockTile.mjs';
import { loadHeightTexture } from './heightTexture.mjs';
import { createNoise } from '../nature/noise.mjs';

const AIR = 1e4;
const TOP_BELOW_GROUND = 30;
const FACE_DROP = 300;
const SEABED = -450;
const ZONE = { seaward: 300, inland: 900 };
const DETAIL_BAND = 120;
const SMOOTH_RADIUS = 3;
const FACET = { setback: 70 };
const LEDGE = { dip: Math.tan((5 * Math.PI) / 180), thickness: 140, recess: 45 };
const CRACK = { width: 5, depth: 18 };
const WARP = { strength: 32.5, scale: 0.1642 / 50 };
const BUCKET = 100;
const MASSIF = { large: 220, medium: 90 };
const noise = createNoise(4242);
const TILE_TYPES = ['layered', 'layered', 'rhombohedral', 'layered'];

const height = await loadHeightTexture(join(import.meta.dirname, '../../../src/features/world/assets/scans/textures/rock_face_03/height.jpg'));
const tiles = TILE_TYPES.map((type, i) => indexTile(blockTile({ seed: 101 + i * 17, type })));

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth = (t) => t * t * (3 - 2 * t);
const hash = (a, b, salt) => {
  const h = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

function indexTile(blocks) {
  const buckets = new Map();
  blocks.forEach((block, index) => {
    const low = block.low.map((v) => Math.floor((v - WARP.strength) / BUCKET));
    const high = block.high.map((v) => Math.floor((v + WARP.strength) / BUCKET));
    for (let i = low[0]; i <= high[0]; i++)
      for (let j = low[1]; j <= high[1]; j++)
        for (let k = low[2]; k <= high[2]; k++) {
          const key = `${i},${j},${k}`;
          buckets.set(key, [...(buckets.get(key) ?? []), index]);
        }
  });
  return { blocks, buckets };
}

const rockLine = (x, y) => shoreDistance(x, y) + 250 * fbm(x / 2600 + 3.1, y / 2600 - 1.7, 4);

export function columnOf(x, y) {
  const step = 80;
  const s = rockLine(x, y);
  const top = rockTop(x, y) - TOP_BELOW_GROUND;
  const height = SEABED + (top - SEABED) * smooth(clamp01(s / FACE_DROP));
  const gx = (rockLine(x + step, y) - rockLine(x - step, y)) / (2 * step);
  const gy = (rockLine(x, y + step) - rockLine(x, y - step)) / (2 * step);
  const slope = Math.hypot(gx, gy) || 1;
  const steepness = ((top - SEABED) / FACE_DROP) * slope;
  return { s, top, height, stretch: Math.sqrt(1 + steepness * steepness), rock: rockiness(x, y), outward: [-gx / slope, -gy / slope, 0] };
}

function bodyAt(x, y, z, column) {
  const band = Math.max(-column.s - ZONE.seaward, column.s - FACE_DROP - ZONE.inland);
  const face = (z - column.height) / column.stretch - MASSIF.large * noise.fbm3(x / 1100, y / 1100, z / 900, 3) - MASSIF.medium * noise.ridged3(x / 380, y / 380, z / 300, 2);
  return Math.max(face, z - column.top, band, SEABED - 250 - z);
}

function tileFrame(x, y, z) {
  const ti = Math.floor(x / TILE_SIZE);
  const tj = Math.floor(y / TILE_SIZE);
  const tk = Math.floor(z / TILE_SIZE);
  const variant = Math.floor(hash(ti, tj + tk * 31, 1) * tiles.length);
  const turn = Math.floor(hash(ti, tj + tk * 31, 2) * 4);
  const origin = [(ti + 0.5) * TILE_SIZE, (tj + 0.5) * TILE_SIZE, (tk + 0.5) * TILE_SIZE];
  const cos = [1, 0, -1, 0][turn];
  const sin = [0, 1, 0, -1][turn];
  const toLocal = (p) => {
    const dx = p[0] - origin[0];
    const dy = p[1] - origin[1];
    return [cos * dx + sin * dy, -sin * dx + cos * dy, p[2] - origin[2]];
  };
  const toWorld = (p) => [cos * p[0] - sin * p[1] + origin[0], sin * p[0] + cos * p[1] + origin[1], p[2] + origin[2]];
  return { key: `${ti},${tj},${tk}`, tile: tiles[variant], toLocal, toWorld, turn };
}

function blockDistance(block, p) {
  let d = -AIR;
  for (const plane of block.planes) {
    const dd = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.offset;
    const h = Math.max(SMOOTH_RADIUS - Math.abs(d - dd), 0) / SMOOTH_RADIUS;
    d = Math.max(d, dd) + h * h * SMOOTH_RADIUS * 0.25;
  }
  return d;
}

function containingBlocks(frame, local) {
  const candidates = frame.tile.buckets.get(local.map((v) => Math.floor(v / BUCKET)).join(',')) ?? [];
  let first = { index: -1, d: AIR };
  let second = { index: -1, d: AIR };
  for (const index of candidates) {
    const d = blockDistance(frame.tile.blocks[index], local);
    if (d < first.d) [first, second] = [{ index, d }, first];
    else if (d < second.d) second = { index, d };
  }
  return { first, second };
}

const facetCache = new Map();
function facetOf(frame, index, column) {
  const key = `${frame.key}:${index}`;
  if (facetCache.has(key)) return facetCache.get(key);
  const block = frame.tile.blocks[index];
  const rotate = (n) => frame.toWorld(n).map((v, a) => v - frame.toWorld([0, 0, 0])[a]);
  const outward = column.outward;
  const plane = block.planes.reduce((best, p) => {
    const n = rotate(p.normal);
    const facing = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
    return facing > best.facing ? { n, facing } : best;
  }, { n: outward, facing: -Infinity });
  const centre = frame.toWorld(block.centre);
  const centreColumn = columnOf(centre[0], centre[1]);
  const depth = -bodyAt(centre[0], centre[1], centre[2], centreColumn);
  const facet = { normal: plane.n, centre, offset: depth - FACET.setback * hash(index, frame.turn + 7, 9) };
  facetCache.set(key, facet);
  return facet;
}

function ledgeRecess(z, x, y) {
  const coordinate = z + LEDGE.dip * (0.8 * x + 0.6 * y);
  const bed = Math.floor(coordinate / LEDGE.thickness);
  return LEDGE.recess * hash(bed, 3, 11) ** 2;
}

export function makeSampler() {
  return (x, y, z, here) => {
    if (here.rock < 0.15) return { value: AIR, bed: 0, crack: 0 };
    const body = bodyAt(x, y, z, here);
    if (Math.abs(body) > DETAIL_BAND) return { value: body, bed: 0, crack: 0 };
    const u = [x * WARP.scale, y * WARP.scale, z * WARP.scale];
    const relief = WARP.strength * 0.5 * (height(u[0], u[2]) + height(u[1], u[2]));
    const vertical = clamp01((here.stretch - 1.3) / 2);
    let value = body - relief + ledgeRecess(z, x, y) * vertical;
    const frame = tileFrame(x, y, z);
    const local = frame.toLocal([x, y, z]);
    const { first, second } = containingBlocks(frame, local);
    if (first.index >= 0) {
      const facet = facetOf(frame, first.index, here);
      const along = facet.normal[0] * (x - facet.centre[0]) + facet.normal[1] * (y - facet.centre[1]) + facet.normal[2] * (z - facet.centre[2]);
      value = Math.max(value, along - facet.offset - 0.3 * relief) ;
      const toBoundary = second.index >= 0 ? (second.d - first.d) / 2 : AIR;
      value += CRACK.depth * Math.max(0, 1 - toBoundary / CRACK.width);
    }
    const fade = clamp01((here.rock - 0.15) / 0.35);
    return { value: value + (1 - fade) * 400, bed: first.index + frame.turn * 97, crack: clamp01(1 - (second.d - first.d) / (2 * CRACK.width)) };
  };
}
