import { STATION_RES, STATION_SPACING } from './breakerSpec';
import { GRAVITY } from './oceanSpectrum';
import { SPRAY_COMMON } from './sprayHlsl';
import { SPRAY_BUDGET_START, SPRAY_CREST_OCCURRENCES, SPRAY_EMIT_TEXELS, SPRAY_OCCURRENCE_TEXELS } from './spraySpec';

const num = (value: number) => value.toFixed(6);
const TWO_G = num(2 * GRAVITY);

export const BREAKER_EMIT_ACCESS = `
int2 BreakerEmitTexel(uint i, uint n) { return int2((i % ${STATION_RES}u) * ${SPRAY_EMIT_TEXELS}u + n, i / ${STATION_RES}u); }
int2 BreakerStationTexel(uint i) { return int2(i % ${STATION_RES}u, i / ${STATION_RES}u); }
`;

const BREAKER_SPRAY_RECORD = `
void BreakerSprayRecord(uint i, inout uint occurrence, inout float emitted, float4 t0, float4 t1, float4 t2, float4 t3, BreakerSprayCounts n) {
  if (n.d.z < 0.5 || occurrence >= ${SPRAY_CREST_OCCURRENCES}u) return;
  uint at = 1u + occurrence * ${SPRAY_OCCURRENCE_TEXELS}u;
  EmitStore(BreakerEmitTexel(i, at), t0); EmitStore(BreakerEmitTexel(i, at + 1u), t1);
  EmitStore(BreakerEmitTexel(i, at + 2u), t2); EmitStore(BreakerEmitTexel(i, at + 3u), t3);
  EmitStore(BreakerEmitTexel(i, at + 4u), n.a); EmitStore(BreakerEmitTexel(i, at + 5u), n.b);
  EmitStore(BreakerEmitTexel(i, at + 6u), n.c); EmitStore(BreakerEmitTexel(i, at + 7u), n.d);
  occurrence++;
  emitted += n.d.z;
}
`;

export const BREAKER_SPRAY_SEED = `
uint BreakerSpraySeed(uint i, float m) { return i * 7919u + uint(m - floor(m / 64.0) * 64.0) * 31u; }
`;

const BREAKER_SPRAY_COUNT = `
struct BreakerSprayCounts { float4 a; float4 b; float4 c; float4 d; };
float BreakerCount(float rate, float gain, uint seed, uint salt, uint frameSeed) { return floor(rate * gain + SprayRand(seed, salt, frameSeed)); }
BreakerSprayCounts BreakerSprayCount(uint i, float3 root, float2 dir, float b, float H, float m, float depth, float Hb) {
  float4 emitter = SprayEmitter(); float4 g = SprayGain();
  uint fs = uint(g.z);
  float camFade = smoothstep(g.y, g.y * 0.35, length(root - emitter.xyz));
  float gain = g.x * camFade * emitter.w;
  float4 head = HeadLoad(int2(0, 0));
  float gainD = gain * (head.w > 0.5 ? head.y : ${num(SPRAY_BUDGET_START)});
  float Hc = clamp(H, 0.15, 3.0);
  float E = pow(Hc, 1.7);
  float Hp = max(Hb, 0.0);
  float Eb = pow(min(Hp, 2.0) / 0.6, 1.7);
  float offshore = max(-dot(SPRAY_WIND_DIR.xz, dir), 0.0) * SPRAY_WIND_SPEED;
  uint seed = BreakerSpraySeed(i, m);
  float lipShed = smoothstep(0.5, 0.75, b) * (1.0 - smoothstep(0.86, 0.93, b));
  float impact = smoothstep(0.87, 0.92, b) * (1.0 - smoothstep(1.0, 1.14, b));
  float haze = smoothstep(0.9, 1.0, b) * (1.0 - smoothstep(1.2, 1.5, b));
  float spit = smoothstep(0.98, 1.08, b) * (1.0 - smoothstep(1.15, 1.3, b));
  float roller = smoothstep(1.05, 1.3, b) * smoothstep(0.06, 0.25, Hp);
  float clash = roller * smoothstep(0.1, 0.2, depth) * smoothstep(0.7, 0.35, depth);
  float drift = smoothstep(9.0, 15.0, offshore) * smoothstep(-0.4, 0.1, b) * (1.0 - smoothstep(0.75, 0.9, b));
  float n0 = BreakerCount(lipShed * 9.0 * E, gainD, seed, 1u, fs);
  float n1 = n0 + BreakerCount(lipShed * 5.0 * E, gainD, seed, 2u, fs);
  float n2 = n1 + BreakerCount(impact * 240.0 * E, gainD, seed, 3u, fs);
  float n3 = n2 + BreakerCount(impact * 90.0 * E, gainD, seed, 4u, fs);
  float n4 = n3 + BreakerCount(roller * 45.0 * Eb, gainD, seed, 5u, fs);
  float n5 = n4 + BreakerCount(clash * 40.0 * Eb, gainD, seed, 6u, fs);
  float n6 = n5 + BreakerCount(drift * 24.0 * Hc, gainD, seed, 7u, fs);
  float c0 = BreakerCount(impact * 110.0 * E, gain, seed, 21u, fs);
  float c1 = c0 + BreakerCount(spit * 10.0 * E, gain, seed, 22u, fs);
  float c2 = c1 + BreakerCount(roller * 0.6 * Eb, gain, seed, 23u, fs);
  float c3 = c2 + BreakerCount(clash * 2.0 * Eb, gain, seed, 24u, fs);
  float m0 = BreakerCount(haze * 5.0 * E + spit * 3.0 * E, gain, seed, 31u, fs);
  float mL = BreakerCount(lipShed * 1.6 * E, gain, seed, 33u, fs);
  float m1 = m0 + BreakerCount(roller * 4.5 * Eb, gain, seed, 32u, fs);
  BreakerSprayCounts r;
  r.a = float4(n0, n1, n2, n3); r.b = float4(n4, n5, n6, c0); r.c = float4(c1, c2, c3, m0); r.d = float4(mL, m1, n6 + c3 + mL + m1, 0.0);
  return r;
}
`;

