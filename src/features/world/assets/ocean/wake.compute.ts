import { defineCompute, params, texture } from '../../../../shared/compute';
import { COMPUTE_ACCESS, shoreMath } from './oceanShore';
import { CASCADE_SIZES } from './oceanSpectrum';
import { WAKE_CELL, WAKE_RES, WAKE_SIZE } from './wakeSpec';

const N = WAKE_RES;
const HALF = N / 2;
const MASK = N - 1;
const LOG2N = Math.log2(N);
const DEPTHS = [Infinity, 6, 1.8, 0.6] as const;
const SPONGE = 22;
const REFERENCE_CELL = 0.4;
const GRAVITY = 9.81;
const FLUX_STABILITY = 0.9;
const NYQUIST_OMEGA2 = (GRAVITY * Math.SQRT2 * Math.PI) / WAKE_CELL;
const num = (value: number) => value.toFixed(8);
const CELL2 = num(WAKE_CELL * WAKE_CELL);
const TURB_SCALE = num((WAKE_CELL / REFERENCE_CELL) ** 2);

const BASE = `
uint WakeBrev(uint v) { return reversebits(v) >> ${32 - LOG2N}u; }
float WakeHash(int ix, int iy) {
  uint v = (uint(ix) * 0x8da6b343u) ^ (uint(iy) * 0xd8163841u);
  v = (v ^ (v >> 13u)) * 0x5bd1e995u; v = v ^ (v >> 15u);
  return float(v >> 8u) * (1.0 / 16777216.0);
}
float WakeNoise(float2 q) {
  float2 i = floor(q); float2 fr = frac(q); float2 u = fr * fr * (3.0 - 2.0 * fr);
  int ix = int(i.x); int iy = int(i.y);
  return lerp(lerp(WakeHash(ix, iy), WakeHash(ix + 1, iy), u.x), lerp(WakeHash(ix, iy + 1), WakeHash(ix + 1, iy + 1), u.x), u.y);
}
float4 WakeDepthWeights(float d) {
  float t0 = 1.0 - exp((d - 6.0) / -9.0);
  float t1 = pow(saturate((d - 1.8) / 4.2), 0.8);
  float t2 = pow(saturate((d - 0.6) / 1.2), 0.85);
  float w0 = d > 6.0 ? t0 : 0.0;
  float w1 = d > 6.0 ? 1.0 - t0 : (d > 1.8 ? t1 : 0.0);
  float w2 = d > 6.0 ? 0.0 : (d > 1.8 ? 1.0 - t1 : (d > 0.6 ? t2 : 0.0));
  float w3 = d > 1.8 ? 0.0 : (d > 0.6 ? 1.0 - t2 : saturate(d / 0.6));
  return sqrt(float4(w0, w1, w2, w3));
}
float4 WakeCmul(float4 b, float2 w) { return float4(b.x * w.x - b.y * w.y, b.x * w.y + b.y * w.x, b.z * w.x - b.w * w.y, b.z * w.y + b.w * w.x); }
`;

const WORLD = `
${BASE}
${shoreMath(CASCADE_SIZES, COMPUTE_ACCESS)}
int WakeWorldIndex(int i, int o) { return o + ((i - o) & ${MASK}); }
bool WakeInWindow(int I, int J, float2 o) { return I >= int(o.x) && I < int(o.x) + ${N} && J >= int(o.y) && J < int(o.y) + ${N}; }
float2 WakeCellPos(uint c, uint r) {
  float4 win = Window();
  return float2(float(WakeWorldIndex(int(c), int(win.x))) + 0.5, float(WakeWorldIndex(int(r), int(win.y))) + 0.5) * ${num(WAKE_CELL)};
}
float WakeDepth(float2 p) { OceanShoreMath math; math.time = 0.0; math.enabled = 1.0; return -math.HeightAt(0, p); }
`;

