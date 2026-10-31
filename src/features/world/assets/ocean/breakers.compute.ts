import { defineCompute, params, texture } from '../../../../shared/compute';
import { COMPUTE_ACCESS, SHORE, shoreMath } from './oceanShore';
import { BREAKER_CAPACITY, CREST_COLUMNS, CREST_TEXELS, LIP_GONE, LIP_LINK_GAP, LIP_LINK_JUMP, LIP_SMOOTH_STATIONS, LIP_TAPER_STATIONS, STATION_RES } from './breakerSpec';
import { CASCADE_SIZES, GRAVITY } from './oceanSpectrum';
import { CASCADE_DISPLACEMENT, CASCADE_TEXTURE_NAMES } from './oceanCascades';
import { BREAKER_SPRAY_CREST } from './breakerSprayHlsl';
const TRANSECT_STEP = 2;
const TRANSECT_SAMPLES = 64;
const BACK_OFFSET = 0.4;
const num = (value: number) => value.toFixed(6);

const SHARED = `
${shoreMath(CASCADE_SIZES, COMPUTE_ACCESS)}
${CASCADE_DISPLACEMENT}
${BREAKER_SPRAY_CREST}
int2 BreakerCrestTexel(uint i, uint slot, uint n) {
  return int2((i % ${CREST_COLUMNS}u) * ${CREST_TEXELS}u + slot * 3u + n, i / ${CREST_COLUMNS}u);
}
void BreakerProcessCrest(OceanShoreMath math, uint i, float2 pc, float m, inout uint occurrence, inout float emitted) {
  OceanShorePhase ph = math.PhaseAt(0, 1, pc);
  float depth = -math.WaveHeightAt(0, pc);
  float A = math.WaveAmp(m, ph.along);
  OceanShoreBreak P = math.BreakParams(A, depth, math.AlongTaps(m, ph.along, depth));
  float env = smoothstep(26.0, 13.0, depth) * saturate(ph.exposure * 1.4);
  if (P.b > -0.6 && env > 0.3 && depth > 0.12) {
    float lam = sqrt(clamp(depth, 0.3, 25.0) * ${num(GRAVITY)}) * ${num(SHORE.period)};
    OceanShoreProfile s0 = math.Profile(0.0, lam, P, false);
    OceanShoreProfile s1 = math.Profile(${num(BACK_OFFSET)} / lam, lam, P, false);
    float3 fd = BreakerFftDisp(math, pc, -math.HeightAt(0, pc));
    float3 d3 = float3(ph.dir.x, 0.0, ph.dir.y);
    float3 rest = float3(pc.x, 0.0, pc.y);
    float3 root = rest + d3 * (s0.x * env) + float3(0.0, s0.y * env, 0.0) + fd;
    float3 back = rest + d3 * (s1.x * env - ${num(BACK_OFFSET)}) + float3(0.0, s1.y * env, 0.0) + fd;
    float trough = P.ytB * env + fd.y;
    uint slot = uint(m - floor(m * 0.5) * 2.0);
    float id = m - floor(m / 1024.0) * 1024.0 + 1.0;
    CrestStore(BreakerCrestTexel(i, slot, 0u), float4(root, P.b));
    CrestStore(BreakerCrestTexel(i, slot, 1u), float4(back, P.H * env));
    CrestStore(BreakerCrestTexel(i, slot, 2u), float4(ph.dir, trough, id));
    float c = sqrt(clamp(depth, 0.3, 25.0) * ${num(GRAVITY)});
    float H = P.H * env;
    BreakerSprayCounts counts = BreakerSprayCount(i, root, ph.dir, P.b, H, m, depth, P.Hb);
    BreakerSprayRecord(i, occurrence, emitted, float4(root, P.b), float4(ph.dir, trough, H), float4(c, m, depth, float(slot)), float4(P.Hb, P.Wt, P.Xc, P.wBore), counts);
  }
}
float BreakerPhase(OceanShoreMath math, float2 p) { return math.PhaseAt(0, 1, p).s; }
`;

const BODY = `uint i = DTid.x;
float4 control = Control();
if (i >= uint(control.y)) return;
OceanShoreMath math; math.time = control.x; math.enabled = 1.0;
float4 st = StationsLoad(int2(i % ${STATION_RES}u, i / ${STATION_RES}u));
float2 o = st.xy; float2 n = st.zw;
CrestStore(BreakerCrestTexel(i, 0u, 2u), float4(0.0, 0.0, 0.0, 0.0));
CrestStore(BreakerCrestTexel(i, 1u, 2u), float4(0.0, 0.0, 0.0, 0.0));
uint occurrence = 0u;
float emitted = 0.0;
float sPrev = 0.0;
[loop] for (int k = 0; k < ${TRANSECT_SAMPLES}; k++) {
  float dist = float(k) * ${num(TRANSECT_STEP)};
  float s = BreakerPhase(math, o + n * dist);
  if (k > 0 && floor(s) > floor(sPrev)) {
    float m = floor(s);
    float lo = dist - ${num(TRANSECT_STEP)}; float hi = dist; float sLo = sPrev; float sHi = s;
    float x = lo + (m - sLo) / max(sHi - sLo, 1e-5) * ${num(TRANSECT_STEP)};
    [unroll] for (int it = 0; it < 2; it++) {
      float sx = BreakerPhase(math, o + n * x);
      if (sx < m) { lo = x; sLo = sx; } else { hi = x; sHi = sx; }
      x = lo + (m - sLo) / max(sHi - sLo, 1e-5) * (hi - lo);
    }
    BreakerProcessCrest(math, i, o + n * x, m, occurrence, emitted);
  }
  sPrev = s;
}
EmitStore(BreakerEmitTexel(i, 0u), float4(float(occurrence), emitted, 0.0, 0.0));`;

