import { buffer, defineCompute, params, texture } from '../../../../shared/compute';
import { CASCADES, CASCADE_SIZES, CHOPPINESS, FFT_SIZE, FOAM, FOAM_PATTERN_SIZE, GRAVITY, LOCAL_SEA, SEA_DEPTH, SEED, SWELL_SEA, cascadeCuts, systemTerms } from './oceanSpectrum';

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