const stages = (shared: string, bases: readonly number[], dir: number) => `
[unroll] for (uint s = 0u; s < ${LOG2N}u; s++) {
  uint halfSize = 1u << s; uint pos = t & (halfSize - 1u);
  uint i0 = ((t >> s) << (s + 1u)) | pos;
  float ang = float(pos) * (${num(dir * Math.PI)} / float(halfSize)); float2 w = float2(cos(ang), sin(ang));
${bases.map((base) => `  { uint i = i0 + ${base}u; uint j = i + halfSize; float4 a = ${shared}[i]; float4 bw = WakeCmul(${shared}[j], w); ${shared}[i] = a + bw; ${shared}[j] = a - bw; }`).join('\n')}
  GroupMemoryBarrierWithGroupSync();
}`;

const LOAD_STATE = `
float4 WakeLoadState(uint c, uint r) {
  float4 win = Window(); float4 step = Step();
  int I = WakeWorldIndex(int(c), int(win.x)); int J = WakeWorldIndex(int(r), int(win.y));
  bool keep = WakeInWindow(I, J, win.zw) && step.y < 0.5;
  float4 v = keep ? StateLoad(int2(c, r)) : float4(0.0, 0.0, 0.0, 0.0);
  return all(isfinite(v)) ? v : float4(0.0, 0.0, 0.0, 0.0);
}
float WakeLegPressure(float2 p, float4 leg) {
  if (leg.z <= 0.0) return 0.0;
  float2 d = p - leg.xy;
  return leg.z * exp(-dot(d, d) / (leg.w * leg.w));
}
`;

const CELL_PHYSICS = `
float4 WakeCell(uint col, uint row) {
  float4 step = Step();
  float dt = step.x; float time = step.z;
  uint idx = row * ${N}u + col;
  float2 p = WakeCellPos(col, row);
  float4 s = WakeLoadState(col, row);
  uint cL = (col + ${MASK}u) & ${MASK}u; uint cR = (col + 1u) & ${MASK}u;
  uint rD = (row + ${MASK}u) & ${MASK}u; uint rU = (row + 1u) & ${MASK}u;
  float4 sL = WakeLoadState(cL, row); float4 sR = WakeLoadState(cR, row);
  float4 sD = WakeLoadState(col, rD); float4 sU = WakeLoadState(col, rU);
  float d = WakeDepth(p);
  float P = WakeLegPressure(p, LegA()) + WakeLegPressure(p, LegB());
  float h = step.y > 0.5 ? -P : s.x;
  float w = s.y;
  float gx = (sR.x - sL.x) / ${num(2 * WAKE_CELL)}; float gz = (sU.x - sD.x) / ${num(2 * WAKE_CELL)};
  float slope = length(float2(gx, gz));
  float wet = smoothstep(0.0, 0.05, d);
  float brk = saturate((slope - 0.2) / 0.2) * (1.0 - smoothstep(0.0, 0.03, P));
  float surf = saturate((h - d * 0.42) / max(d * 0.3, 0.03)) * wet;
  float turb = s.w;
  float visc = Source().x;
  float nuC = min(turb * 0.6, 1.0) * ${TURB_SCALE} + visc;
  float flux = ((nuC + min(sL.w * 0.6, 1.0) * ${TURB_SCALE} + visc) * (sL.y - w)
    + (nuC + min(sR.w * 0.6, 1.0) * ${TURB_SCALE} + visc) * (sR.y - w)
    + (nuC + min(sD.w * 0.6, 1.0) * ${TURB_SCALE} + visc) * (sD.y - w)
    + (nuC + min(sU.w * 0.6, 1.0) * ${TURB_SCALE} + visc) * (sU.y - w)) * (0.5 / ${CELL2});
  float boil = 0.0;
  if (turb + sL.w + sR.w + sD.w + sU.w > 0.02) {
    float2 drift = float2(time * 0.5, time * -0.35);
    float2 nq = p * ${num(0.45 * REFERENCE_CELL / WAKE_CELL)};
    float2 dq = float2(${num(0.45 * REFERENCE_CELL)}, 0.0);
    float c0 = (WakeNoise(nq + drift) - 0.5) * min(turb, 1.5);
    boil = (WakeNoise(nq - dq.xy + drift) - 0.5) * min(sL.w, 1.5) + (WakeNoise(nq + dq.xy + drift) - 0.5) * min(sR.w, 1.5)
      + (WakeNoise(nq - dq.yx + drift) - 0.5) * min(sD.w, 1.5) + (WakeNoise(nq + dq.yx + drift) - 0.5) * min(sU.w, 1.5) - c0 * 4.0;
    boil *= ${TURB_SCALE};
  }
  float waveTerm = dt * dt * ${num(NYQUIST_OMEGA2)};
  float fluxStep = min(dt, ${num(FLUX_STABILITY)} * (4.0 - waveTerm) * 0.25 * ${CELL2} / (4.0 * (${TURB_SCALE} + visc)));
  float w1 = (w + flux * fluxStep + boil * (dt * Source().y)) * exp(dt * -0.006) * wet;
  float lapF = (sL.z + sR.z + sD.z + sU.z - s.z * 4.0) / ${CELL2};
  float f0 = max(s.z + lapF * min(dt * (turb * 0.3 + 0.04) * ${TURB_SCALE}, ${num(0.2 * WAKE_CELL * WAKE_CELL)}), 0.0);
  float legChurn = smoothstep(0.004, 0.03, P) * Source().w;
  float gen = (brk * 3.0 + surf * 4.0 + legChurn * 6.0) * Source().z;
  float breakup = WakeNoise(p * 0.17 + float2(13.1, 7.3)) * 0.65 + WakeNoise(p * 0.55 + float2(3.7, 1.9)) * 0.35;
  float clr = smoothstep(0.3, 0.72, breakup) * 2.6 + 0.2;
  float foam = min(f0 * exp(-dt * (f0 * f0 * 0.6 + clr / 35.0)) + gen * dt, 3.0);
  float turb1 = min(turb * exp(dt * (-1.0 / 6.0)) + (brk * 4.0 + surf * 6.0 + legChurn * 3.0) * dt, 3.0);
  ScratchStore(int2(col, row), float4(h, w1, foam, turb1));
  DisplayStore(int2(col, row), float4(h, gx, gz, foam));
  return WakeDepthWeights(d) * (h + P);
}
`;

