import { SHORE } from './oceanShore';
import { SPRAY_COLUMNS, SPRAY_KIND, SPRAY_RING, SPRAY_WIND, sprayByKind } from './spraySpec';
import { WAKE_CELL, WAKE_RES, WAKE_SIZE } from './wakeSpec';

const num = (value: number) => value.toFixed(6);

export const SPRAY_COMMON = `
static const float SPRAY_DROPLET = 0.0;
static const float SPRAY_MIST = 1.0;
static const float SPRAY_LIGAMENT = 2.0;
static const float SPRAY_SPRAY = 3.0;
static const float SPRAY_SHEET = 4.0;
static const float3 SPRAY_WIND_DIR = float3(${num(SPRAY_WIND.x)}, 0.0, ${num(SPRAY_WIND.z)});
static const float SPRAY_WIND_SPEED = ${num(SPRAY_WIND.speed)};
float SprayHash(uint seed) {
  uint state = seed * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return float((word >> 22u) ^ word) * (1.0 / 4294967296.0);
}
float SprayByKind(float kind, float a, float b, float c, float d, float e) {
  return kind < 0.5 ? a : (kind < 1.5 ? b : (kind < 2.5 ? c : (kind < 3.5 ? d : e)));
}
float SprayRand(uint a, uint b, uint frameSeed) { return SprayHash(a + b * 1664525u + frameSeed * 2654435761u); }
int2 SprayTexel(uint i) { return int2(i % ${SPRAY_COLUMNS}u, i / ${SPRAY_COLUMNS}u); }
`;

export const SPRAY_RING_WRITE = `
void SprayWrite(uint slot, float3 p, float3 v, float size, float kind, float life, float seed) {
  int2 at = SprayTexel(slot & ${SPRAY_RING - 1}u);
  PosStore(at, float4(p, 0.0));
  VelStore(at, float4(v, size));
  InfoStore(at, float4(kind, life, p.y, seed));
}
`;

export const SPRAY_WATER = `
float SprayWake(float2 xz) {
  float4 win = WakeWindow();
  float2 rel = abs(xz - win.xy);
  float edge = ${num(WAKE_SIZE / 2)} - max(rel.x, rel.y);
  if (win.z <= 0.0 || edge <= 0.5) return 0.0;
  float2 fp = xz / ${num(WAKE_CELL)} - 0.5;
  int2 i = int2(floor(fp)); float2 t = frac(fp); int m = ${WAKE_RES - 1};
  float a = WakeLoad(i & m).x; float b = WakeLoad((i + int2(1, 0)) & m).x;
  float c = WakeLoad((i + int2(0, 1)) & m).x; float d = WakeLoad((i + int2(1, 1)) & m).x;
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y) * smoothstep(0.5, 2.0, edge) * win.z;
}
float3 SprayWaterDisp(OceanShoreMath math, float2 x0) {
  float ground = math.HeightAt(0, x0);
  float3 d = BreakerFftDisp(math, x0, -ground);
  if (-ground < ${num(SHORE.deep)}) d += math.Evaluate(0, 1, x0, -math.WaveHeightAt(0, x0), ground).disp;
  d.y += SprayWake(x0);
  return d;
}
float SprayWaterHeight(OceanShoreMath math, float2 p) {
  float2 x0 = p;
  [unroll] for (int k = 0; k < 2; k++) x0 = p - SprayWaterDisp(math, x0).xz;
  return SprayWaterDisp(math, x0).y;
}
`;