export const BREAKER_SPRAY_SHAPE = `
struct BreakerSprayContext { float3 root; float3 d3; float3 tg; float Yi; float Wt; float wB; float trough; float xr; float Xi; float q; float c; float Hc; float Hb; float offshore; float tag; uint seed; uint fs; };
struct BreakerSprayPoint { float3 p; float3 n; };
static const float3 BRK_UP = float3(0.0, 1.0, 0.0);
BreakerSprayPoint BreakerFacePoint(BreakerSprayContext C, float sp) {
  float th = sp * ${num(Math.PI / 2)};
  float ct = cos(th); float st = sin(th);
  float fx = lerp(1.0 - ct, st, C.wB);
  float fy = lerp(1.0 - st, ct, C.wB);
  BreakerSprayPoint r;
  r.n = normalize(C.d3 * (C.Yi * lerp(ct, st, C.wB)) + BRK_UP * (C.Wt * lerp(st, ct, C.wB) + 0.02));
  float3 p = C.root + C.d3 * (C.Wt * fx);
  r.p = float3(p.x, C.trough + C.Yi * fy, p.z);
  return r;
}
BreakerSprayPoint BreakerPlunge(BreakerSprayContext C, float r, float r2) {
  BreakerSprayPoint f = BreakerFacePoint(C, r2 * 0.45 + 0.55);
  float3 t = C.root + C.d3 * (C.xr + (r - 0.5) * 0.5);
  bool open = C.xr > C.Wt + 0.1;
  BreakerSprayPoint o;
  o.p = open ? float3(t.x, C.trough + 0.03, t.z) : f.p + f.n * 0.04;
  o.n = open ? BRK_UP : f.n;
  return o;
}
float3 BreakerTipAt(BreakerSprayContext C, float r) { return C.root + C.d3 * (C.Xi * C.q * (r * 0.12 + 0.88)) - BRK_UP * (C.Yi * C.q * C.q); }
float3 BreakerAlong(BreakerSprayContext C, float r) { return C.tg * ((r - 0.5) * ${num(STATION_SPACING * 1.15)}); }
BreakerSprayContext BreakerSprayContextAt(uint i, float4 t0, float4 t1, float4 t2, float4 t3, uint fs) {
  BreakerSprayContext C;
  float b = t0.w; float H = t1.w; float2 dir = t1.xy;
  C.root = t0.xyz; C.d3 = float3(dir.x, 0.0, dir.y); C.tg = float3(-dir.y, 0.0, dir.x);
  C.trough = t1.z; C.c = t2.x;
  C.q = clamp(b / 0.9, 0.0, 1.0); C.Xi = H * 0.8; C.Yi = max(C.root.y - C.trough, 0.05);
  C.Wt = t3.y; C.wB = t3.w; C.xr = C.Xi - t3.z;
  C.Hc = clamp(H, 0.15, 3.0); C.Hb = max(t3.x, 0.0);
  C.offshore = max(-dot(SPRAY_WIND_DIR.xz, dir), 0.0) * SPRAY_WIND_SPEED;
  C.tag = float(i * 2u + uint(t2.w) + 1u);
  C.seed = BreakerSpraySeed(i, t2.y);
  C.fs = fs;
  return C;
}
`;

