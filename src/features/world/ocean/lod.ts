export interface LodSettings {
  gridSize: number;
  leafSize: number;
  levels: number;
  rangeFactor: number;
  morphStartRatio: number;
  maxNodes: number;
  waveBound: number;
}

export interface Plane {
  normal: readonly [number, number, number];
  distance: number;
}

export interface View {
  camera: readonly [number, number, number];
  planes: readonly Plane[];
  seaLevel: number;
  scaledDistance?: (x: number, y: number, size: number, camera: readonly [number, number, number], vertical: readonly [number, number], limit: number) => number;
}

export const SURF_DETAIL = { scale: 0.25, deep: 6, shallow: 3.5, dryOuter: -1.5, dryInner: -0.5, near: 30, far: 120 } as const;

export const surfScaledDistance = (distance: number, scale: number) => distance * (scale + (1 - scale) * smoothstep(SURF_DETAIL.near, SURF_DETAIL.far, distance));

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export const DETAIL_RES = 128;
const DETAIL_ERODE = 2;
const DETAIL_BLUR = 6;
const DETAIL_EDGE_FADE = 10;
const EXACT_SAMPLES = 9;

function blurAxis(src: Float32Array, res: number, radius: number, horizontal: boolean) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) {
        const a = Math.min(res - 1, Math.max(0, (horizontal ? i : j) + o));
        sum += horizontal ? src[j * res + a] : src[a * res + i];
      }
      out[j * res + i] = sum / (2 * radius + 1);
    }
  }
  return out;
}

function erode(src: Float32Array, res: number, radius: number) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let low = Infinity;
      for (let b = -radius; b <= radius; b++) for (let a = -radius; a <= radius; a++) low = Math.min(low, src[Math.min(res - 1, Math.max(0, j + b)) * res + Math.min(res - 1, Math.max(0, i + a))]);
      out[j * res + i] = low;
    }
  }
  return out;
}

export function surfDetailField(ground: Float32Array, groundRes: number) {
  const step = groundRes / DETAIL_RES;
  let field = new Float32Array(DETAIL_RES * DETAIL_RES);
  for (let j = 0; j < DETAIL_RES; j++) {
    for (let i = 0; i < DETAIL_RES; i++) {
      let low = 1;
      for (let b = 0; b < step; b++) for (let a = 0; a < step; a++) low = Math.min(low, surfDetailScale(-ground[((j * step + b) * groundRes + i * step + a) * 4]));
      field[j * DETAIL_RES + i] = Math.log(low);
    }
  }
  field = erode(field, DETAIL_RES, DETAIL_ERODE);
  for (let pass = 0; pass < 3; pass++) field = blurAxis(blurAxis(field, DETAIL_RES, DETAIL_BLUR, true), DETAIL_RES, DETAIL_BLUR, false);
  const rgba = new Float32Array(DETAIL_RES * DETAIL_RES * 4);
  for (let j = 0; j < DETAIL_RES; j++) {
    for (let i = 0; i < DETAIL_RES; i++) {
      const edge = Math.min(i, j, DETAIL_RES - 1 - i, DETAIL_RES - 1 - j);
      rgba[(j * DETAIL_RES + i) * 4] = Math.exp(field[j * DETAIL_RES + i] * smoothstep(0, DETAIL_EDGE_FADE, edge));
    }
  }
  return rgba;
}

