import { join } from 'node:path';
import { CLIFF_BACK, COAST_HALF_SIZE, coastHeight, fbm, rockiness, rockLine, rockTop, SEA_LEVEL } from '../../../src/features/world/assets/coastShape.ts';
import { loadHeightTexture } from './heightTexture.mjs';

const CONTOUR_STEP = 200;
export const STEP = 15;
const BASE = SEA_LEVEL - 450;
const TOP_BELOW_GROUND = 30;
const TOP_TUCK = 300;
const LEAN = 0.12;
const FACET = { cell: 380, setback: 90, tilt: 0.25 };
const LEDGE = { thickness: 150, recess: 55, dip: Math.tan((4 * Math.PI) / 180) };
const CRACK = { width: 5, depth: 22 };
const RELIEF = { strength: 28, scale: 1 / 270 };
const NOTCH = { centre: SEA_LEVEL + 60, half: 110, depth: 120 };
const END_TAPER = 600;
const LARGE_STEP = 60;
const END_SINK = 500;
const SMOOTHING = { iterations: 40, shrink: 0.5, inflate: -0.53 };
const SIDE_WINDOW = 40;
const MIN_RUN = 60;
const smooth = (t) => t * t * (3 - 2 * t);

const height = await loadHeightTexture(join(import.meta.dirname, '../../../src/features/world/assets/scans/textures/rock_face_03/height.jpg'));

const hash = (a, b, salt) => {
  const h = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

const TERRAIN_SPACING = 100;
const ROCKY = 0.45;

const TERRAIN_NODES = (2 * COAST_HALF_SIZE) / TERRAIN_SPACING + 1;
const terrainNodes = new Float64Array(TERRAIN_NODES * TERRAIN_NODES).fill(NaN);

function at(i, j) {
  const ci = Math.min(TERRAIN_NODES - 1, Math.max(0, i));
  const cj = Math.min(TERRAIN_NODES - 1, Math.max(0, j));
  const k = cj * TERRAIN_NODES + ci;
  if (Number.isNaN(terrainNodes[k])) terrainNodes[k] = coastHeight(ci * TERRAIN_SPACING - COAST_HALF_SIZE, cj * TERRAIN_SPACING - COAST_HALF_SIZE);
  return terrainNodes[k];
}

function terrainHeight(x, y) {
  const gx = (x + COAST_HALF_SIZE) / TERRAIN_SPACING;
  const gy = (y + COAST_HALF_SIZE) / TERRAIN_SPACING;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

const REACH = { step: 25, limit: 3000, margin: 100 };

const groundBehind = (sample) => {
  const d = CLIFF_BACK + REACH.margin * 2;
  return terrainHeight(sample.p[0] - sample.outward[0] * d, sample.p[1] - sample.outward[1] * d);
};

function groundReach(sample, top) {
  for (let d = 0; d <= REACH.limit; d += REACH.step) {
    if (terrainHeight(sample.p[0] - sample.outward[0] * d, sample.p[1] - sample.outward[1] * d) >= top) return d + REACH.margin;
  }
  return REACH.limit;
}

function contourSegments(half) {
  const segments = [];
  const n = Math.ceil((2 * half) / CONTOUR_STEP);
  const field = [];
  for (let j = 0; j <= n; j++) {
    field.push([]);
    for (let i = 0; i <= n; i++) {
      const x = -half + i * CONTOUR_STEP;
      const y = -half + j * CONTOUR_STEP;
      field[j].push(rockLine(x, y));
    }
  }
  const at = (i, j) => [-half + i * CONTOUR_STEP, -half + j * CONTOUR_STEP];
  const cross = (a, va, b, vb) => {
    const t = va / (va - vb);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const values = corners.map(([a, b]) => field[b][a]);
      const points = [];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        if (values[e] < 0 !== values[f] < 0) points.push(cross(at(...corners[e]), values[e], at(...corners[f]), values[f]));
      }
      if (points.length >= 2) segments.push([points[0], points[1]]);
      if (points.length === 4) segments.push([points[2], points[3]]);
    }
  }
  return segments;
}

