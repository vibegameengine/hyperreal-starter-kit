import { buffer, defineCompute, params, texture } from '../../../../shared/compute';
import { CASCADES, CASCADE_SIZES, CHOPPINESS, FFT_SIZE, FOAM, FOAM_PATTERN_SIZE, GRAVITY, LACE_SIZE, LACE_TILE, LOCAL_SEA, SEA_DEPTH, SEED, SHORE_SIM_RES, SWELL_SEA, cascadeCuts, systemTerms } from './oceanSpectrum';
import { COMPUTE_ACCESS, SHORE_EXTENT, SHORE_ORIGIN, shoreMath } from './oceanShore';
import { SPRAY_DEPOSIT_GAIN } from './spraySpec';

const N = FFT_SIZE;
const HALF = N / 2;
const TOTAL = N * N * CASCADES;
const literal = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);
const vector = (values: readonly number[]) => `float4(${values.map(literal).join(', ')})`;
const perCascade = (type: string, name: string, value: (c: number) => string) =>
  `${type} ${name}(uint c) { ${Array.from({ length: CASCADES }, (_, c) => `if (c == ${c}u) return ${value(c)};`).join(' ')} return ${value(CASCADES - 1)}; }`;
const local = systemTerms(LOCAL_SEA);
const swell = systemTerms(SWELL_SEA);

const SPECTRUM = `
${perCascade('float', 'CascadeSize', (c) => literal(CASCADE_SIZES[c]))}
${perCascade('float2', 'CascadeCuts', (c) => `float2(${cascadeCuts(c).map(literal).join(', ')})`)}
float Dispersion(float k) { return sqrt(k * ${literal(GRAVITY)} * tanh(min(k * ${literal(SEA_DEPTH)}, 20.0))); }
float DispersionDerivative(float k) {
  float kd = min(k * ${literal(SEA_DEPTH)}, 20.0); float th = tanh(kd); float ch = cosh(kd);
  return ${literal(GRAVITY)} * (${literal(SEA_DEPTH)} * k / (ch * ch) + th) / Dispersion(k) * 0.5;
}
float TmaCorrection(float omega) {
  float omegaH = omega * sqrt(${literal(SEA_DEPTH)} / ${literal(GRAVITY)});
  float a = omegaH * omegaH * 0.5; float b = 1.0 - pow(2.0 - omegaH, 2.0) * 0.5;
  return omegaH <= 1.0 ? a : (omegaH < 2.0 ? b : 1.0);
}
float Jonswap(float omega, float4 sysA, float4 sysB) {
  float sigma = omega <= sysB.y ? 0.07 : 0.09; float d = omega - sysB.y;
  float r = exp(-d * d / (sigma * sigma * sysB.y * sysB.y * 2.0)); float inv = 1.0 / omega;
  return sysA.x * TmaCorrection(omega) * sysB.x * ${literal(GRAVITY * GRAVITY)} * pow(inv, 5.0) * exp(pow(sysB.y * inv, 4.0) * -1.25) * pow(abs(sysB.z), r);
}
float NormalisationFactor(float s) {
  float s2 = s * s; float s3 = s2 * s; float s4 = s3 * s;
  float lo = s4 * -0.000564 + s3 * 0.00776 - s2 * 0.044 + s * 0.192 + 0.163;
  float hi = s4 * -4.80e-08 + s3 * 1.07e-05 - s2 * 9.53e-04 + s * 5.90e-02 + 3.93e-01;
  return s < 5.0 ? lo : hi;
}
float DirectionSpectrum(float theta, float omega, float4 sysA, float4 sysB) {
  float ratio = omega / sysB.y;
  float spreadPower = omega > sysB.y ? pow(abs(ratio), -2.5) * 9.77 : pow(abs(ratio), 5.0) * 6.97;
  float s = spreadPower + tanh(min(ratio, 20.0)) * 16.0 * sysA.w * sysA.w;
  float dTheta = theta - sysA.y;
  float cos2s = NormalisationFactor(s) * pow(abs(cos(dTheta * 0.5)), s * 2.0);
  float cosT = cos(dTheta);
  return lerp(cosT * cosT * (2.0 / 3.14159265) * (cosT > 0.0 ? 1.0 : 0.0), cos2s, sysA.z);
}
float ShortWavesFade(float k, float4 sysB) { return exp(-sysB.w * sysB.w * k * k); }
uint FftPcg(uint v) { uint state = v * 747796405u + 2891336453u; uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u; return (word >> 22u) ^ word; }
float FftToUnit(uint h) { return float(h >> 8u) * (1.0 / 16777216.0) + (0.5 / 16777216.0); }
`;

