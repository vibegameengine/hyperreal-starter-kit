import { LACE_TILE } from './oceanSpectrum';
import { SHORE_EXTENT, SHORE_ORIGIN } from './oceanShore';

const FLOW_PERIOD = 1.2;
const MAX_FLOW = 2.5;
export const FOAM_BUMP = 0.7;

const f = (value: number) => value.toFixed(6);

export const surfFoamCode = `
struct SurfFoamArgs { float coverage; float foam; float footprint; float depth; float bubbles; float2 lagXZ; float3 normal; float3 baseNormal; float fresh; float sim; float4 simState; float roller; float3 P; float3 sun; };
struct SurfFoamInfo { float foam; float density; float height; float surf; float ww; float relief; float selfShadow; float cavity; float reliefPat; float reliefK; float thinPat; float thinK; float bubPat; float bubK; };
struct OceanSurfFoam {
  float time;
  float Hash11(float x) { return frac(sin(x * 91.7 + 17.3) * 43758.5453); }
  float Inside(float2 xz) {
    float2 uv = (xz - ${f(SHORE_ORIGIN)}) / ${f(SHORE_EXTENT)};
    return smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x) * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y);
  }
  float4 FlowLace(Texture2D Lc, SamplerState LcSampler, float2 q, float2 flow, float salt) {
    float t = time / ${f(FLOW_PERIOD)};
    float2 v = clamp(flow, -${f(MAX_FLOW)}, ${f(MAX_FLOW)}) * ${f(FLOW_PERIOD)};
    float4 o = 0.0;
    [unroll] for (int k = 0; k < 2; k++) {
      float tk = t + (float(k) * 0.5 + salt * 0.37);
      float ph = frac(tk);
      float cycle = floor(tk) + (float(k) * 13.1 + salt * 5.7);
      float2 jitter = float2(Hash11(cycle), Hash11(cycle + 0.5)) * 7.0;
      float2 p = (q - v * (ph - 0.5)) / ${f(LACE_TILE)} + jitter;
      float w = 1.0 - abs(ph * 2.0 - 1.0);
      o += Lc.Sample(LcSampler, p) * w;
    }
    return o;
  }
  float BigAt(Texture2D Lc, SamplerState LcSampler, float2 qq, float2 pflow) { return sqrt(FlowLace(Lc, LcSampler, qq / 6.0, pflow / 6.0, 2.0).x); }
  SurfFoamInfo Shade(Texture2D Lc, SamplerState LcSampler, SurfFoamArgs a, float2 dir) {
    float3 P = a.P;
    float2 xz = P.xz;
    float coverage = a.coverage;
    float opacity = a.foam;
    float density = saturate(coverage);
    float height = 0.0; float wwOut = 0.0; float wwRelief = 0.0; float wwShadow = 1.0; float wwCav = 1.0;
    float reliefPat = 0.0; float reliefK = 0.0; float thinPat = 0.0; float thinK = 0.0; float bubPat = 0.0; float bubK = 0.0;
    float surf = smoothstep(7.0, 3.0, a.depth) * Inside(xz);
    if (surf > 0.0 && coverage > 0.04) {
      float speed = a.simState.w;
      float2 flow = dir * speed;
      float steep = smoothstep(0.82, 0.5, a.baseNormal.y);
      float ww = saturate(a.fresh * 1.4);
      bool farOnly = a.footprint >= 0.12;
      float4 flat = 0.5;
      if (!farOnly) flat = FlowLace(Lc, LcSampler, xz, flow, 0.0);
      float4 lace = flat;
      float lumps = 0.5;
      float2 tangent = float2(-dir.y, dir.x);
      float al = dot(xz, tangent);
      float2 qv = float2(al + sin(al * 0.19 + 0.8) * 2.1 + sin(al * 0.47 + 2.9) * 0.6 + sin(P.y * 1.7 + al * 0.11) * 0.5, P.y * 1.1);
      if (steep > 0.01 && !farOnly) {
        float4 vert = FlowLace(Lc, LcSampler, qv, float2(0.0, -0.9), 1.0);
        lace = lerp(flat, vert, steep);
      }
      if (ww > 0.02 && !farOnly) {
        float3 L = a.sun;
        float2 pq = lerp(xz, qv, steep);
        float2 pflow = lerp(flow, float2(0.0, -0.9), steep);
        float big = BigAt(Lc, LcSampler, pq, pflow);
        float mid = sqrt(FlowLace(Lc, LcSampler, pq / 2.2, pflow / 2.2, 3.0).x);
        lumps = big * 0.6 + mid * 0.4;
        float A = 0.22;
        reliefPat = big * A + mid * (A * 0.45) + (1.0 - lace.x) * (A * 0.12);
        wwRelief = reliefPat * ww;
        float2 Lp = lerp(L.xz, float2(dot(L.xz, tangent), L.y * 1.1), steep);
        float2 Ld = Lp / max(length(Lp), 1e-3);
        float NdL = dot(a.normal, L);
        float tanE = NdL / max(length(L - a.normal * NdL), 0.05);
        float occ = 0.0;
        float steps[3] = { 0.14, 0.34, 0.7 };
        [unroll] for (int i = 0; i < 3; i++) {
          float d = steps[i];
          float hk = BigAt(Lc, LcSampler, pq + Ld * d, pflow);
          occ = max(occ, smoothstep(0.0, 0.05, (hk - big) * A - tanE * d));
        }
        wwShadow = 1.0 - occ * lerp(0.85, 0.7, steep);
        wwCav = lerp(0.5, 1.0, smoothstep(0.05, 0.75, lumps));
      }
      float boil = lace.x * 0.7 + lace.z * 0.3;
      float wwEdge = smoothstep(0.25, 0.75, ww * 1.35 - boil * 0.3 - (1.0 - lumps) * 0.5);
      float whitewater = (ww * 0.25 + wwEdge * 0.75) * ((1.0 - boil) * 0.12 + 0.88);
      float c = saturate((a.sim + max(coverage - a.sim - a.fresh, 0.0) * 0.5 - 0.05) / 0.95);
      float w = max(pow(c, 1.4) * 0.9 * (lace.z * 0.5 + 0.75) + (lace.y - 0.5) * 0.06, 0.0);
      float soft = 0.05 + a.footprint * 4.5;
      float mat = (1.0 - smoothstep(w - soft, w + soft, lace.x)) * smoothstep(0.0, 0.05, c);
      float bub = lace.y * smoothstep(w + 0.25, w, lace.x) * smoothstep(0.02, 0.2, c) * 0.5;
      float inner = saturate((w - lace.x) / 0.25);
      float laceFoam = max(mat * saturate(inner * 0.35 + 0.45 + lace.z * 0.3), bub);
      float far = smoothstep(0.03, 0.12, a.footprint);
      float average = max(saturate(pow(w, 1.45) * 1.9) * 0.8, ww * 0.95);
      float nearFoam = max(laceFoam, whitewater);
      opacity = lerp(a.foam, lerp(nearFoam, average, far), surf);
      density = max(saturate(c * 1.3) * (inner * 0.5 + 0.5), ww);
      float reliefThin = inner * saturate(c * 1.5);
      float relief = reliefThin * (1.0 - ww);
      wwOut = ww * (1.0 - far * 0.6);
      wwShadow = lerp(wwShadow, 0.82, far);
      wwCav = lerp(wwCav, 0.8, far);
      wwRelief *= 1.0 - far;
      height = (relief + a.bubbles * 0.15) * surf * (1.0 - far);
      reliefK = ww * (1.0 - far);
      thinPat = reliefThin;
      thinK = (1.0 - ww) * surf * (1.0 - far);
      bubPat = a.bubbles * 0.15;
      bubK = surf * (1.0 - far);
    }
    SurfFoamInfo o;
    o.foam = opacity; o.density = density; o.height = height; o.surf = surf; o.ww = wwOut; o.relief = wwRelief;
    o.selfShadow = wwShadow; o.cavity = wwCav; o.reliefPat = reliefPat; o.reliefK = reliefK;
    o.thinPat = thinPat; o.thinK = thinK; o.bubPat = bubPat; o.bubK = bubK;
    return o;
  }
  float3 ReliefNormal(SurfFoamInfo info, float3 N, float3 P) {
    float kb = ${f(FOAM_BUMP * 0.04)};
    float3 dpx = ddx(P);
    float3 dpy = ddy(P);
    float dhdx = ddx(info.reliefPat) * info.reliefK + (ddx(info.thinPat) * info.thinK + ddx(info.bubPat) * info.bubK) * kb;
    float dhdy = ddy(info.reliefPat) * info.reliefK + (ddy(info.thinPat) * info.thinK + ddy(info.bubPat) * info.bubK) * kb;
    float3 r1 = cross(dpy, N);
    float3 r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    float3 grad = (r1 * dhdx + r2 * dhdy) * sign(det);
    return normalize(N * abs(det) - grad + N * 1e-6);
  }
};
`;
