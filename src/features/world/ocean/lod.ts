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
}

export const NODE_FLOATS = 7;

export const OCEAN_LOD: LodSettings = { gridSize: 32, leafSize: 8, levels: 12, rangeFactor: 2.5, morphStartRatio: 0.66, maxNodes: 1500, waveBound: 25 };

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
    nodes.push(x, y, size, lod, ...table.morph[lod]);
  };
  const select = (x: number, y: number, size: number, lod: number): boolean => {
    const box = boxOf(x, y, size, vertical);
    if (distanceSquared(box, view.camera) > table.ranges[lod] ** 2) return false;
    if (!visible(box, view.planes)) return true;
    if (lod === 0 || distanceSquared(box, view.camera) > table.ranges[lod - 1] ** 2) {
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