const FFT = `
groupshared float4 FftShared[${N * 2}];
uint FftBitReverse8(uint v) { return reversebits(v) >> 24u; }
float4 FftCmul2(float4 v, float2 w) { return float4(v.x * w.x - v.y * w.y, v.x * w.y + v.y * w.x, v.z * w.x - v.w * w.y, v.z * w.y + v.w * w.x); }
void FftStages(uint t) {
  [unroll] for (uint s = 0u; s < 8u; s++) {
    uint halfSize = 1u << s; uint pos = t & (halfSize - 1u);
    uint i = ((t >> s) << (s + 1u)) | pos; uint j = i + halfSize;
    float ang = float(pos) * (3.14159265 / float(halfSize)); float2 w = float2(cos(ang), sin(ang));
    uint i2 = i * 2u; uint j2 = j * 2u;
    float4 a0 = FftShared[i2]; float4 a1 = FftShared[i2 + 1u];
    float4 b0 = FftCmul2(FftShared[j2], w); float4 b1 = FftCmul2(FftShared[j2 + 1u], w);
    FftShared[i2] = a0 + b0; FftShared[i2 + 1u] = a1 + b1; FftShared[j2] = a0 - b0; FftShared[j2 + 1u] = a1 - b1;
    GroupMemoryBarrierWithGroupSync();
  }
}
`;

const SPECTRUM_THREADS = [N, N, CASCADES] as const;
const LINE_THREADS = [HALF * N, CASCADES, 1] as const;
const store = (resource: string, value: string) => Array.from({ length: CASCADES }, (_, c) => `if (c == ${c}u) ${resource}${c}Store(uv, ${value});`).join(' else ');

const cascadeTextures = (prefix: string) => Object.fromEntries(Array.from({ length: CASCADES }, (_, c) => [`${prefix}${c}`, texture()]));
const cascadeNames = (prefix: string) => Array.from({ length: CASCADES }, (_, c) => `${prefix}${c}`);