export const SPRAY_BODY = `
float3 SprayAffine(float4 r0, float4 r1, float4 r2, float3 p) { return float3(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w); }
float3 SprayLinear(float4 r0, float4 r1, float4 r2, float3 v) { return float3(dot(r0.xyz, v), dot(r1.xyz, v), dot(r2.xyz, v)); }
float3 SprayBoxExit(float3 q, inout float3 n) {
  float3 b0 = BodyBoxMin().xyz; float3 b1 = BodyBoxMax().xyz;
  float dx = min(q.x - b0.x, b1.x - q.x); float dz = min(q.z - b0.z, b1.z - q.z); float dy = b1.y - q.y;
  if (dy < dx && dy < dz) { q.y = b1.y + 0.02; }
  else if (dx < dz) { bool right = q.x > (b0.x + b1.x) * 0.5; n = float3(right ? 1.0 : -1.0, 0.0, 0.0); q.x = right ? b1.x + 0.02 : b0.x - 0.02; }
  else { bool front = q.z > (b0.z + b1.z) * 0.5; n = float3(0.0, 0.0, front ? 1.0 : -1.0); q.z = front ? b1.z + 0.02 : b0.z - 0.02; }
  return q;
}
void SprayCollideBody(inout float3 p, inout float3 v, float age, inout float life, bool isMist) {
  float4 bodyVel = BodyVel();
  if (bodyVel.w < 0.5) return;
  float3 q = SprayAffine(BodyInv0(), BodyInv1(), BodyInv2(), p);
  float4 H = BodyHull(); float4 W = BodyHullWL(); float4 S = BodySheer();
  float sheer = lerp(S.x, S.y, saturate((q.z - H.x) / max(H.z - H.x, 0.01)));
  float fh = saturate(q.y / max(sheer, 0.1));
  float zSh = lerp(W.x, H.y, fh); float zSt = lerp(W.y, H.z, fh); float HB = lerp(W.z, H.w, fh);
  float bowL = max(zSt - zSh, 0.01);
  float e = saturate((q.z - zSh) / bowL);
  float c = sqrt(max(1.0 - e * e, 0.02));
  float hb = HB * c;
  bool inHull = q.z > H.x && q.z < zSt && abs(q.x) < hb && q.y < sheer && q.y > S.z;
  bool inBox = all(q > BodyBoxMin().xyz) && all(q < BodyBoxMax().xyz);
  if (!inHull && !inBox) return;
  float3 n = float3(0.0, 1.0, 0.0);
  if (inHull) {
    float sx = q.x > 0.0 ? 1.0 : -1.0;
    if (hb - abs(q.x) < sheer - q.y) { n = normalize(float3(sx, 0.0, HB * e / (c * bowL))); q.x = sx * (hb + 0.02); }
    else { q.y = sheer + 0.02; }
  } else {
    q = SprayBoxExit(q, n);
  }
  float3 nw = normalize(SprayLinear(BodyMat0(), BodyMat1(), BodyMat2(), n));
  float3 vr = v - bodyVel.xyz;
  float vn = dot(vr, nw);
  if (vn < 0.0) vr -= nw * vn;
  v = bodyVel.xyz + vr * 0.5;
  p = SprayAffine(BodyMat0(), BodyMat1(), BodyMat2(), q);
  life = min(life, isMist ? age + 0.25 : age);
}
`;

export const sprayRequestLookup = (names: readonly string[]) => `
float4 SprayRequest(uint k) {
  [branch] switch (k) {
${names.map((name, k) => `    case ${k}u: return ${name}();`).join('\n')}
    default: return float4(0.0, 0.0, 0.0, 0.0);
  }
}
`;

export const SPRAY_INTEGRATE = `
struct SprayParticle { float4 pos; float4 vel; float4 info; float4 death; };
SprayParticle SprayIntegrate(SprayParticle s, float dt, float time) {
  float3 p = s.pos.xyz; float3 v = s.vel.xyz; float age = s.pos.w + dt; float kind = s.info.x;
  float gust = sin(time * 0.7 + p.x * 0.05) * 0.25 + 0.85;
  float3 wind = SPRAY_WIND_DIR * (SPRAY_WIND_SPEED * 0.7 * gust);
  bool isMist = kind > 0.5 && kind < 1.5;
  float tau = ${sprayByKind('kind', SPRAY_KIND.tau)} * (isMist ? exp(age * -1.2) * 4.0 + 1.0 : 1.0);
  float grav = ${sprayByKind('kind', SPRAY_KIND.grav)};
  float seed = frac(s.info.w);
  float3 turb = float3(sin(age * 2.1 + seed * 40.0), sin(age * 1.7 + seed * 17.0) * 0.5, cos(age * 1.9 + seed * 29.0)) * ${sprayByKind('kind', SPRAY_KIND.turb)};
  v += ((wind - v) / tau + turb) * dt;
  v.y -= grav * dt;
  p += v * dt;
  float life = s.info.y;
  SprayCollideBody(p, v, age, life, isMist);
  OceanShoreMath math; math.time = time; math.enabled = 1.0;
  float hw = SprayWaterHeight(math, p.xz);
  float ground = math.HeightAt(0, p.xz);
  float top = max(hw, ground);
  s.death = float4(0.0, 0.0, 0.0, 0.0);
  if (p.y < top && v.y < 0.0 && age > 0.04) {
    if (${sprayByKind('kind', SPRAY_KIND.dies)} > 0.5) {
      life = 0.0;
      if (hw > ground + 0.02) s.death = float4(p.x, p.z, ${sprayByKind('kind', SPRAY_KIND.deposit)}, 1.0);
    } else {
      p.y = top + 0.02;
      v.y = max(v.y, 0.0);
      v = float3(v.x * 0.95, v.y, v.z * 0.95);
    }
  }
  if (age > life) life = 0.0;
  float size = s.vel.w * (1.0 + dt * ${sprayByKind('kind', SPRAY_KIND.grow)});
  s.pos = float4(p, age); s.vel = float4(v, size); s.info = float4(s.info.x, life, hw, s.info.w);
  return s;
}
`;

export const prefixScan = (shared: string, threads: number) => `
[unroll] for (uint offset = 1u; offset < ${threads}u; offset <<= 1u) {
  float carried = t >= offset ? ${shared}[t - offset] : 0.0;
  GroupMemoryBarrierWithGroupSync();
  ${shared}[t] += carried;
  GroupMemoryBarrierWithGroupSync();
}`;