export const BREAKER_SPRAY_DROPS = `
uint BreakerSprayDrops(BreakerSprayContext C, float4 a, float4 b, uint ring) {
  uint n0 = uint(a.x); uint n1 = uint(a.y); uint n2 = uint(a.z); uint n3 = uint(a.w);
  uint n4 = uint(b.x); uint n5 = uint(b.y); uint n6 = uint(b.z);
  [loop] for (uint j = 0u; j < n6; j++) {
    uint h = C.seed + j * 13u;
    float r0 = SprayRand(h, 11u, C.fs); float r1 = SprayRand(h, 12u, C.fs); float r2 = SprayRand(h, 13u, C.fs);
    float r3 = SprayRand(h, 14u, C.fs); float r4 = SprayRand(h, 15u, C.fs);
    bool isLip = j < n1; bool isImp = j < n3; bool isRol = j < n4; bool isCl = j < n5;
    bool lig = (j >= n0 && j < n1) || (j >= n2 && j < n3);
    float3 vLip = C.d3 * (C.c * (r2 * 0.2 + 1.05)) - BRK_UP * (C.q * sqrt(C.Yi * ${TWO_G}) * (r3 * 0.3 + 0.7)) + C.tg * ((r4 - 0.5) * 0.6);
    BreakerSprayPoint pl = BreakerPlunge(C, r1, r2);
    float vUp = sqrt(C.Hc * (r3 * r3 * 1.0 + 0.3) * ${TWO_G});
    float3 vImp = BRK_UP * vUp + pl.n * (r4 * 1.5) + C.d3 * (C.c * (r2 * 0.6 + 0.15) - 0.3) + C.tg * ((r4 - 0.5) * 2.0);
    BreakerSprayPoint fr = BreakerFacePoint(C, r1 * r1 * 0.7);
    float3 vRol = C.d3 * (C.c * (r2 * 0.3 + 0.95)) + BRK_UP * ((r3 * 1.6 + 0.6) * sqrt(C.Hb / 0.5)) + fr.n * 0.5 + C.tg * ((r4 - 0.5) * 1.2);
    BreakerSprayPoint fc = BreakerFacePoint(C, r1 * 0.5 + 0.3);
    float3 vCl = BRK_UP * ((r3 * 1.6 + 0.8) * sqrt(C.Hb / 0.4)) + C.d3 * (r2 * 2.0 - 0.6) + C.tg * ((r4 - 0.5) * 1.5);
    float3 vDr = C.d3 * (-(C.offshore * (r2 * 0.3 + 0.35))) + BRK_UP * (r3 * 1.5 + 0.8) + C.tg * ((r4 - 0.5) * 0.5);
    float3 p = isLip ? BreakerTipAt(C, r1) : (isImp ? pl.p : (isRol ? fr.p + fr.n * 0.03 : (isCl ? fc.p + fc.n * 0.03 : C.root + BRK_UP * 0.04)));
    float3 v = isLip ? vLip : (isImp ? vImp : (isRol ? vRol : (isCl ? vCl : vDr)));
    float tail = pow(1.0 - r4 * 0.98, -0.7);
    float rDrop = min(((isImp || isCl) ? 0.001 : (isRol ? 0.0008 : (isLip ? 0.001 : 0.0005))) * tail, 0.012);
    float rLig = 0.005 + r4 * r4 * (isImp ? 0.016 : 0.008);
    SprayWrite(ring + j, p + BreakerAlong(C, r0), v, lig ? rLig : rDrop, lig ? SPRAY_LIGAMENT : SPRAY_DROPLET, 2.5, C.tag + r0 * 0.999);
  }
  return ring + n6;
}
`;