export const oceanWaves = defineCompute({
  resources: {
    H0Raw: buffer(TOTAL),
    H0: buffer(TOTAL),
    Wave: buffer(TOTAL),
    Tmp: buffer(TOTAL * 2),
    Foam: buffer(TOTAL, 1),
    ...cascadeTextures('Displacement'),
    ...cascadeTextures('Derivatives'),
    Ocean: params('Control'),
  },
  kernels: {
    InitSpectrum: {
      group: [16, 16, 1],
      threads: SPECTRUM_THREADS,
      uses: ['H0Raw', 'Wave', 'Ocean'],
      shared: SPECTRUM,
      body: `if (Control().x < 0.5) return;
int x = int(DTid.x); int y = int(DTid.y); uint c = DTid.z;
uint idx = c * ${N * N}u + uint(y) * ${N}u + uint(x);
float L = CascadeSize(c); float dk = 6.28318530718 / L;
float kx = float(x - ${HALF}) * dk; float kz = float(y - ${HALF}) * dk; float kLen = length(float2(kx, kz));
float4 outH = 0.0; float4 outW = float4(kx, kz, 0.0, 0.0);
float2 cuts = CascadeCuts(c);
if (kLen >= cuts.x && kLen <= cuts.y) {
  float omega = Dispersion(kLen); float dOmega = DispersionDerivative(kLen); float theta = atan2(kz, kx);
  float4 sa0 = ${vector(local.a)}; float4 sb0 = ${vector(local.b)}; float4 sa1 = ${vector(swell.a)}; float4 sb1 = ${vector(swell.b)};
  float S0 = Jonswap(omega, sa0, sb0) * DirectionSpectrum(theta, omega, sa0, sb0) * ShortWavesFade(kLen, sb0);
  float S1 = Jonswap(omega, sa1, sb1) * DirectionSpectrum(theta, omega, sa1, sb1) * ShortWavesFade(kLen, sb1);
  float amp = sqrt(max(S0 + S1, 0.0) * abs(dOmega) / kLen * dk * dk) * 0.5;
  uint seed = idx * 4u + ${SEED}u * 7919u;
  float r = sqrt(log(FftToUnit(FftPcg(seed))) * -2.0); float a = FftToUnit(FftPcg(seed + 1u)) * 6.28318530718;
  outH = float4(r * cos(a) * amp, r * sin(a) * amp, 0.0, 0.0);
  outW = float4(kx, kz, 1.0 / kLen, omega);
}
H0RawStore(idx, outH); WaveStore(idx, outW);`,
    },
    Conjugate: {
      group: [16, 16, 1],
      threads: SPECTRUM_THREADS,
      uses: ['H0Raw', 'H0', 'Foam', 'Ocean'],
      body: `if (Control().x < 0.5) return;
uint x = DTid.x; uint y = DTid.y; uint base = DTid.z * ${N * N}u;
uint idx = base + y * ${N}u + x;
uint idxm = base + ((${N}u - y) % ${N}u) * ${N}u + ((${N}u - x) % ${N}u);
float2 hm = H0RawLoad(idxm).xy; float2 cur = H0RawLoad(idx).xy;
H0Store(idx, float4(cur.x, cur.y, hm.x, -hm.y)); FoamStore(idx, 0.0);`,
    },
    Rows: {
      group: [HALF, 1, 1],
      threads: LINE_THREADS,
      uses: ['H0', 'Wave', 'Tmp', 'Ocean'],
      shared: FFT,
      body: `uint t = GTid.x; uint base = Gid.y * ${N * N}u + Gid.x * ${N}u; float time = Control().z;
for (uint e = 0u; e < 2u; e++) {
  uint x = t + e * ${HALF}u; uint idx = base + x;
  float4 w = WaveLoad(idx); float4 hv = H0Load(idx);
  float cs = cos(w.w * time); float sn = sin(w.w * time);
  float hr = hv.x * cs - hv.y * sn + hv.z * cs + hv.w * sn;
  float hi = hv.x * sn + hv.y * cs - hv.z * sn + hv.w * cs;
  float kx = w.x; float kz = w.y; float ik = w.z; float fx = kx * ik; float fz = kz * ik;
  float q = -(kx * kz * ik); float a = -(kx * kx * ik); float b = -(kz * kz * ik);
  uint r = FftBitReverse8(x) * 2u;
  FftShared[r] = float4(-(fx * hi + fz * hr), fx * hr - fz * hi, hr - q * hi, hi + q * hr);
  FftShared[r + 1u] = float4(-(kx * hi + kz * hr), kx * hr - kz * hi, a * hr - b * hi, a * hi + b * hr);
}
GroupMemoryBarrierWithGroupSync();
FftStages(t);
for (uint e2 = 0u; e2 < 2u; e2++) {
  uint x = t + e2 * ${HALF}u; uint o = (base + x) * 2u;
  TmpStore(o, FftShared[x * 2u]); TmpStore(o + 1u, FftShared[x * 2u + 1u]);
}`,
    },
    Columns: {
      group: [HALF, 1, 1],
      threads: LINE_THREADS,
      uses: ['Tmp', 'Foam', 'Ocean', ...cascadeNames('Displacement'), ...cascadeNames('Derivatives')],
      shared: FFT,
      body: `uint t = GTid.x; uint col = Gid.x; uint c = Gid.y; uint base = c * ${N * N}u; float dt = Control().y;
for (uint e = 0u; e < 2u; e++) {
  uint y = t + e * ${HALF}u; uint idx = base + y * ${N}u + col; uint r = FftBitReverse8(y) * 2u;
  FftShared[r] = TmpLoad(idx * 2u); FftShared[r + 1u] = TmpLoad(idx * 2u + 1u);
}
GroupMemoryBarrierWithGroupSync();
FftStages(t);
float lambda = ${literal(CHOPPINESS)};
for (uint e2 = 0u; e2 < 2u; e2++) {
  uint y = t + e2 * ${HALF}u; uint idx = base + y * ${N}u + col;
  float sign = ((col + y) & 1u) == 0u ? 1.0 : -1.0;
  float4 A = FftShared[y * 2u] * sign; float4 B = FftShared[y * 2u + 1u] * sign;
  float jxx = lambda * B.z + 1.0; float jzz = lambda * B.w + 1.0; float jxz = lambda * A.w;
  float J = jxx * jzz - jxz * jxz;
  float gen = saturate((${literal(FOAM.bias)} - J) * ${literal(FOAM.gain)});
  float f = FoamLoad(idx) * exp(-${literal(FOAM.decay)} * dt) + gen * ${literal(FOAM.add)} * dt;
  float fNew = clamp(max(f, gen * 0.5), 0.0, 1.5);
  FoamStore(idx, fNew);
  int2 uv = int2(col, y);
  float4 displacement = float4(lambda * A.x, A.z, lambda * A.y, fNew);
  float4 derivatives = float4(B.x, B.y, lambda * B.z, lambda * B.w);
  ${store('Displacement', 'displacement')}
  ${store('Derivatives', 'derivatives')}
}`,
    },
  },
});

