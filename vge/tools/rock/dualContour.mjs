const REGULARIZE = 0.3;
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function solve3(m, b) {
  const [a, bb, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return [0, 0, 0];
  const inv = [e * i - f * h, c * h - bb * i, bb * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, bb * g - a * h, a * e - bb * d];
  return [0, 1, 2].map((row) => (inv[row * 3] * b[0] + inv[row * 3 + 1] * b[1] + inv[row * 3 + 2] * b[2]) / det);
}

function grid({ origin, cells, cellSize, sample, column }) {
  const count = cells + 3;
  const values = new Float32Array(count ** 3);
  const beds = new Int16Array(count ** 3);
  const cracks = new Float32Array(count ** 3);
  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = origin[0] + (i - 1) * cellSize;
      const y = origin[1] + (j - 1) * cellSize;
      const columnAt = column(x, y);
      for (let k = 0; k < count; k++) {
        const s = sample(x, y, origin[2] + (k - 1) * cellSize, columnAt);
        const index = (k * count + j) * count + i;
        values[index] = s.value;
        beds[index] = s.bed;
        cracks[index] = s.crack;
      }
    }
  }
  return { count, values, beds, cracks };
}

function gradientAt(field, p, step) {
  const at = (x, y, z) => field(x, y, z).value;
  const g = [at(p[0] + step, p[1], p[2]) - at(p[0] - step, p[1], p[2]), at(p[0], p[1] + step, p[2]) - at(p[0], p[1] - step, p[2]), at(p[0], p[1], p[2] + step) - at(p[0], p[1], p[2] - step)];
  const length = Math.hypot(...g) || 1;
  return g.map((v) => v / length);
}

function cellVertex(context, ci, cj, ck) {
  const { data, options, field } = context;
  const { count, values } = data;
  const corner = ([dx, dy, dz]) => ((ck + 1 + dz) * count + (cj + 1 + dy)) * count + (ci + 1 + dx);
  const signs = CORNERS.map((c) => values[corner(c)] < 0);
  if (signs.every((s) => s === signs[0])) return null;
  const ata = new Array(9).fill(0);
  const points = [];
  const normals = [];
  for (const [a, b] of EDGES) {
    if (signs[a] === signs[b]) continue;
    const va = values[corner(CORNERS[a])];
    const t = va / (va - values[corner(CORNERS[b])]);
    const local = [0, 1, 2].map((axis) => CORNERS[a][axis] + (CORNERS[b][axis] - CORNERS[a][axis]) * t);
    const world = local.map((v, axis) => options.origin[axis] + ([ci, cj, ck][axis] + v) * options.cellSize);
    points.push(local);
    normals.push(gradientAt(field, world, options.cellSize * 0.35));
  }
  const mass = [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
  const atb = [0, 0, 0];
  points.forEach((p, n) => {
    const normal = normals[n];
    const offset = normal[0] * (p[0] - mass[0]) + normal[1] * (p[1] - mass[1]) + normal[2] * (p[2] - mass[2]);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) ata[r * 3 + c] += normal[r] * normal[c];
      atb[r] += normal[r] * offset;
    }
  });
  for (let r = 0; r < 3; r++) ata[r * 4] += REGULARIZE;
  const shift = solve3(ata, atb);
  const local = mass.map((m, axis) => Math.min(1, Math.max(0, m + shift[axis])));
  return local.map((v, axis) => options.origin[axis] + ([ci, cj, ck][axis] + v) * options.cellSize);
}

function quadCells(axis, i, j, k) {
  if (axis === 0) return [[i, j - 1, k - 1], [i, j, k - 1], [i, j, k], [i, j - 1, k]];
  if (axis === 1) return [[i - 1, j, k - 1], [i - 1, j, k], [i, j, k], [i, j, k - 1]];
  return [[i - 1, j - 1, k], [i, j - 1, k], [i, j, k], [i - 1, j, k]];
}

export function contourChunk(options) {
  const data = grid(options);
  const context = { data, options, field: (x, y, z) => options.sample(x, y, z, options.column(x, y)) };
  const vertexIndex = new Map();
  const mesh = { positions: [], normals: [], colors: [], indices: [] };
  const vertexOf = ([ci, cj, ck]) => {
    const key = `${ci},${cj},${ck}`;
    if (vertexIndex.has(key)) return vertexIndex.get(key);
    const position = cellVertex(context, ci, cj, ck);
    if (!position) return -1;
    const sample = context.field(...position);
    mesh.positions.push(...position);
    mesh.normals.push(...gradientAt(context.field, position, options.cellSize * 0.5));
    mesh.colors.push(sample.crack, (((sample.bed % 8) + 8) % 8) / 7, Math.min(1, Math.max(0, position[2] / 2500)), 1);
    vertexIndex.set(key, mesh.positions.length / 3 - 1);
    return vertexIndex.get(key);
  };
  const { count, values } = data;
  const value = (i, j, k) => values[((k + 1) * count + (j + 1)) * count + (i + 1)];
  for (let k = 0; k < options.cells; k++) {
    for (let j = 0; j < options.cells; j++) {
      for (let i = 0; i < options.cells; i++) {
        const inside = value(i, j, k) < 0;
        for (let axis = 0; axis < 3; axis++) {
          const next = [i + (axis === 0), j + (axis === 1), k + (axis === 2)];
          if (inside === value(...next) < 0) continue;
          const corners = quadCells(axis, i, j, k).map(vertexOf);
          if (corners.includes(-1)) continue;
          const [a, b, c, d] = inside ? corners : [...corners].reverse();
          mesh.indices.push(a, b, c, a, c, d);
        }
      }
    }
  }
  return mesh;
}