const dk = (2 * Math.PI) / WAKE_SIZE;
const norm = 1 / (N * N);
const L = DEPTHS.map((D) => `${D === Infinity ? 'k' : `k * tanh(min(k * ${num(D)}, 12.0))`} * ${num(norm)}`);

export const oceanWakeRows = defineCompute({
  resources: { Ground: texture(), Field: texture(), State: texture(), Scratch: texture(), Spec: texture(), Display: texture(), Wake: params('Window', 'Step', 'LegA', 'LegB', 'Source') },
  kernels: {
    WakeRows: {
      group: [HALF, 1, 1],
      threads: [HALF * N, 1, 1],
      uses: ['Ground', 'Field', 'State', 'Scratch', 'Spec', 'Display', 'Wake'],
      shared: `${WORLD}${LOAD_STATE}${CELL_PHYSICS}\ngroupshared float4 WakeRow[${N}];`,
      body: `uint t = GTid.x; uint row = Gid.x;
for (uint e = 0u; e < 2u; e++) { uint col = t + e * ${HALF}u; float4 v = WakeCell(col, row); WakeRow[WakeBrev(col)] = float4(v.x, v.y, v.z, v.w); }
GroupMemoryBarrierWithGroupSync();
${stages('WakeRow', [0], -1)}
for (uint e2 = 0u; e2 < 2u; e2++) { uint col = t + e2 * ${HALF}u; SpecStore(int2(col, row), WakeRow[col]); }`,
    },
  },
});