const FOAM_NOISE = `
float2 Hash2(float2 p) { return frac(sin(float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)))) * 43758.5453); }
float2 Fmod2(float2 x, float y) { return x - y * floor(x / y); }
float Worley(float2 uv, float cells) {
  float2 p = uv * cells; float2 ip = floor(p); float2 fp = frac(p); float f1 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float2 o = float2(float(i), float(j)); f1 = min(f1, length(o + Hash2(Fmod2(ip + o, cells)) - fp));
  }
  return f1;
}
float VNoise(float2 uv, float cells) {
  float2 p = uv * cells; float2 i = floor(p); float2 f = frac(p); float2 u = f * f * (3.0 - f * 2.0);
  float a = Hash2(Fmod2(i, cells)).x; float b = Hash2(Fmod2(i + float2(1.0, 0.0), cells)).x;
  float c = Hash2(Fmod2(i + float2(0.0, 1.0), cells)).x; float d = Hash2(Fmod2(i + float2(1.0, 1.0), cells)).x;
  return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y);
}
float Fbm(float2 uv, float base, int octaves) {
  float sum = 0.0; float weight = 0.5; float total = 0.0;
  for (int o = 0; o < octaves; o++) { sum += VNoise(uv, base * exp2(float(o))) * weight; total += weight; weight *= 0.5; }
  return sum / total;
}
`;

const L = LACE_SIZE;
const LACE_THREADS = [L, L, 1] as const;
const laceIndex = 'uint k = DTid.y * ' + L + 'u + DTid.x;';

const LACE_NOISE = `
uint LaceHash(int x, int y, int s) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(s) * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return h;
}
float LaceH01(int x, int y, int s) { return float(LaceHash(x, y, s)) / 4294967296.0; }
int LaceWrap(int a, int n) { return ((a % n) + n) % n; }
float LaceNoise(float x, float y, int n, int s) {
  int i = int(floor(x)); int j = int(floor(y));
  float fx = x - float(i); float fy = y - float(j);
  float ux = fx * fx * (3.0 - 2.0 * fx); float uy = fy * fy * (3.0 - 2.0 * fy);
  float a = LaceH01(LaceWrap(i, n), LaceWrap(j, n), s); float b = LaceH01(LaceWrap(i + 1, n), LaceWrap(j, n), s);
  float c = LaceH01(LaceWrap(i, n), LaceWrap(j + 1, n), s); float d = LaceH01(LaceWrap(i + 1, n), LaceWrap(j + 1, n), s);
  return (a * (1.0 - ux) + b * ux) * (1.0 - uy) + (c * (1.0 - ux) + d * ux) * uy;
}
float LaceFbm(float x, float y, int n, int s, int oct) {
  float v = 0.0; float a = 0.5; float t = 0.0;
  for (int o = 0; o < oct; o++) { v += LaceNoise(x * float(1 << o), y * float(1 << o), n * (1 << o), s + o * 17) * a; t += a; a *= 0.5; }
  return v / t;
}
float3 LaceVoronoi(float x, float y, int n, int s) {
  int i = int(floor(x)); int j = int(floor(y));
  float f1 = 9.0; float f2 = 9.0; float id = 0.0;
  for (int dj = -1; dj <= 1; dj++) for (int di = -1; di <= 1; di++) {
    int ci = i + di; int cj = j + dj; int wi = LaceWrap(ci, n); int wj = LaceWrap(cj, n);
    float px = float(ci) + 0.15 + 0.7 * LaceH01(wi, wj, s); float py = float(cj) + 0.15 + 0.7 * LaceH01(wi, wj, s + 1);
    float d = length(float2(px - x, py - y));
    if (d < f1) { f2 = f1; f1 = d; id = LaceH01(wi, wj, s + 2); } else if (d < f2) f2 = d;
  }
  return float3(f1, f2, id);
}
`;