export function detailSampler(field: Float32Array, origin: number, size: number) {
  const at = (x: number, y: number) => {
    const fx = Math.min(Math.max(((x - origin) / size) * DETAIL_RES - 0.5, 0), DETAIL_RES - 1.001);
    const fy = Math.min(Math.max(((y - origin) / size) * DETAIL_RES - 0.5, 0), DETAIL_RES - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const v = (a: number, b: number) => field[(b * DETAIL_RES + a) * 4];
    return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - ty) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * ty;
  };
  const cell = size / DETAIL_RES;
  const lowest = new Map<string, number>();
  const minScale = (x: number, y: number, nodeSize: number) => {
    const key = `${x},${y},${nodeSize}`;
    const known = lowest.get(key);
    if (known !== undefined) return known;
    const samples = Math.min(65, Math.max(3, Math.ceil(nodeSize / cell) + 1));
    let low = 1;
    for (let b = 0; b < samples; b++) for (let a = 0; a < samples; a++) low = Math.min(low, at(x + (a / (samples - 1)) * nodeSize, y + (b / (samples - 1)) * nodeSize));
    lowest.set(key, low);
    return low;
  };
  return (x: number, y: number, nodeSize: number, camera: readonly [number, number, number], vertical: readonly [number, number], limit: number) => {
    const dz = Math.max(vertical[0] - camera[2], 0, camera[2] - vertical[1]);
    const near = [Math.min(Math.max(camera[0], x), x + nodeSize), Math.min(Math.max(camera[1], y), y + nodeSize)];
    const raw = Math.hypot(near[0] - camera[0], near[1] - camera[1], dz);
    const floor = minScale(x, y, nodeSize);
    if (floor >= 1) return raw;
    const lower = surfScaledDistance(raw, floor);
    if (lower > limit) return lower;
    const scaled = (px: number, py: number) => surfScaledDistance(Math.hypot(px - camera[0], py - camera[1], dz), at(px, py));
    let low = scaled(near[0], near[1]);
    for (let b = 0; b < EXACT_SAMPLES; b++) for (let a = 0; a < EXACT_SAMPLES; a++) low = Math.min(low, scaled(x + (a / (EXACT_SAMPLES - 1)) * nodeSize, y + (b / (EXACT_SAMPLES - 1)) * nodeSize));
    return low;
  };
}

export function surfDetailScale(depth: number) {
  const surf = smoothstep(SURF_DETAIL.deep, SURF_DETAIL.shallow, depth) * smoothstep(SURF_DETAIL.dryOuter, SURF_DETAIL.dryInner, depth);
  return 1 + (SURF_DETAIL.scale - 1) * surf;
}

export const NODE_FLOATS = 8;
export const EDGE = { left: 1, right: 2, bottom: 4, top: 8 } as const;

export const OCEAN_LOD: LodSettings = { gridSize: 32, leafSize: 4, levels: 13, rangeFactor: 2.5, morphStartRatio: 0.66, maxNodes: 1500, waveBound: 25 };

export function lodTable(settings: LodSettings) {
  const ranges: number[] = [];
  const morph: [number, number, number][] = [];
  let previous = 0;
  for (let lod = 0; lod < settings.levels; lod++) {
    const range = settings.leafSize * 2 ** lod * settings.rangeFactor;
    const start = previous + (range - previous) * settings.morphStartRatio;
    ranges.push(range);
    morph.push([start, 1 / Math.max(1e-3, range - start), (settings.leafSize * 2 ** lod) / settings.gridSize]);
    previous = range;
  }
  return { ranges, morph };
}

type Box = { min: [number, number, number]; max: [number, number, number] };

const boxOf = (x: number, y: number, size: number, vertical: readonly [number, number]): Box => ({
  min: [x, y, vertical[0]],
  max: [x + size, y + size, vertical[1]],
});

function distanceSquared(box: Box, point: readonly number[]) {
  let sum = 0;
  for (let axis = 0; axis < 3; axis++) {
    const d = Math.max(box.min[axis] - point[axis], 0, point[axis] - box.max[axis]);
    sum += d * d;
  }
  return sum;
}

function visible(box: Box, planes: readonly Plane[]) {
  return planes.every(({ normal, distance }) => {
    const x = normal[0] >= 0 ? box.max[0] : box.min[0];
    const y = normal[1] >= 0 ? box.max[1] : box.min[1];
    const z = normal[2] >= 0 ? box.max[2] : box.min[2];
    return normal[0] * x + normal[1] * y + normal[2] * z + distance >= 0;
  });
}

