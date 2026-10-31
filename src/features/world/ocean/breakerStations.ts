import { STATION_SPACING } from '../assets/ocean/breakerSpec';
import { SHORE_EXTENT, SHORE_ORIGIN } from '../assets/ocean/oceanShore';
import type { ShoreFieldData } from './shoreField';

const DENSE_SPACING = 0.5;
const SMOOTHING_PASSES = 30;
const EXPOSURE_PROBE = 8;
const MIN_EXPOSURE = 0.2;
const SIDE_PROBE = 3;
const WAVE_GROUND = 1;

type Point = [number, number];

export interface BreakerStations {
  data: Float32Array<ArrayBuffer>;
  count: number;
  segments: number[];
}

const cellSize = (data: ShoreFieldData) => SHORE_EXTENT / data.res;

function bilinear(values: Float32Array, res: number, x: number, y: number, channel: number) {
  const fx = Math.min(Math.max(((x - SHORE_ORIGIN) / SHORE_EXTENT) * res - 0.5, 0), res - 1.001);
  const fy = Math.min(Math.max(((y - SHORE_ORIGIN) / SHORE_EXTENT) * res - 0.5, 0), res - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const at = (a: number, b: number) => values[(b * res + a) * 4 + channel];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

const waveGround = (data: ShoreFieldData, x: number, y: number) => bilinear(data.ground, data.res, x, y, WAVE_GROUND);

export const groundAt = (data: ShoreFieldData, x: number, y: number) => bilinear(data.ground, data.res, x, y, 0);

function exposureAt(data: ShoreFieldData, x: number, y: number) {
  return Math.hypot(bilinear(data.field, data.fieldRes, x, y, 1), bilinear(data.field, data.fieldRes, x, y, 2));
}

function edgePoint(data: ShoreFieldData, i0: number, j0: number, i1: number, j1: number): Point {
  const v0 = data.ground[(j0 * data.res + i0) * 4 + WAVE_GROUND];
  const v1 = data.ground[(j1 * data.res + i1) * 4 + WAVE_GROUND];
  const t = v0 / (v0 - v1);
  const h = cellSize(data);
  return [SHORE_ORIGIN + (i0 + 0.5 + (i1 - i0) * t) * h, SHORE_ORIGIN + (j0 + 0.5 + (j1 - j0) * t) * h];
}

function cellEdges(data: ShoreFieldData, i: number, j: number) {
  const land = (a: number, b: number) => data.ground[(b * data.res + a) * 4 + WAVE_GROUND] > 0;
  const corners = [land(i, j), land(i + 1, j), land(i + 1, j + 1), land(i, j + 1)];
  const keys = [`h${i},${j}`, `v${i + 1},${j}`, `h${i},${j + 1}`, `v${i},${j}`];
  const crossed = keys.filter((_, e) => corners[e] !== corners[(e + 1) % 4]);
  if (crossed.length === 4 && corners[0]) return [[crossed[0], crossed[1]], [crossed[2], crossed[3]]];
  if (crossed.length === 4) return [[crossed[0], crossed[3]], [crossed[1], crossed[2]]];
  return crossed.length === 2 ? [[crossed[0], crossed[1]]] : [];
}

function contourLinks(data: ShoreFieldData) {
  const links = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  };
  for (let j = 0; j < data.res - 1; j++) {
    for (let i = 0; i < data.res - 1; i++) for (const [a, b] of cellEdges(data, i, j)) link(a, b);
  }
  return links;
}

function keyPoint(data: ShoreFieldData, key: string): Point {
  const [i, j] = key.slice(1).split(',').map(Number);
  return key[0] === 'h' ? edgePoint(data, i, j, i + 1, j) : edgePoint(data, i, j, i, j + 1);
}

function walk(links: Map<string, string[]>, start: string, visited: Set<string>) {
  const chain = [start];
  visited.add(start);
  for (;;) {
    const next = (links.get(chain[chain.length - 1]) ?? []).find((key) => !visited.has(key));
    if (!next) return chain;
    visited.add(next);
    chain.push(next);
  }
}

function contourChains(data: ShoreFieldData) {
  const links = contourLinks(data);
  const visited = new Set<string>();
  const chains: Point[][] = [];
  const ends = [...links.keys()].filter((key) => links.get(key)!.length === 1);
  for (const start of [...ends, ...links.keys()]) {
    if (visited.has(start)) continue;
    const forward = walk(links, start, visited);
    chains.push(forward.map((key) => keyPoint(data, key)));
  }
  return chains;
}

function resample(points: Point[], spacing: number) {
  const out: Point[] = [];
  let travelled = 0;
  let next = 0;
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1];
    const [bx, by] = points[k];
    const length = Math.hypot(bx - ax, by - ay);
    while (length > 0 && next <= travelled + length) {
      const t = (next - travelled) / length;
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      next += spacing;
    }
    travelled += length;
  }
  return out;
}

function smooth(points: Point[]) {
  let current = points;
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    current = current.map((p, k) =>
      k === 0 || k === current.length - 1
        ? p
        : [(current[k - 1][0] + 2 * p[0] + current[k + 1][0]) * 0.25, (current[k - 1][1] + 2 * p[1] + current[k + 1][1]) * 0.25],
    );
  }
  return current;
}

function seawardNormals(data: ShoreFieldData, points: Point[]) {
  const normals = points.map((p, k) => {
    const a = points[Math.max(k - 1, 0)];
    const b = points[Math.min(k + 1, points.length - 1)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] as Point;
  });
  const votes = points.reduce((sum, p, k) => {
    const [nx, ny] = normals[k];
    return sum + Math.sign(waveGround(data, p[0] - nx * SIDE_PROBE, p[1] - ny * SIDE_PROBE) - waveGround(data, p[0] + nx * SIDE_PROBE, p[1] + ny * SIDE_PROBE));
  }, 0);
  return votes >= 0 ? normals : normals.map(([nx, ny]) => [-nx, -ny] as Point);
}

function exposedRuns(data: ShoreFieldData, points: Point[], normals: Point[]) {
  const runs: { points: Point[]; normals: Point[] }[] = [];
  let run: { points: Point[]; normals: Point[] } = { points: [], normals: [] };
  points.forEach((p, k) => {
    const probe = [p[0] + normals[k][0] * EXPOSURE_PROBE, p[1] + normals[k][1] * EXPOSURE_PROBE];
    if (exposureAt(data, probe[0], probe[1]) >= MIN_EXPOSURE && waveGround(data, probe[0], probe[1]) < 0) {
      run.points.push(p);
      run.normals.push(normals[k]);
      return;
    }
    if (run.points.length > 1) runs.push(run);
    run = { points: [], normals: [] };
  });
  if (run.points.length > 1) runs.push(run);
  return runs;
}

export function buildBreakerStations(data: ShoreFieldData, capacity: number): BreakerStations {
  const values: number[] = [];
  const segments: number[] = [];
  for (const chain of contourChains(data)) {
    const line = resample(smooth(resample(chain, DENSE_SPACING)), STATION_SPACING);
    if (line.length < 2) continue;
    for (const run of exposedRuns(data, line, seawardNormals(data, line))) {
      const first = values.length / 4;
      if (first + run.points.length > capacity) return { data: new Float32Array(values), count: first, segments };
      run.points.forEach((p, k) => values.push(p[0], p[1], run.normals[k][0], run.normals[k][1]));
      for (let k = 0; k < run.points.length - 1; k++) segments.push(first + k);
    }
  }
  return { data: new Float32Array(values), count: values.length / 4, segments };
}