const FADE_SHARED = `
int2 FadeCrestTexel(uint i, uint slot, uint n) {
  return int2((i % ${CREST_COLUMNS}u) * ${CREST_TEXELS}u + slot * 3u + n, i / ${CREST_COLUMNS}u);
}
bool FadeSameWave(uint a, uint b, uint slot) {
  float4 a0 = CrestLoad(FadeCrestTexel(a, slot, 0u)); float4 a2 = CrestLoad(FadeCrestTexel(a, slot, 2u));
  float4 b0 = CrestLoad(FadeCrestTexel(b, slot, 0u)); float4 b2 = CrestLoad(FadeCrestTexel(b, slot, 2u));
  return a2.w > 0.5 && b2.w > 0.5 && abs(a2.w - b2.w) < 0.5 && distance(a0.xz, b0.xz) < ${num(LIP_LINK_GAP)};
}
float FadeLipProgress(uint i, uint slot) { return clamp(CrestLoad(FadeCrestTexel(i, slot, 0u)).w, 0.0, ${num(LIP_GONE)}); }
float FadeSmoothSide(uint i, uint slot, int step, uint n, inout float weight) {
  float sum = 0.0;
  int at = int(i);
  [loop] for (int k = 1; k <= ${LIP_SMOOTH_STATIONS * 2}; k++) {
    int next = at + step;
    if (next < 0 || next >= int(n) || !FadeSameWave(uint(at), uint(next), slot)) break;
    float w = exp(float(k * k) * ${num(-0.5 / (LIP_SMOOTH_STATIONS * LIP_SMOOTH_STATIONS))});
    sum += FadeLipProgress(uint(next), slot) * w;
    weight += w;
    at = next;
  }
  return sum;
}
float FadeSmoothB(uint i, uint slot, uint n) {
  float weight = 1.0;
  float sum = FadeLipProgress(i, slot);
  sum += FadeSmoothSide(i, slot, -1, n, weight);
  sum += FadeSmoothSide(i, slot, 1, n, weight);
  return sum / weight;
}
bool FadeLinked(uint a, uint b, uint slot) {
  float4 a0 = CrestLoad(FadeCrestTexel(a, slot, 0u)); float4 a2 = CrestLoad(FadeCrestTexel(a, slot, 2u));
  float4 b0 = CrestLoad(FadeCrestTexel(b, slot, 0u)); float4 b2 = CrestLoad(FadeCrestTexel(b, slot, 2u));
  return a2.w > 0.5 && b2.w > 0.5 && abs(a2.w - b2.w) < 0.5 && a0.w < 1.25 && b0.w < 1.25
    && abs(a0.w - b0.w) < ${num(LIP_LINK_JUMP)} && distance(a0.xz, b0.xz) < ${num(LIP_LINK_GAP)};
}
float FadeReach(uint i, uint slot, int step, uint n) {
  float reach = 0.0;
  int at = int(i);
  [loop] for (int k = 0; k < ${LIP_TAPER_STATIONS}; k++) {
    int next = at + step;
    if (next < 0 || next >= int(n) || !FadeLinked(uint(at), uint(next), slot)) break;
    reach += 1.0;
    at = next;
  }
  return reach;
}
`;

const FADE_BODY = `uint i = DTid.x;
float4 control = Control();
uint n = uint(control.y);
if (i >= n) return;
float2 taper = 0.0;
float2 smoothB = 0.0;
[unroll] for (uint slot = 0u; slot < 2u; slot++) {
  float reach = min(FadeReach(i, slot, -1, n), FadeReach(i, slot, 1, n));
  taper[slot] = smoothstep(0.0, ${num(LIP_TAPER_STATIONS)}, reach);
  smoothB[slot] = FadeSmoothB(i, slot, n);
}
FadeStore(int2(i % ${STATION_RES}u, i / ${STATION_RES}u), float4(taper, smoothB));`;

export const oceanBreakerFade = defineCompute({
  resources: { Crest: texture(), Fade: texture(), Breakers: params('Control') },
  kernels: {
    BreakerFade: {
      group: [64, 1, 1],
      threads: [BREAKER_CAPACITY, 1, 1],
      uses: ['Crest', 'Fade', 'Breakers'],
      shared: FADE_SHARED,
      body: FADE_BODY,
    },
  },
});

const DISPLACEMENTS = Object.fromEntries(CASCADE_TEXTURE_NAMES.map((name) => [name, texture()]));

export const oceanBreakerCrests = defineCompute({
  resources: {
    Ground: texture(),
    Field: texture(),
    Stations: texture(),
    Crest: texture(),
    ...DISPLACEMENTS,
    Head: texture(),
    Emit: texture(),
    Breakers: params('Control', 'SprayEmitter', 'SprayGain'),
  },
  kernels: {
    BreakerCrests: {
      group: [64, 1, 1],
      threads: [BREAKER_CAPACITY, 1, 1],
      uses: ['Ground', 'Field', 'Stations', 'Crest', ...CASCADE_TEXTURE_NAMES, 'Head', 'Emit', 'Breakers'],
      shared: SHARED,
      body: BODY,
    },
  },
});