export function selectNodes(settings: LodSettings, table: ReturnType<typeof lodTable>, view: View): number[] {
  const nodes: number[] = [];
  const vertical = [view.seaLevel - settings.waveBound, view.seaLevel + settings.waveBound] as const;
  const add =(x: number, y: number, size: number, lod: number) => {
    if (nodes.length / NODE_FLOATS >= settings.maxNodes) return;
    nodes.push(x, y, size, lod, ...table.morph[lod], 0);
  };
  const select = (x: number, y: number, size: number, lod: number): boolean => {
    const box = boxOf(x, y, size, vertical);
    const distance2 = view.scaledDistance ? view.scaledDistance(x, y, size, view.camera, vertical, table.ranges[lod]) ** 2 : distanceSquared(box, view.camera);
    if (distance2 > table.ranges[lod] ** 2) return false;
    if (!visible(box, view.planes)) return true;
    if (lod === 0 || distance2 > table.ranges[lod - 1] ** 2) {
      add(x, y, size, lod);
      return true;
    }
    const half = size / 2;
    for (const [cx, cy] of [[x, y], [x + half, y], [x, y + half], [x + half, y + half]]) {
      if (!select(cx, cy, half, lod - 1) && visible(boxOf(cx, cy, half, vertical), view.planes)) add(cx, cy, half, lod);
    }
    return true;
  };
  const top = settings.levels - 1;
  const rootSize = settings.leafSize * 2 ** top;
  const cellX = Math.floor(view.camera[0] / rootSize);
  const cellY = Math.floor(view.camera[1] / rootSize);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) select((cellX + i) * rootSize, (cellY + j) * rootSize, rootSize, top);
  return sortFrontToBack(nodes, view.camera);
}

function finerEdges(x: number, y: number, size: number, spacing: number, others: { x: number; y: number; size: number; spacing: number }[]) {
  const eps = 1e-4;
  let flags = 0;
  for (const o of others) {
    if (o.spacing >= spacing) continue;
    const overlapY = o.y < y + size - eps && o.y + o.size > y + eps;
    const overlapX = o.x < x + size - eps && o.x + o.size > x + eps;
    if (overlapY && Math.abs(o.x + o.size - x) < eps) flags |= EDGE.left;
    if (overlapY && Math.abs(o.x - (x + size)) < eps) flags |= EDGE.right;
    if (overlapX && Math.abs(o.y + o.size - y) < eps) flags |= EDGE.bottom;
    if (overlapX && Math.abs(o.y - (y + size)) < eps) flags |= EDGE.top;
  }
  return flags;
}

export function markFinerNeighbours(nodes: number[]) {
  const list: { x: number; y: number; size: number; spacing: number }[] = [];
  for (let i = 0; i < nodes.length; i += NODE_FLOATS) list.push({ x: nodes[i], y: nodes[i + 1], size: nodes[i + 2], spacing: nodes[i + 6] });
  list.forEach((n, k) => {
    nodes[k * NODE_FLOATS + 7] = finerEdges(n.x, n.y, n.size, n.spacing, list);
  });
}

function sortFrontToBack(nodes: number[], camera: readonly number[]) {
  const count = nodes.length / NODE_FLOATS;
  const order = Array.from({ length: count }, (_, i) => {
    const [x, y, size] = [nodes[i * NODE_FLOATS], nodes[i * NODE_FLOATS + 1], nodes[i * NODE_FLOATS + 2]];
    const dx = Math.max(x - camera[0], 0, camera[0] - x - size);
    const dy = Math.max(y - camera[1], 0, camera[1] - y - size);
    return { i, d: dx * dx + dy * dy };
  });
  order.sort((a, b) => a.d - b.d);
  return order.flatMap(({ i }) => nodes.slice(i * NODE_FLOATS, (i + 1) * NODE_FLOATS));
}
