import { crestAlong } from './crestAlong';

const GRAVITY = 9.81;

export interface ShoreDomain {
  heightsAt: (x: number, y: number) => readonly [ground: number, wave: number];
  origin: number;
  size: number;
  res: number;
  fieldRes: number;
  swellDir: readonly [number, number];
  travelSize?: number;
}

export interface ShoreFieldData {
  res: number;
  fieldRes: number;
  ground: Float32Array<ArrayBuffer>;
  field: Float32Array<ArrayBuffer>;
}

class MinHeap {
  keys: Float64Array;
  vals: Int32Array;
  size = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  push(key: number, value: number) {
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.vals[i] = this.vals[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.vals[i] = value;
  }

  pop() {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const value = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= key) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = key;
    this.vals[i] = value;
    return top;
  }
}

const MAX_DEPTH = 25;
const MIN_DEPTH = 0.25;

function sampleDepth(domain: ShoreDomain) {
  const { res, origin, size } = domain;
  const h = size / res;
  const depth = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      depth[j * res + i] = -domain.heightsAt(origin + (i + 0.5) * h, origin + (j + 0.5) * h)[1];
    }
  }
  const speed = new Float32Array(res * res);
  for (let k = 0; k < res * res; k++) {
    speed[k] = depth[k] > 0 ? Math.sqrt(GRAVITY * Math.min(Math.max(depth[k], MIN_DEPTH), MAX_DEPTH)) : 0;
  }
  return { depth, speed };
}

function arrivalTimes(domain: ShoreDomain, speed: Float32Array) {
  const { res, origin, size } = domain;
  const h = size / res;
  const T = new Float32Array(res * res).fill(Infinity);
  const state = new Uint8Array(res * res);
  const heap = new MinHeap(res * res * 4);
  const [sdx, sdz] = domain.swellDir;
  const c0 = Math.sqrt(GRAVITY * MAX_DEPTH);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      if (i !== 0 && j !== 0 && i !== res - 1 && j !== res - 1) continue;
      const k = j * res + i;
      if (speed[k] <= 0) continue;
      T[k] = ((origin + (i + 0.5) * h) * sdx + (origin + (j + 0.5) * h) * sdz) / c0 + size;
      state[k] = 1;
      heap.push(T[k], k);
    }
  }
  const known = (k: number) => (state[k] === 2 ? T[k] : Infinity);
  const solve = (i: number, j: number) => {
    const k = j * res + i;
    const f = h / speed[k];
    const tx = Math.min(i > 0 ? known(k - 1) : Infinity, i < res - 1 ? known(k + 1) : Infinity);
    const tz = Math.min(j > 0 ? known(k - res) : Infinity, j < res - 1 ? known(k + res) : Infinity);
    const a = Math.min(tx, tz);
    const b = Math.max(tx, tz);
    if (!Number.isFinite(b) || b - a >= f) return a + f;
    return 0.5 * (a + b + Math.sqrt(2 * f * f - (a - b) * (a - b)));
  };
  while (heap.size > 0) {
    const k = heap.pop();
    if (state[k] === 2) continue;
    state[k] = 2;
    const i = k % res;
    const j = (k / res) | 0;
    for (const [ni, nj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue;
      const nk = nj * res + ni;
      if (state[nk] === 2 || speed[nk] <= 0) continue;
      const t = solve(ni, nj);
      if (t < T[nk]) {
        T[nk] = t;
        state[nk] = 1;
        heap.push(t, nk);
      }
    }
  }
  return T;
}

function extendOntoLand(F: Float32Array, res: number, passes: number, increment: number) {
  const prev = new Float32Array(F.length);
  for (let pass = 0; pass < passes; pass++) {
    prev.set(F);
    let changed = false;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        if (Number.isFinite(prev[k])) continue;
        let sum = 0;
        let n = 0;
        for (const nk of [i > 0 ? k - 1 : -1, i < res - 1 ? k + 1 : -1, j > 0 ? k - res : -1, j < res - 1 ? k + res : -1]) {
          if (nk >= 0 && Number.isFinite(prev[nk])) {
            sum += prev[nk];
            n++;
          }
        }
        if (n > 0) {
          F[k] = sum / n + increment;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function smoothPhase(T: Float32Array, res: number) {
  let current = T;
  for (let it = 0; it < 3; it++) {
    const out = new Float32Array(res * res);
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        if (!Number.isFinite(current[k])) {
          out[k] = current[k];
          continue;
        }
        let sum = current[k] * 4;
        let w = 4;
        for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue;
          const v = current[nj * res + ni];
          if (Number.isFinite(v)) {
            sum += v;
            w++;
          }
        }
        out[k] = sum / w;
      }
    }
    current = out;
  }
  return current;
}