function chain(segments) {
  const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const byPoint = new Map();
  segments.forEach((s, i) => s.forEach((p) => byPoint.set(key(p), [...(byPoint.get(key(p)) ?? []), i])));
  const used = new Uint8Array(segments.length);
  const lines = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const line = [...segments[start]];
    for (const grow of ['end', 'start']) {
      for (;;) {
        const tip = grow === 'end' ? line[line.length - 1] : line[0];
        const next = (byPoint.get(key(tip)) ?? []).find((i) => !used[i]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segments[next];
        const other = key(a) === key(tip) ? b : a;
        if (grow === 'end') line.push(other);
        else line.unshift(other);
      }
    }
    if (line.length > 8) lines.push(line);
  }
  return lines;
}

function smoothLine(line) {
  let points = line.map((p) => [p[0], p[1]]);
  const pass = (weight) => {
    points = points.map((p, i) => {
      if (i === 0 || i === points.length - 1) return p;
      const mx = (points[i - 1][0] + points[i + 1][0]) / 2;
      const my = (points[i - 1][1] + points[i + 1][1]) / 2;
      return [p[0] + weight * (mx - p[0]), p[1] + weight * (my - p[1])];
    });
  };
  for (let iteration = 0; iteration < SMOOTHING.iterations; iteration++) {
    pass(SMOOTHING.shrink);
    pass(SMOOTHING.inflate);
  }
  return points;
}

function resample(line) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = lengths[lengths.length - 1];
  const samples = [];
  let k = 0;
  for (let u = 0; u <= total; u += STEP) {
    while (k < line.length - 2 && lengths[k + 1] < u) k++;
    const t = (u - lengths[k]) / Math.max(lengths[k + 1] - lengths[k], 1e-6);
    samples.push({ u, p: [line[k][0] + (line[k + 1][0] - line[k][0]) * t, line[k][1] + (line[k + 1][1] - line[k][1]) * t] });
  }
  const normals = samples.map((s, i) => {
    const a = samples[Math.max(0, i - 8)].p;
    const b = samples[Math.min(samples.length - 1, i + 8)].p;
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [ty / l, -tx / l];
  });
  const local = samples.map((s, i) => Math.sign(-rockLine(s.p[0] + normals[i][0] * 200, s.p[1] + normals[i][1] * 200)) || 1);
  const sides = local.map((_, i) => {
    let sum = 0;
    for (let k = Math.max(0, i - SIDE_WINDOW); k <= Math.min(local.length - 1, i + SIDE_WINDOW); k++) sum += local[k];
    return sum >= 0 ? 1 : -1;
  });
  const oriented = samples.map((s, i) => ({ ...s, outward: [normals[i][0] * sides[i], normals[i][1] * sides[i]] }));
  return splitRuns(oriented, sides.map((side, i) => (rockiness(samples[i].p[0], samples[i].p[1]) > ROCKY ? side : 0)));
}

function splitRuns(samples, keys) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= samples.length; i++) {
    if (i < samples.length && keys[i] === keys[start]) continue;
    if (keys[start] !== 0 && i - start >= MIN_RUN) runs.push(samples.slice(start, i));
    start = i;
  }
  return runs;
}

const facetCells = new Map();
function facetCell(a, b) {
  const key = a * 100003 + b;
  let cell = facetCells.get(key);
  if (!cell) {
    cell = { centre: [(a + hash(a, b, 1)) * FACET.cell, (b + hash(a, b, 2)) * FACET.cell * 0.7], setback: FACET.setback * hash(a, b, 3), tiltU: FACET.tilt * (hash(a, b, 4) - 0.5), tiltV: FACET.tilt * (hash(a, b, 5) - 0.5) };
    facetCells.set(key, cell);
  }
  return cell;
}

function facetDepth(u, v) {
  const cu = Math.floor(u / FACET.cell);
  const cv = Math.floor(v / (FACET.cell * 0.7));
  let best = { d: Infinity, depth: 0 };
  let second = Infinity;
  for (let a = cu - 1; a <= cu + 1; a++) {
    for (let b = cv - 1; b <= cv + 1; b++) {
      const { centre, setback, tiltU, tiltV } = facetCell(a, b);
      const du = u - centre[0];
      const dv = (v - centre[1]) * 1.3;
      const d = du * du + dv * dv;
      const plane = setback + tiltU * (u - centre[0]) + tiltV * (v - centre[1]);
      if (d < best.d) {
        second = best.d;
        best = { d, depth: Math.max(0, plane) };
      } else if (d < second) second = d;
    }
  }
  return { depth: best.depth, toEdge: (Math.sqrt(second) - Math.sqrt(best.d)) / 2 };
}