export const BREAKER_SPRAY_CLOUDS = `
uint BreakerSprayClouds(BreakerSprayContext C, float c0f, float4 c, uint ring) {
  uint c0 = uint(c0f); uint c1 = uint(c.x); uint c2 = uint(c.y); uint c3 = uint(c.z);
  [loop] for (uint j = 0u; j < c3; j++) {
    uint h = C.seed + j * 29u;
    float r0 = SprayRand(h, 41u, C.fs); float r1 = SprayRand(h, 42u, C.fs); float r2 = SprayRand(h, 43u, C.fs); float r3 = SprayRand(h, 44u, C.fs);
    bool isImp = j < c0; bool isSpit = j < c1; bool isRol = j < c2;
    float sz = isImp ? sqrt(C.Hc) * (r2 * r2 * r2 * 0.18 + 0.05) : (isSpit ? sqrt(C.Hc) * (r2 * r2 * 0.14 + 0.05) : (isRol ? sqrt(C.Hb / 0.5) * (r2 * r2 * 0.06 + 0.03) : 0.05 + r2 * r2 * 0.08));
    BreakerSprayPoint pl = BreakerPlunge(C, r1, r3);
    float3 pImp = pl.p + pl.n * (sz * 0.4) + BRK_UP * (r2 * C.Hc * 0.1);
    float3 vImp = BRK_UP * sqrt(C.Hc * (r3 * r3 * 0.95 + 0.35) * ${TWO_G}) + pl.n * 0.8 + C.d3 * (C.c * (r2 * 0.5 + 0.2)) + C.tg * ((r1 - 0.5) * 1.2);
    BreakerSprayPoint fs = BreakerFacePoint(C, r1 * 0.3 + 0.35);
    float3 pSpit = fs.p + fs.n * (sz * 0.5);
    float3 vSpit = C.d3 * (C.c * 0.7) + fs.n * 1.2 + C.tg * ((r1 - 0.5) * 4.0);
    BreakerSprayPoint fr = BreakerFacePoint(C, r1 * 0.4);
    float3 pRol = fr.p + fr.n * (sz * 0.4);
    float3 vRol = C.d3 * (C.c * 0.85) + BRK_UP * (r3 * 0.5 + 0.3);
    BreakerSprayPoint fc = BreakerFacePoint(C, r1 * 0.5 + 0.3);
    float3 pCl = fc.p + fc.n * (sz * 0.5);
    float3 vCl = BRK_UP * ((r3 * 1.2 + 0.8) * sqrt(C.Hb / 0.4)) + C.d3 * (r2 - 0.3);
    float3 p = (isImp ? pImp : (isSpit ? pSpit : (isRol ? pRol : pCl))) + BreakerAlong(C, r0);
    float3 v = isImp ? vImp : (isSpit ? vSpit : (isRol ? vRol : vCl));
    float life = isImp ? r3 * 0.5 + 1.0 : (isSpit ? 0.9 : r3 * 0.3 + 0.5);
    SprayWrite(ring + j, p, v, sz, SPRAY_SPRAY, life, C.tag + r0 * 0.999);
  }
  return ring + c3;
}
`;

export const BREAKER_SPRAY_MIST = `
uint BreakerSprayLipMist(BreakerSprayContext C, float count, uint ring) {
  uint mL = uint(count);
  [loop] for (uint j = 0u; j < mL; j++) {
    uint h = C.seed + j * 23u;
    float r0 = SprayRand(h, 61u, C.fs); float r1 = SprayRand(h, 62u, C.fs); float r2 = SprayRand(h, 63u, C.fs);
    float3 p = BreakerTipAt(C, r1 * 0.4) + BRK_UP * (r2 * 0.1) + BreakerAlong(C, r0);
    float3 v = C.d3 * (C.c * (r1 * 0.2 + 0.85)) + BRK_UP * (r2 * 0.8 + 0.3);
    SprayWrite(ring + j, p, v, (r2 * r2 * 0.2 + 0.1) * sqrt(C.Hc), SPRAY_MIST, r1 * 0.8 + 0.7, C.tag + r0 * 0.999);
  }
  return ring + mL;
}
uint BreakerSprayMist(BreakerSprayContext C, float m0f, float m1f, uint ring) {
  uint m0 = uint(m0f); uint m1 = uint(m1f);
  [loop] for (uint j = 0u; j < m1; j++) {
    uint h = C.seed + j * 17u;
    float r0 = SprayRand(h, 51u, C.fs); float r1 = SprayRand(h, 52u, C.fs); float r2 = SprayRand(h, 53u, C.fs); float r3 = SprayRand(h, 54u, C.fs);
    bool isImp = j < m0;
    BreakerSprayPoint pl = BreakerPlunge(C, r1, r3);
    BreakerSprayPoint ft = BreakerFacePoint(C, r1 * 0.3);
    float3 p = (isImp ? pl.p + pl.n * 0.2 + BRK_UP * (r2 * C.Hc * 0.4) : ft.p + ft.n * 0.15 + BRK_UP * (r2 * r2 * C.Hb * 0.35)) + BreakerAlong(C, r0);
    float3 v = isImp ? C.d3 * (C.c * (r1 * 0.3 + 0.4)) + BRK_UP * (r3 * 0.9 + 0.4) : C.d3 * (C.c * (r1 * 0.3 + 0.65)) + BRK_UP * (r2 * 0.4 + 0.15);
    float size = isImp ? sqrt(C.Hc) * (r3 * 0.3 + 0.45) : (r3 * r3 * 0.35 + 0.18) * sqrt(max(C.Hb, 0.2) / 0.6);
    float life = isImp ? r3 * 1.5 + 2.5 : r3 * r3 * 3.0 + 1.2;
    SprayWrite(ring + j, p, v, size, SPRAY_MIST, life, C.tag + r0 * 0.999);
  }
  return ring + m1;
}
`;

export const BREAKER_SPRAY_CREST = `${SPRAY_COMMON}${BREAKER_EMIT_ACCESS}${BREAKER_SPRAY_SEED}${BREAKER_SPRAY_COUNT}${BREAKER_SPRAY_RECORD}`;