function boxBlur(src: Float32Array, res: number, radius: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const clampIndex = (v: number) => Math.min(res - 1, Math.max(0, v));
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) sum += src[j * res + clampIndex(i + o)];
      tmp[j * res + i] = sum / (2 * radius + 1);
    }
  }
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) sum += tmp[clampIndex(j + o) * res + i];
      out[j * res + i] = sum / (2 * radius + 1);
    }
  }
  return out;
}

function swellShelter(depth: Float32Array, domain: ShoreDomain) {
  const { res } = domain;
  const [sdx, sdz] = domain.swellDir;
  const sl = Math.hypot(sdx, sdz);
  const open = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      let x = i + 0.5;
      let z = j + 0.5;
      let clear = 1;
      while (x >= 0 && z >= 0 && x < res && z < res) {
        if (depth[Math.floor(z) * res + Math.floor(x)] <= 0) {
          clear = 0;
          break;
        }
        x -= sdx / sl;
        z -= sdz / sl;
      }
      open[j * res + i] = clear;
    }
  }
  return boxBlur(boxBlur(open, res, 2), res, 2);
}

function packField(Ts: Float32Array, Tshore: Float32Array, domain: ShoreDomain, shelter: Float32Array) {
  const { res } = domain;
  const [sdx, sdz] = domain.swellDir;
  const sl = Math.hypot(sdx, sdz);
  const data = new Float32Array(res * res * 4);
  const diff = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? a - b : 0);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const t = Ts[k];
      const tl = i > 0 ? Ts[k - 1] : t;
      const tr = i < res - 1 ? Ts[k + 1] : t;
      const td = j > 0 ? Ts[k - res] : t;
      const tu = j < res - 1 ? Ts[k + res] : t;
      let gx = diff(tr, tl);
      let gz = diff(tu, td);
      if (gx === 0 && Number.isFinite(tr) && Number.isFinite(t)) gx = tr - t;
      if (gz === 0 && Number.isFinite(tu) && Number.isFinite(t)) gz = tu - t;
      const len = Math.hypot(gx, gz) || 1;
      const dx = gx / len;
      const dz = gz / len;
      const exposure = Math.min(1, Math.max(0.02, (((dx * sdx + dz * sdz) / sl) * 1.4 + 0.1) * shelter[k]));
      data[k * 4] = Number.isFinite(t) ? t : 1e5;
      data[k * 4 + 1] = dx * exposure;
      data[k * 4 + 2] = dz * exposure;
      data[k * 4 + 3] = Number.isFinite(Tshore[k]) ? Tshore[k] : Number.isFinite(t) ? t : 1e5;
    }
  }
  return data;
}

function travelGrid(domain: ShoreDomain) {
  const cell = domain.size / domain.fieldRes;
  const pad = Math.max(0, Math.round(((domain.travelSize ?? domain.size) - domain.size) / 2 / cell));
  const res = domain.fieldRes + 2 * pad;
  return { grid: { ...domain, origin: domain.origin - pad * cell, size: res * cell, res }, pad };
}

function cropField(data: Float32Array, travelRes: number, pad: number, res: number) {
  const out = new Float32Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    const from = ((j + pad) * travelRes + pad) * 4;
    out.set(data.subarray(from, from + res * 4), j * res * 4);
  }
  return out;
}

function travelField(domain: ShoreDomain) {
  const { grid, pad } = travelGrid(domain);
  const { depth, speed } = sampleDepth(grid);
  const T = arrivalTimes(grid, speed);
  const Tshore = new Float32Array(T);
  extendOntoLand(Tshore, grid.res, 40, 0);
  const Tfilled = new Float32Array(T);
  extendOntoLand(Tfilled, grid.res, 24, grid.size / grid.res / 1.5);
  const Ts = smoothPhase(Tfilled, grid.res);
  const field = cropField(packField(Ts, Tshore, grid, swellShelter(depth, grid)), grid.res, pad, domain.fieldRes);
  return { field, along: crestAlong(field, domain.fieldRes, domain.size / domain.fieldRes) };
}

function sampleCoarse(values: ArrayLike<number>, coarseRes: number, u: number, v: number) {
  const fx = Math.min(Math.max(u * coarseRes - 0.5, 0), coarseRes - 1.001);
  const fy = Math.min(Math.max(v * coarseRes - 0.5, 0), coarseRes - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const at = (a: number, b: number) => values[b * coarseRes + a];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

export function computeShoreField(domain: ShoreDomain): ShoreFieldData {
  const { res } = domain;
  const ground = new Float32Array(res * res * 4);
  const h = domain.size / res;
  const { field, along } = travelField(domain);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const [land, wave] = domain.heightsAt(domain.origin + (i + 0.5) * h, domain.origin + (j + 0.5) * h);
      ground[k * 4] = land;
      ground[k * 4 + 1] = wave;
      ground[k * 4 + 2] = sampleCoarse(along, domain.fieldRes, (i + 0.5) / res, (j + 0.5) / res);
    }
  }
  return { res, fieldRes: domain.fieldRes, ground, field };
}