const laceBlur = (from: string, to: string, horizontal: boolean) => ({
  group: [8, 8, 1] as const,
  threads: LACE_THREADS,
  uses: [from, to],
  body: `${laceIndex}
float s = 0.0;
for (int o = -2; o <= 2; o++) {
  ${horizontal ? `uint x = uint((int(DTid.x) + o + ${L}) % ${L}); s += ${from}Load(DTid.y * ${L}u + x)${from === 'Strand' ? '.x' : ''};` : `uint y = uint((int(DTid.y) + o + ${L}) % ${L}); s += ${from}Load(y * ${L}u + DTid.x)${from === 'Strand' ? '.x' : ''};`}
}
${to}Store(k, s / 5.0);`,
});

export const oceanLace = defineCompute({
  resources: {
    Warp: buffer(L * L, 4),
    Strand: buffer(L * L, 4),
    Tmp1: buffer(L * L, 1),
    Blur1: buffer(L * L, 1),
    Tmp2: buffer(L * L, 1),
    Blur2: buffer(L * L, 1),
    Lace: texture(),
  },
  kernels: {
    LaceWarp: {
      group: [8, 8, 1],
      threads: LACE_THREADS,
      uses: ['Warp'],
      shared: LACE_NOISE,
      body: `${laceIndex}
float u = (float(DTid.x) + 0.5) / ${L}.0; float v = (float(DTid.y) + 0.5) / ${L}.0;
float w1x = (LaceFbm(u * 3.0, v * 3.0, 3, 3, 3) - 0.5) * 0.16; float w1y = (LaceFbm(u * 3.0 + 5.2, v * 3.0 + 1.3, 3, 7, 3) - 0.5) * 0.16;
float w2x = (LaceFbm((u + w1x) * 9.0, (v + w1y) * 9.0, 9, 13, 3) - 0.5) * 0.07; float w2y = (LaceFbm((u + w1x) * 9.0 + 2.7, (v + w1y) * 9.0, 9, 17, 3) - 0.5) * 0.07;
float uu = u + w1x + w2x; float vv = v + w1y + w2y;
WarpStore(k, float4(uu, vv, LaceFbm(uu * 6.0, vv * 6.0, 6, 91, 3), 0.0));`,
    },
    LaceStrands: {
      group: [8, 8, 1],
      threads: LACE_THREADS,
      uses: ['Warp', 'Strand'],
      shared: LACE_NOISE,
      body: `${laceIndex}
uint px = DTid.x; uint py = DTid.y;
float u = (float(px) + 0.5) / ${L}.0; float v = (float(py) + 0.5) / ${L}.0;
float4 w = WarpLoad(k);
float N1 = 16.0; float halfCell = 0.5 / N1;
float3 c1 = LaceVoronoi(w.x * N1, w.y * N1, 16, 11);
float dCells = (c1.y - c1.x) * 0.5 / N1;
uint xl = (px + ${L - 1}u) % ${L}u; uint xr = (px + 1u) % ${L}u; uint yd = (py + ${L - 1}u) % ${L}u; uint yu = (py + 1u) % ${L}u;
float gx = (WarpLoad(py * ${L}u + xr).z - WarpLoad(py * ${L}u + xl).z) * ${L}.0 * 0.5;
float gy = (WarpLoad(yu * ${L}u + px).z - WarpLoad(yd * ${L}u + px).z) * ${L}.0 * 0.5;
float g = max(length(float2(gx, gy)), 0.5);
float n1 = w.z;
float dLoops = min(min(abs(n1 - 0.5), abs(n1 - 0.36)), abs(n1 - 0.64)) / g;
float hi = LaceFbm(u * 24.0, v * 24.0, 24, 5, 2);
float gap = smoothstep(0.52, 0.36, LaceFbm(u * 10.0 + 3.1, v * 10.0, 10, 31, 3));
float d = min(dCells * 1.35 + 0.004, dLoops) / halfCell * (0.75 + 0.5 * hi) + gap * 0.22;
float mott = LaceFbm(u * 3.0, v * 3.0, 3, 71, 4);
float3 c3 = LaceVoronoi(u * 120.0, v * 120.0, 120, 61);
float rad = 0.1 + 0.22 * c3.z;
float dotV = smoothstep(rad, rad * 0.35, c3.x) * (c3.z > 0.45 ? 1.0 : 0.0);
float bub = dotV * (0.25 + 0.75 * smoothstep(0.5, 0.1, d));
StrandStore(k, float4(min(1.0, d), min(1.0, bub), mott, c1.z));`,
    },
    LaceBlurH1: laceBlur('Strand', 'Tmp1', true),
    LaceBlurV1: laceBlur('Tmp1', 'Blur1', false),
    LaceBlurH2: laceBlur('Blur1', 'Tmp2', true),
    LaceBlurV2: laceBlur('Tmp2', 'Blur2', false),
    LaceFinal: {
      group: [8, 8, 1],
      threads: LACE_THREADS,
      uses: ['Strand', 'Blur2', 'Lace'],
      body: `${laceIndex}
float4 s = StrandLoad(k);
float d2 = Blur2Load(k);
LaceStore(int2(DTid.xy), float4(s.x + (d2 - s.x) * smoothstep(0.12, 0.45, s.x), s.y, s.z, s.w));`,
    },
  },
});