function largeRelief(sample, worldZ) {
  const row = (worldZ - BASE) / LARGE_STEP;
  const r = Math.floor(row);
  sample.large ??= [];
  const at = (k) => (sample.large[k] ??= 180 * fbm(sample.p[0] / 1300 + 9.1, (BASE + k * LARGE_STEP) / 900 + sample.p[1] / 1300, 3));
  return at(r) + (at(r + 1) - at(r)) * (row - r);
}

function depthAt(sample, v, worldZ) {
  const { u, p } = sample;
  const facet = facetDepth(u, v);
  const bed = Math.floor((worldZ + LEDGE.dip * u) / LEDGE.thickness);
  const ledge = LEDGE.recess * hash(bed, 7, 11) ** 2;
  const crack = CRACK.depth * Math.max(0, 1 - facet.toEdge / CRACK.width);
  const notch = NOTCH.depth * Math.exp(-(((worldZ - NOTCH.centre) / NOTCH.half) ** 2));
  const relief = RELIEF.strength * height(u * RELIEF.scale, worldZ * RELIEF.scale);
  const large = largeRelief(sample, worldZ);
  return Math.max(facet.depth, ledge) + crack + notch + relief + large + LEAN * (worldZ - BASE);
}

function facesOutward(samples) {
  let agreement = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    const along = [samples[i + 1].p[0] - samples[i].p[0], samples[i + 1].p[1] - samples[i].p[1]];
    agreement += -along[1] * samples[i].outward[0] + along[0] * samples[i].outward[1];
  }
  return agreement > 0;
}

function outwardTriangles(samples, rows) {
  const keep = facesOutward(samples);
  const indices = new Uint32Array((samples.length - 1) * rows * 6);
  let o = 0;
  for (let i = 0; i + 1 < samples.length; i++) {
    for (let r = 0; r < rows; r++) {
      const a = i * (rows + 1) + r;
      const b = a + rows + 1;
      if (keep) indices.set([a, a + 1, b, b, a + 1, b + 1], o);
      else indices.set([a, b, a + 1, b, b + 1, a + 1], o);
      o += 6;
    }
  }
  return indices;
}

export function cliffSheets(half) {
  return chain(contourSegments(half)).flatMap((line) => resample(smoothLine(line))).map((samples) => {
    const tops = samples.map((s) => Math.min(rockTop(s.p[0], s.p[1]), groundBehind(s)) - TOP_BELOW_GROUND);
    const rows = Math.ceil((Math.max(...tops) - BASE) / STEP) + 1;
    const positions = new Float32Array(samples.length * (rows + 1) * 3);
    const colors = new Float32Array(samples.length * (rows + 1) * 4);
    const first = samples[0].u;
    const total = samples[samples.length - 1].u;
    samples.forEach((s, i) => {
      const fromEnd = Math.min(s.u - first, total - s.u);
      const sink = END_SINK * (1 - smooth(Math.min(1, fromEnd / END_TAPER)));
      for (let r = 0; r <= rows; r++) {
        const worldZ = Math.min(BASE + r * STEP, tops[i]);
        const face = depthAt(s, worldZ - BASE, worldZ) + sink;
        const depth = r === rows ? Math.max(face + TOP_TUCK, groundReach(s, tops[i])) : face;
        const o = (i * (rows + 1) + r) * 3;
        positions[o] = s.p[0] - s.outward[0] * depth;
        positions[o + 1] = s.p[1] - s.outward[1] * depth;
        positions[o + 2] = worldZ;
        const c = (i * (rows + 1) + r) * 4;
        colors.set([Math.min(1, depth / 250), (Math.floor(worldZ / LEDGE.thickness) % 8) / 7, Math.max(0, worldZ / 2500), 1], c);
      }
    });
    return { positions, colors, indices: outwardTriangles(samples, rows), length: samples.length * STEP };
  });
}