export const oceanWakeColumns = defineCompute({
  resources: { Spec: texture(), Wake: params('Window', 'Step', 'LegA', 'LegB', 'Source') },
  kernels: {
    WakeColumns: {
      group: [HALF, 1, 1],
      threads: [HALF * (HALF + 1), 1, 1],
      uses: ['Spec', 'Wake'],
      shared: `${BASE}\ngroupshared float4 WakeCol[${N * 2}];
float4 WakeApply(float4 Z, float4 Zm, float2 p, float2 m) { return float4(Z.x * p.x + Zm.x * m.x, Z.y * p.x - Zm.y * m.x, Z.z * p.y + Zm.z * m.y, Z.w * p.y - Zm.w * m.y); }`,
      body: `uint t = GTid.x; uint cA = Gid.x; uint cB = (${N}u - cA) & ${MASK}u;
for (uint e = 0u; e < 2u; e++) { uint r = t + e * ${HALF}u; uint rb = WakeBrev(r); WakeCol[rb] = SpecLoad(int2(cA, r)); WakeCol[rb + ${N}u] = SpecLoad(int2(cB, r)); }
GroupMemoryBarrierWithGroupSync();
${stages('WakeCol', [0, N], -1)}
float fx = float(cA < ${HALF}u ? int(cA) : int(cA) - ${N}) * ${num(dk)};
float4 outs[4];
for (uint e2 = 0u; e2 < 2u; e2++) {
  uint r = t + e2 * ${HALF}u; uint rm = (${N}u - r) & ${MASK}u;
  float fz = float(r < ${HALF}u ? int(r) : int(r) - ${N}) * ${num(dk)};
  float k = length(float2(fx, fz));
  float L0 = ${L[0]}; float L1 = ${L[1]}; float L2 = ${L[2]}; float L3 = ${L[3]};
  float2 pp = float2(L0 + L1, L2 + L3) * 0.5; float2 mm = float2(L0 - L1, L2 - L3) * 0.5;
  outs[e2 * 2u] = WakeApply(WakeCol[r], WakeCol[rm + ${N}u], pp, mm);
  outs[e2 * 2u + 1u] = WakeApply(WakeCol[r + ${N}u], WakeCol[rm], pp, mm);
}
GroupMemoryBarrierWithGroupSync();
for (uint e3 = 0u; e3 < 2u; e3++) { uint rb = WakeBrev(t + e3 * ${HALF}u); WakeCol[rb] = outs[e3 * 2u]; WakeCol[rb + ${N}u] = outs[e3 * 2u + 1u]; }
GroupMemoryBarrierWithGroupSync();
${stages('WakeCol', [0, N], 1)}
for (uint e4 = 0u; e4 < 2u; e4++) { uint r = t + e4 * ${HALF}u; SpecStore(int2(cA, r), WakeCol[r]); if (cB != cA) SpecStore(int2(cB, r), WakeCol[r + ${N}u]); }`,
    },
  },
});

export const oceanWakeInverse = defineCompute({
  resources: { Ground: texture(), Field: texture(), State: texture(), Scratch: texture(), Spec: texture(), Wake: params('Window', 'Step', 'LegA', 'LegB', 'Source') },
  kernels: {
    WakeInverse: {
      group: [HALF, 1, 1],
      threads: [HALF * N, 1, 1],
      uses: ['Ground', 'Field', 'State', 'Scratch', 'Spec', 'Wake'],
      shared: `${WORLD}\ngroupshared float4 WakeInv[${N}];`,
      body: `uint t = GTid.x; uint row = Gid.x; float dt = Step().x; float4 win = Window();
for (uint e = 0u; e < 2u; e++) { uint col = t + e * ${HALF}u; WakeInv[WakeBrev(col)] = SpecLoad(int2(col, row)); }
GroupMemoryBarrierWithGroupSync();
${stages('WakeInv', [0], 1)}
float rl = float((int(row) - int(win.y)) & ${MASK}) + 0.5;
float ez = min(rl, ${N}.0 - rl);
for (uint e2 = 0u; e2 < 2u; e2++) {
  uint col = t + e2 * ${HALF}u; uint idx = row * ${N}u + col;
  float4 Y = WakeInv[col]; float4 sc = ScratchLoad(int2(col, row));
  float d = WakeDepth(WakeCellPos(col, row));
  float Lu = dot(WakeDepthWeights(d), Y);
  float w1 = sc.y - Lu * (dt * ${num(GRAVITY)});
  float h1 = sc.x + w1 * dt;
  float cl = float((int(col) - int(win.x)) & ${MASK}) + 0.5;
  float edge = min(min(cl, ${N}.0 - cl), ez);
  float sig = smoothstep(${num(SPONGE)}, 0.0, edge);
  float k = exp(dt * (sig * sig * -6.0));
  StateStore(int2(col, row), float4(h1 * k, w1 * k, sc.z, sc.w));
}`,
    },
  },
});