const R = SHORE_SIM_RES;
const SIM = { dryTime: 28, foamLife: 4.5, surfFoamLife: 2.6, residueLife: 5, foamGen: 1 } as const;
const num = (value: number) => value.toFixed(6);

const SIM_HELPERS = `
${shoreMath(CASCADE_SIZES, COMPUTE_ACCESS)}
float4 SimRead(uint k, bool odd) { return odd ? StateBLoad(k) : StateALoad(k); }
float4 SimStateAt(float2 uv, bool odd) {
  float2 fp = clamp(uv * ${R}.0 - 0.5, 0.0, ${R - 1.001});
  uint2 i = uint2(floor(fp)); float2 t = frac(fp);
  float4 a = SimRead(i.y * ${R}u + i.x, odd); float4 b = SimRead(i.y * ${R}u + i.x + 1u, odd);
  float4 c = SimRead((i.y + 1u) * ${R}u + i.x, odd); float4 d = SimRead((i.y + 1u) * ${R}u + i.x + 1u, odd);
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
}
float SimMottle(float2 p) {
  float2 fp = p / ${num(LACE_TILE * 4.3)} * ${LACE_SIZE}.0 - 0.5;
  int2 i = int2(floor(fp)); float2 t = frac(fp); int m = ${LACE_SIZE - 1};
  float a = LaceLoad(i & m).z; float b = LaceLoad((i + int2(1, 0)) & m).z;
  float c = LaceLoad((i + int2(0, 1)) & m).z; float d = LaceLoad((i + int2(1, 1)) & m).z;
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
}
`;

