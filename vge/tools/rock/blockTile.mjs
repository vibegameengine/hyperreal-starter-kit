import quickhull from 'quickhull3d';
import { seededRandom } from '../nature/noise.mjs';

const UNIT = 70;
const HULL_DILATION = 0.45 * UNIT;
export const TILE_SIZE = 20 * UNIT;
const SAMPLE_SPACING = 1 * UNIT;
const FRACTURE_SPACING = 6 * UNIT;
const FRACTURE_RADIUS = [10 * UNIT, 15 * UNIT];
const NEIGHBOURHOOD = 2.5 * UNIT;
const BLOCK_REACH = 10.5 * UNIT;
const MIN_CLUSTER = 10;
const BED_SPACING = 2.6 * UNIT;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function poisson(next, low, high, spacing, tries) {
  const points = [];
  const cell = spacing / Math.sqrt(3);
  const grid = new Map();
  const keyOf = (p) => p.map((v) => Math.floor(v / cell)).join(',');
  for (let t = 0; t < tries; t++) {
    const p = [0, 1, 2].map((a) => low + next() * (high - low));
    const [ci, cj, ck] = p.map((v) => Math.floor(v / cell));
    let near = false;
    for (let i = ci - 2; i <= ci + 2 && !near; i++)
      for (let j = cj - 2; j <= cj + 2 && !near; j++)
        for (let k = ck - 2; k <= ck + 2 && !near; k++) {
          const q = grid.get(`${i},${j},${k}`);
          if (q && dot(sub(p, q), sub(p, q)) < spacing * spacing) near = true;
        }
    if (near) continue;
    grid.set(keyOf(p), p);
    points.push(p);
  }
  return points;
}

const FRACTURE_AXES = {
  rhombohedral: [normalize([0.5, 0.5, 0]), normalize([0, 0.5, 0.5]), normalize([0.5, 0, 0.5])],
  equidimensional: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
};

function beddingPlanes(next) {
  const planes = [];
  for (let z = -TILE_SIZE / 2 + BED_SPACING * (0.5 + next()); z < TILE_SIZE / 2; z += BED_SPACING * (0.7 + 0.6 * next())) {
    const tilt = [(next() - 0.5) * 0.12, (next() - 0.5) * 0.12, 1];
    planes.push({ centre: [0, 0, z], normal: normalize(tilt), radius: TILE_SIZE });
  }
  return planes;
}

function fractures(next, type) {
  if (type === 'layered') {
    const joints = poisson(next, -TILE_SIZE / 2 + 3 * UNIT, TILE_SIZE / 2 - 3 * UNIT, FRACTURE_SPACING, 1000).map((centre) => {
      const angle = next() * Math.PI;
      return { centre, normal: normalize([Math.cos(angle), Math.sin(angle), (next() - 0.5) * 0.2]), radius: FRACTURE_RADIUS[0] * (0.5 + next() * 0.5) };
    });
    return [...beddingPlanes(next), ...joints];
  }
  const centres = poisson(next, -TILE_SIZE / 2 + 3 * UNIT, TILE_SIZE / 2 - 3 * UNIT, FRACTURE_SPACING, 1000);
  const axes = FRACTURE_AXES[type];
  return centres.map((centre) => {
    const jitter = [next() - 0.5, next() - 0.5, next() - 0.5].map((v) => v * 0.25);
    const normal = normalize(axes[Math.floor(next() * axes.length)].map((v, i) => v + jitter[i]));
    return { centre, normal, radius: FRACTURE_RADIUS[0] + next() * (FRACTURE_RADIUS[1] - FRACTURE_RADIUS[0]) };
  });
}

function crossesFracture(a, b, discs) {
  const direction = sub(b, a);
  for (const disc of discs) {
    const denominator = dot(disc.normal, direction);
    if (Math.abs(denominator) < 1e-9) continue;
    const t = dot(disc.normal, sub(disc.centre, a)) / denominator;
    if (t <= 0 || t >= 1) continue;
    const hit = [a[0] + direction[0] * t, a[1] + direction[1] * t, a[2] + direction[2] * t];
    const offset = sub(hit, disc.centre);
    if (dot(offset, offset) < disc.radius * disc.radius) return true;
  }
  return false;
}

function neighbourGraph(points, discs) {
  return points.map((p) =>
    points.reduce((list, q, j) => {
      const d = sub(p, q);
      if (q !== p && dot(d, d) < NEIGHBOURHOOD * NEIGHBOURHOOD && !crossesFracture(p, q, discs)) list.push(j);
      return list;
    }, []),
  );
}

function linkable(candidate, cluster, discs) {
  return cluster.every((p) => {
    const d = sub(candidate, p);
    return dot(d, d) <= BLOCK_REACH * BLOCK_REACH && !crossesFracture(p, candidate, discs);
  });
}

function clusters(points, discs) {
  const graph = neighbourGraph(points, discs);
  const visited = new Uint8Array(points.length);
  const found = [];
  for (let seed = 0; seed < points.length; seed++) {
    const queue = [seed];
    const cluster = [];
    while (queue.length) {
      const index = queue.shift();
      if (visited[index] || !linkable(points[index], cluster, discs)) continue;
      cluster.push(points[index]);
      visited[index] = 1;
      for (const next of graph[index]) if (!visited[next]) queue.push(next);
    }
    if (cluster.length > MIN_CLUSTER) found.push(cluster);
  }
  return found;
}

function hullPlanes(cluster) {
  const faces = quickhull.default(cluster);
  const centre = cluster.reduce((sum, p) => sum.map((v, i) => v + p[i] / cluster.length), [0, 0, 0]);
  const planes = faces.map(([a, b, c]) => {
    let normal = normalize(cross(sub(cluster[b], cluster[a]), sub(cluster[c], cluster[a])));
    if (dot(normal, sub(cluster[a], centre)) < 0) normal = normal.map((v) => -v);
    return { normal, offset: dot(normal, cluster[a]) + HULL_DILATION };
  });
  const low = [0, 1, 2].map((a) => Math.min(...cluster.map((p) => p[a])) - HULL_DILATION);
  const high = [0, 1, 2].map((a) => Math.max(...cluster.map((p) => p[a])) + HULL_DILATION);
  return { planes, centre, low, high };
}

export function blockTile({ seed, type }) {
  const next = seededRandom(seed);
  const points = poisson(next, -TILE_SIZE / 2, TILE_SIZE / 2, SAMPLE_SPACING, 10000);
  const discs = fractures(next, type);
  return clusters(points, discs).map(hullPlanes);
}
