const OPEN_WEIGHT = 1;
const DRY_WEIGHT = 1e-3;
const PIN = 1e-6;
const MAX_ITERATIONS = 4000;
const TOLERANCE = 1e-6;

interface CrestEdges {
  weightX: Float32Array;
  weightY: Float32Array;
  stepX: Float32Array;
  stepY: Float32Array;
}

function crestEdges(field: Float32Array, res: number, cell: number): CrestEdges {
  const tangentX = new Float32Array(res * res);
  const tangentY = new Float32Array(res * res);
  const weight = new Float32Array(res * res);
  for (let k = 0; k < res * res; k++) {
    const ex = field[k * 4 + 1];
    const ey = field[k * 4 + 2];
    const length = Math.hypot(ex, ey);
    weight[k] = length > 1e-3 ? OPEN_WEIGHT : DRY_WEIGHT;
    tangentX[k] = length > 1e-3 ? -ey / length : 0;
    tangentY[k] = length > 1e-3 ? ex / length : 0;
  }
  const edges = { weightX: new Float32Array(res * res), weightY: new Float32Array(res * res), stepX: new Float32Array(res * res), stepY: new Float32Array(res * res) };
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      if (i < res - 1) {
        edges.weightX[k] = Math.min(weight[k], weight[k + 1]);
        edges.stepX[k] = (cell * (tangentX[k] + tangentX[k + 1])) / 2;
      }
      if (j < res - 1) {
        edges.weightY[k] = Math.min(weight[k], weight[k + res]);
        edges.stepY[k] = (cell * (tangentY[k] + tangentY[k + res])) / 2;
      }
    }
  }
  return edges;
}

function applyNormal(edges: CrestEdges, res: number, a: Float64Array, out: Float64Array) {
  for (let k = 0; k < res * res; k++) out[k] = PIN * a[k];
  for (let k = 0; k < res * res; k++) {
    const wx = edges.weightX[k];
    if (wx > 0) {
      const d = wx * (a[k] - a[k + 1]);
      out[k] += d;
      out[k + 1] -= d;
    }
    const wy = edges.weightY[k];
    if (wy > 0) {
      const d = wy * (a[k] - a[k + res]);
      out[k] += d;
      out[k + res] -= d;
    }
  }
}

function normalSides(edges: CrestEdges, res: number) {
  const rhs = new Float32Array(res * res);
  const diagonal = new Float32Array(res * res).fill(PIN);
  for (let k = 0; k < res * res; k++) {
    const wx = edges.weightX[k];
    if (wx > 0) {
      rhs[k] -= wx * edges.stepX[k];
      rhs[k + 1] += wx * edges.stepX[k];
      diagonal[k] += wx;
      diagonal[k + 1] += wx;
    }
    const wy = edges.weightY[k];
    if (wy > 0) {
      rhs[k] -= wy * edges.stepY[k];
      rhs[k + res] += wy * edges.stepY[k];
      diagonal[k] += wy;
      diagonal[k + res] += wy;
    }
  }
  return { rhs, diagonal };
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let sum = 0;
  for (let k = 0; k < a.length; k++) sum += a[k] * b[k];
  return sum;
};

export function crestAlong(field: Float32Array, res: number, cell: number) {
  const edges = crestEdges(field, res, cell);
  const { rhs, diagonal } = normalSides(edges, res);
  const a = new Float64Array(res * res);
  const r = new Float64Array(rhs);
  const z = r.map((v, k) => v / diagonal[k]);
  const p = new Float64Array(z);
  const q = new Float64Array(res * res);
  let rz = dot(r, z);
  const stop = TOLERANCE * TOLERANCE * dot(rhs, rhs);
  for (let it = 0; it < MAX_ITERATIONS && dot(r, r) > stop; it++) {
    applyNormal(edges, res, p, q);
    const alpha = rz / dot(p, q);
    for (let k = 0; k < a.length; k++) {
      a[k] += alpha * p[k];
      r[k] -= alpha * q[k];
      z[k] = r[k] / diagonal[k];
    }
    const next = dot(r, z);
    const beta = next / rz;
    rz = next;
    for (let k = 0; k < a.length; k++) p[k] = z[k] + beta * p[k];
  }
  return a;
}