export const oceanShoreSim = defineCompute({
  resources: {
    Ground: texture(),
    Field: texture(),
    Lace: texture(),
    StateA: buffer(R * R, 4),
    StateB: buffer(R * R, 4),
    State: texture(),
    Deposit: texture(),
    Sim: params('Step'),
  },
  kernels: {
    ShoreSim: {
      group: [8, 8, 1],
      threads: [R, R, 1],
      uses: ['Ground', 'Field', 'Lace', 'StateA', 'StateB', 'State', 'Deposit', 'Sim'],
      shared: SIM_HELPERS,
      body: `uint k = DTid.y * ${R}u + DTid.x;
float4 ctl = Step();
float dt = ctl.x; bool odd = ctl.z > 0.5;
OceanShoreMath math; math.time = ctl.y; math.enabled = 1.0;
float size = ${num(SHORE_EXTENT)};
float2 uv = (float2(DTid.xy) + 0.5) / ${R}.0;
float2 p = ${num(SHORE_ORIGIN)} + uv * size;
float ground = math.HeightAt(0, p);
float depth = -ground;
float4 here = SimRead(k, odd);
float drops = DepositLoad(int2(DTid.xy)).x;
if (drops > 0.0) DepositStore(int2(DTid.xy), float4(0.0, 0.0, 0.0, 0.0));
float4 next;
if (ctl.w > 0.5) {
  next = 0.0;
} else if (depth > 7.0 || ground > 3.2) {
  float decay = exp(-dt / 2.0);
  next = float4(here.x * decay, here.y * exp(-dt / ${num(SIM.dryTime)}), here.z * decay, 0.0);
} else {
  OceanShoreWorld sw = math.World(0, 1, p, -math.WaveHeightAt(0, p), ground);
  float texel = size / ${R}.0;
  float cov = depth > 0.03 ? 1.0 : saturate((sw.runup - sw.inland) / texel + 0.5);
  bool covered = cov > 0.5;
  float2 vel = covered ? sw.flow : float2(0.0, 0.0);
  float4 prev = SimStateAt(uv - vel * dt / size, odd);
  float patchK = smoothstep(0.25, 0.75, SimMottle(p)) * 0.8 + 0.35;
  float swashy = smoothstep(0.35, 0.05, depth);
  float laceLife = lerp(${num(SIM.surfFoamLife)}, ${num(SIM.foamLife)}, swashy);
  float life = lerp(0.7, lerp(laceLife, 0.8, smoothstep(0.3, 0.8, prev.x)), cov);
  float gen = (sw.foam * 2.2 + sw.swashFoam * 1.4) * patchK * cov;
  float2 dirH = sw.dir * (texel / size);
  float uAhead = SimStateAt(uv + dirH, odd).w;
  float uBehind = SimStateAt(uv - dirH, odd).w;
  float spreadRate = max((uAhead - uBehind) / (2.0 * texel), 0.0);
  float splash = drops * ${num(SPRAY_DEPOSIT_GAIN)} * cov;
  float foam = min(prev.x * exp(-dt * (1.0 / life + spreadRate)) + gen * ${num(SIM.foamGen)} * dt + splash, 1.0);
  float wet = max(here.y * exp(-dt / ${num(SIM.dryTime)}), cov);
  float stranded = min(here.x * 2.4, 1.0) * (1.0 - cov);
  float residue = max(here.z * lerp(exp(-dt / ${num(SIM.residueLife)}), 0.85, cov), stranded);
  next = float4(foam, wet, residue, dot(vel, sw.dir));
}
if (odd) StateAStore(k, next); else StateBStore(k, next);
StateStore(int2(DTid.xy), next);`,
    },
  },
});

export const oceanFoamPattern = defineCompute({
  resources: { Pattern: texture() },
  kernels: {
    FoamPattern: {
      group: [8, 8, 1],
      threads: [FOAM_PATTERN_SIZE, FOAM_PATTERN_SIZE, 1],
      uses: ['Pattern'],
      shared: FOAM_NOISE,
      body: `float2 uv = (float2(DTid.xy) + 0.5) / ${FOAM_PATTERN_SIZE}.0;
float2 w1 = (float2(Fbm(uv, 3.0, 4), Fbm(uv + 0.43, 3.0, 4)) - 0.5) * 0.14; float2 wuv = uv + w1;
float dens = Fbm(wuv, 4.0, 6);
float holeA = smoothstep(0.28, 0.12, Worley(wuv, 7.0) + (Fbm(uv, 16.0, 3) - 0.5) * 0.25);
float holeB = smoothstep(0.30, 0.16, Worley(wuv + 0.17, 19.0) + (Fbm(uv, 32.0, 2) - 0.5) * 0.3);
float holeC = smoothstep(0.32, 0.18, Worley(wuv + 0.61, 47.0));
float holes = saturate(holeA * 0.9 + holeB * 0.7 + holeC * 0.45);
float bub = smoothstep(0.24, 0.08, Worley(uv + 0.33, 140.0)) * 0.8 + smoothstep(0.2, 0.05, Worley(uv + 0.71, 260.0)) * 0.5;
float streak = Fbm(uv + w1 * 2.0, 12.0, 4);
PatternStore(int2(DTid.xy), float4(saturate(dens * 1.35 - holes * 0.55 + bub * 0.08), saturate(bub), Fbm(uv, 2.0, 3), streak));`,
    },
  },
});
