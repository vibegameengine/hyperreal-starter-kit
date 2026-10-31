import { COAST_HALF_SIZE, SWASH_RUNUP } from '../coastShape';

export const SHORE_EXTENT = (2 * COAST_HALF_SIZE) / 100;
export const SHORE_ORIGIN = -SHORE_EXTENT / 2;
export const SHORE_RES = 512;
export const SHORE_FIELD_RES = 128;
export const SHORE_TRAVEL_SIZE = 2048;
export const SWELL_DIRECTION = [0.0872, 0.9962] as const;
export const SHORE = {
  period: 9,
  amplitude: 0.34,
  variation: 0.55,
  gamma: 0.78,
  breakSpan: 0.13,
  curl: 1,
  alongSigma: 2.5,
  filmFloor: 0.35,
  runup: SWASH_RUNUP,
  turbidity: 0.16,
  beachSlope: 0.066,
  swashUp: 0.4,
  swashOnset: 0.2,
  swashDown: 0.55,
  swashOvershoot: 1.2,
  deep: 26,
} as const;

const f = (value: number) => value.toFixed(6);
const GRAVITY = 9.81;

export const shoreTexture = (name: string) => (
  <textureObjectParameter parameterName={name} texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" samplerSource="SSM_Clamp_WorldGroupSettings" />
);

export const shoreInputs = () => ({
  H: shoreTexture('OceanGround'),
  S: shoreTexture('OceanShore'),
  time: <time />,
  shoreOn: <scalarParameter parameterName="OceanShoreEnabled" defaultValue={0} />,
});

const NOISE = `
  uint Rotl(uint x, uint k) { return (x << k) | (x >> (32u - k)); }
  uint Final(uint a0, uint b0, uint c0) {
    uint a = a0; uint b = b0; uint c = c0;
    c ^= b; c -= Rotl(b, 14u); a ^= c; a -= Rotl(c, 11u); b ^= a; b -= Rotl(a, 25u); c ^= b; c -= Rotl(b, 16u);
    a ^= c; a -= Rotl(c, 4u); b ^= a; b -= Rotl(a, 14u); c ^= b; c -= Rotl(b, 24u);
    return c;
  }
  uint Hash2(int x, int y) { uint s = 0xdeadbeefu + (2u << 2u) + 13u; return Final(s + uint(x), s + uint(y), s); }
  float Grad2(uint hash, float x, float y) {
    uint h = hash & 7u; float u = h < 4u ? x : y; float v = 2.0 * (h < 4u ? y : x);
    return ((h & 1u) != 0u ? -u : u) + ((h & 2u) != 0u ? -v : v);
  }
  float Fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
  float Perlin2(float2 p) {
    float2 fl = floor(p); int X = int(fl.x); int Y = int(fl.y);
    float fx = p.x - fl.x; float fy = p.y - fl.y; float ux = Fade(fx); float uy = Fade(fy);
    float v0 = Grad2(Hash2(X, Y), fx, fy); float v1 = Grad2(Hash2(X + 1, Y), fx - 1.0, fy);
    float v2 = Grad2(Hash2(X, Y + 1), fx, fy - 1.0); float v3 = Grad2(Hash2(X + 1, Y + 1), fx - 1.0, fy - 1.0);
    float s1 = 1.0 - ux;
    return ((1.0 - uy) * (v0 * s1 + v1 * ux) + uy * (v2 * s1 + v3 * ux)) * 0.6616;
  }
  float Hash1(float x) { return frac(sin(x * 127.1 + 311.7) * 43758.5453); }
`;

export interface ShoreAccess {
  type: string;
  load: (texture: string, texel: string) => string;
}

export const MATERIAL_ACCESS: ShoreAccess = { type: 'Texture2D', load: (texture, texel) => `${texture}.Load(int3(${texel}, 0))` };

export const COMPUTE_ACCESS: ShoreAccess = {
  type: 'int',
  load: (texture, texel) => `(${texture} == 0 ? GroundLoad(${texel}) : FieldLoad(${texel}))`,
};

const fields = (access: ShoreAccess) => `
  float4 Bilinear(${access.type} T, float2 xz, float res, bool clampEdge) {
    float2 fp = (xz - ${f(SHORE_ORIGIN)}) / ${f(SHORE_EXTENT)} * res - 0.5;
    float2 fc = clamp(fp, 0.0, res - 1.001);
    int2 i = int2(floor(fc)); float2 t = frac(fc);
    float4 a = ${access.load('T', 'i')}; float4 b = ${access.load('T', 'i + int2(1, 0)')};
    float4 c = ${access.load('T', 'i + int2(0, 1)')}; float4 d = ${access.load('T', 'i + int2(1, 1)')};
    return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
  }
  float HeightAt(Texture2D H, float2 xz) {
    float2 fp = (xz - ${f(SHORE_ORIGIN)}) / ${f(SHORE_EXTENT)} * ${f(SHORE_RES)} - 0.5;
    bool outside = fp.x < 0.0 || fp.y < 0.0 || fp.x > ${f(SHORE_RES - 1)} || fp.y > ${f(SHORE_RES - 1)};
    return outside ? -90.0 : Bilinear(H, xz, ${f(SHORE_RES)}, true).x;
  }
  float WaveHeightAt(Texture2D H, float2 xz) {
    float2 fp = (xz - ${f(SHORE_ORIGIN)}) / ${f(SHORE_EXTENT)} * ${f(SHORE_RES)} - 0.5;
    bool outside = fp.x < 0.0 || fp.y < 0.0 || fp.x > ${f(SHORE_RES - 1)} || fp.y > ${f(SHORE_RES - 1)};
    return outside ? -90.0 : Bilinear(H, xz, ${f(SHORE_RES)}, true).y;
  }
  float2 RockNormal(Texture2D H, float2 xz) {
    float e = ${f(SHORE_EXTENT / SHORE_RES)};
    float gx = (HeightAt(H, xz + float2(e, 0.0)) - HeightAt(H, xz - float2(e, 0.0))) / (2.0 * e);
    float gz = (HeightAt(H, xz + float2(0.0, e)) - HeightAt(H, xz - float2(0.0, e))) / (2.0 * e);
    float3 n = normalize(float3(-gx, 1.0, -gz));
    return n.xz;
  }
  float4 ShoreSample(Texture2D S, float2 xz) { return Bilinear(S, xz, ${f(SHORE_FIELD_RES)}, true); }
`;

const WAVES = `
  float2 Bar(float along) {
    float w = sin(along * 0.021 + 1.9) * 1.4 + sin(along * 0.009 + 0.3) * 0.9;
    float r = sin(along * 0.059 + w);
    float width = 0.8 + sin(along * 0.017 + 4.1) * 0.08;
    float rip = smoothstep(width, 0.985, r);
    float bar = 0.9 + (sin(along * 0.031 + 7.3) * 0.6 + sin(along * 0.083 + 1.1) * 0.4) * 0.14;
    return float2(bar * (1.0 - rip * 0.58), rip);
  }
  float Wobble(float along) {
    return sin(along * 0.029 + 0.7) * 0.07 + sin(along * 0.083 + 2.1) * 0.035 + sin(along * 0.19 + 0.4) * 0.022 + sin(along * 0.37 + 2.6) * 0.011 + Bar(along).y * 0.045;
  }
  float WaveAmp(float m, float along) {
    float waveSet = abs(sin(m * ${f(Math.PI / 7)})) * 0.6 + 0.55;
    float rnd = (Hash1(m) - 0.5) * 2.0;
    float warp = sin(along * 0.016 + m * 0.9) * 1.6;
    float a1 = sin(along * 0.062 + m * 1.7 + warp);
    float a2 = sin(along * 0.13 + m * 4.1 + 1.3 - warp * 0.7);
    float a3 = sin(along * 0.29 + m * 2.3 + warp * 0.5) * 0.6 + sin(along * 0.47 + m * 5.9 + 0.8) * 0.4;
    float alongV = a1 * 0.6 + a2 * 0.4 + a3 * 0.28;
    return max(${f(SHORE.amplitude)} * waveSet * (1.0 + rnd * ${f(SHORE.variation)} * 0.5 + alongV * ${f(SHORE.variation)} * 0.7) * Bar(along).x, 0.02);
  }
  float BreakProgress(float A, float d) {
    float db = pow(A * 3.556 / ${f(SHORE.gamma)}, 0.8);
    return (db - d) / (db * ${f(SHORE.breakSpan)});
  }
  float4 AlongTaps(float m, float along, float d) {
    float s = ${f(SHORE.alongSigma)};
    return float4(BreakProgress(WaveAmp(m, along - 2.0 * s), d), BreakProgress(WaveAmp(m, along - s), d), BreakProgress(WaveAmp(m, along + s), d), BreakProgress(WaveAmp(m, along + 2.0 * s), d));
  }
  float Bs(OceanShoreBreak P, float e0, float e1) {
    float a = e0 - P.bw; float c = e1 + P.bw;
    return (smoothstep(a, c, P.b) + (smoothstep(a, c, P.taps.y) + smoothstep(a, c, P.taps.z)) * ${f(Math.exp(-0.5))} + (smoothstep(a, c, P.taps.x) + smoothstep(a, c, P.taps.w)) * ${f(Math.exp(-2))}) * ${f(1 / (1 + 2 * Math.exp(-0.5) + 2 * Math.exp(-2)))};
  }
  OceanShoreBreak BreakParams(float A, float d, float4 taps) {
    OceanShoreBreak P;
    P.taps = taps;
    P.bw = abs(taps.z - taps.y) * 0.5;
    P.db = pow(A * 3.556 / ${f(SHORE.gamma)}, 0.8);
    P.b = (P.db - d) / (P.db * ${f(SHORE.breakSpan)});
    float shoal = pow(10.0 / clamp(d, 0.35, 10.0), 0.25);
    P.Ash = A * shoal;
    P.p = lerp(1.0, 3.0, Bs(P, -2.5, 0.0));
    P.meanP = 1.0 / sqrt((P.p + 0.25) * 3.14159265);
    P.crestPeak = 1.0 + Bs(P, -1.0, 0.3) * 0.22;
    P.yc = P.Ash * 2.0 * (1.0 - P.meanP) * P.crestPeak;
    P.yt = P.Ash * -2.0 * P.meanP * P.crestPeak;
    P.H = P.yc - P.yt;
    P.wBore = Bs(P, 0.85, 1.35);
    P.Xi = P.H * 0.8;
    P.Hb = min(P.H * 0.6, max(d, 0.0) * 0.75) * (smoothstep(0.0, 0.3, d) * 0.7 + 0.3);
    P.ycB = lerp(P.yc, P.yt * 0.6 + P.Hb, P.wBore);
    P.ytB = lerp(P.yt, P.yt * 0.6, P.wBore);
    P.Xc = lerp(0.0, P.Xi - P.Hb * 0.55, P.wBore) * smoothstep(0.03, 0.3, P.Hb);
    P.Wt = lerp(P.H * lerp(0.25, 0.55, Bs(P, 0.1, 0.9)), P.Hb * 0.6 + 0.08, P.wBore);
    return P;
  }
  float FaceFill(OceanShoreBreak P, float s) { float k = (1.0 - s) * 0.45; return smoothstep(k + 0.9, k + 1.08, P.b); }
  float Whitewater(float xi, float lam, OceanShoreBreak P) {
    float landed = smoothstep(0.86, 0.99, P.b);
    float spread = saturate((P.b - 0.9) / 0.45);
    float reach = P.Xi * 0.25 + spread * (P.Xi * 0.9 + 1.0);
    float impact = landed * smoothstep(reach, reach * 0.6, abs(xi - P.Xi)) * (1.0 - smoothstep(1.4, 1.9, P.b));
    float toe = P.Xc + P.Wt;
    float faceFill = FaceFill(P, saturate((xi - P.Xc) / max(P.Wt, 0.05)));
    float wFoam = smoothstep(0.85, 1.35, P.b);
    float ahead = exp((xi - toe) * -3.0) * wFoam;
    float behind = exp((P.Xc - xi) / lam * -16.0) * wFoam;
    float roller = xi > toe ? ahead : (xi < P.Xc ? behind : max(faceFill, wFoam));
    return saturate(max(impact, roller));
  }
  OceanShoreProfile Profile(float u, float lam, OceanShoreBreak P, bool withFoam) {
    float tau = 6.28318530718;
    float skew = Bs(P, -3.0, 0.0) * 0.55;
    float phi = u - skew * (1.0 - cos(u * tau)) / tau;
    float c = max((cos(phi * tau) + 1.0) * 0.5, 0.0);
    float yPre = P.Ash * 2.0 * (pow(c, P.p) - P.meanP) * P.crestPeak;
    float Q = Bs(P, -3.0, 0.0) * 0.25 + 0.1;
    float xPre = sin(u * tau) * P.Ash * Q;
    float uf = 0.09;
    bool inFace = u > -uf;
    float th = clamp(-u / uf, 0.0, 1.0) * 1.57079633;
    float fx = lerp(1.0 - cos(th), sin(th), P.wBore);
    float fy = lerp(1.0 - sin(th), cos(th), P.wBore);
    float sTr = clamp((-u - uf) / (0.5 - uf), 0.0, 1.0);
    float ul = u * lam;
    float xFront = (inFace ? P.Xc + P.Wt * fx : lerp(P.Xc + P.Wt, lam * 0.5, sTr)) + ul;
    float yFront = inFace ? P.ytB + (P.ycB - P.ytB) * fy : P.ytB;
    float cb = pow(max((cos(u * (tau * 0.85)) + 1.0) * 0.5, 0.0), P.p);
    float yBack = P.ytB + (P.ycB - P.ytB) * lerp(cb, exp(u * -7.0), P.wBore);
    float xBack = P.Xc * exp(u * -6.0) * smoothstep(0.5, 0.35, u) + xPre * (1.0 - P.wBore);
    bool front = u < 0.0;
    float wC = Bs(P, -0.35, 0.25) * ${f(SHORE.curl)};
    OceanShoreProfile r;
    r.x = lerp(xPre, front ? xFront : xBack, wC);
    r.y = lerp(yPre, front ? yFront : yBack, wC);
    r.b = P.b;
    r.foam = 0.0; r.face = 0.0; r.roller = 0.0;
    if (withFoam) {
      r.foam = Whitewater(r.x - u * lam, lam, P);
      bool onFace = front && inFace;
      float faceFill = FaceFill(P, fx);
      r.face = (onFace ? 1.0 : 0.0) * smoothstep(-0.4, 0.0, P.b) * (1.0 - faceFill);
      r.roller = (front ? (inFace ? 1.0 : 0.0) : exp(u * -25.0)) * smoothstep(0.85, 1.35, P.b) * P.Hb * wC;
    }
    return r;
  }
  float BreakDepth(Texture2D H, float2 xz, float2 dir, float u, float lam, float d) {
    float2 pc = xz + dir * (u * lam);
    float dc = -WaveHeightAt(H, pc);
    return lerp(dc, d, smoothstep(0.3, 0.5, abs(u)));
  }
  OceanShorePhase PhaseAt(Texture2D H, Texture2D S, float2 xz) {
    OceanShorePhase ph;
    ph.sh = ShoreSample(S, xz);
    ph.T = ph.sh.x;
    float2 dirE = ph.sh.yz;
    ph.exposure = length(dirE);
    ph.dir = dirE / max(ph.exposure, 1e-4);
    float4 g = Bilinear(H, xz, ${f(SHORE_RES)}, true);
    ph.along = g.z;
    ph.s = (time - ph.T) / ${f(SHORE.period)} + Wobble(ph.along);
    return ph;
  }
  OceanShoreRunup SwashRunup(float4 sh, float along, float groundH) {
    OceanShoreRunup r;
    float Tp = ${f(SHORE.period)};
    float exposure = length(sh.yz);
    r.inland = max(groundH, 0.0) / ${f(SHORE.beachSlope)};
    float ss = (time - sh.w) / Tp + Wobble(along);
    float ms = floor(ss);
    r.tau = ss - ms;
    float Am = WaveAmp(ms, along);
    r.RhMax = Am * 2.1 * ${f(SHORE.runup)} * saturate(exposure * 1.4) / ${f(SHORE.beachSlope)};
    r.su = saturate(r.tau / ${f(SHORE.swashUp)});
    r.sb = saturate((r.tau - ${f(SHORE.swashUp)}) / ${f(SHORE.swashDown)});
    r.isUp = r.tau < ${f(SHORE.swashUp)};
    float Rh = (r.isUp ? 1.0 - pow(1.0 - r.su, 1.5) : 1.0 - pow(r.sb, 1.6)) * r.RhMax - 0.3;
    float lobes = sin(along * 0.61 + ms * 2.3) * 0.5 + sin(along * 1.73 + ms * 5.1) * 0.3 + sin(along * 4.3 + ms * 1.7) * 0.2;
    float lobedRh = Rh + lobes * (max(Rh, 0.0) * 0.07 + 0.35);
    r.Rt = max(lobedRh, ${f(SHORE.filmFloor)}) * enabled;
    r.edgeTau = lerp(r.tau, 1.0, smoothstep(-0.3, 0.3, ${f(SHORE.filmFloor)} - lobedRh));
    return r;
  }
  float4 SwashEdge(Texture2D H, Texture2D S, float2 p, float t) {
    float4 o = float4(t, 1e3, 0.0, 0.0);
    if (t < 0.3) {
      float g = HeightAt(H, p);
      if (g > -0.8) {
        OceanShorePhase ph = PhaseAt(H, S, p);
        OceanShoreRunup r = SwashRunup(ph.sh, ph.along, g);
        float front = r.Rt - r.inland;
        float w = smoothstep(-0.8, -0.4, g) * smoothstep(0.3, 0.15, t);
        if (w > 0.0) o = float4(lerp(t, min(t, front * 0.08), w), front / max(w, 1e-3), r.edgeTau, r.Rt * w);
      }
    }
    return o;
  }
  float SurfMedium(float4 sh, float depth) {
    if (depth >= 4.5 || depth <= -0.2) return 0.0;
    float expo = saturate(length(sh.yz) * 1.4);
    return smoothstep(4.5, 1.2, depth) * smoothstep(-0.2, 0.15, depth) * expo * ${f(SHORE.turbidity)} * enabled;
  }
  float CascadeAttenuation(int c, float depth) {
    ${'float d0[4] = { D0 }; float floorAmt[4] = { 0.0, 0.05, 0.25, 0.5 };'}
    float a = smoothstep(0.0, d0[c], depth);
    return lerp(floorAmt[c] * smoothstep(0.0, 0.6, depth), 1.0, a);
  }
  OceanShoreSample Evaluate(Texture2D H, Texture2D S, float2 xz, float depth, float groundH, float overshoot) {
    OceanShorePhase ph = PhaseAt(H, S, xz);
    float Tp = ${f(SHORE.period)};
    float d = depth;
    float c = sqrt(clamp(d, 0.3, 25.0) * ${f(GRAVITY)});
    float lam = c * Tp;
    float m = floor(ph.s + 0.5);
    float u = ph.s - m;
    float A0 = WaveAmp(m, ph.along);
    float An = WaveAmp(m + sign(u), ph.along);
    float A = lerp(A0, An, smoothstep(0.32, 0.5, abs(u)) * 0.5);
    float dB = BreakDepth(H, xz, ph.dir, u, lam, d);
    float env = smoothstep(26.0, 13.0, d) * smoothstep(-0.25, 0.05, d) * saturate(ph.exposure * 1.4) * enabled;
    float e = 0.15;
    OceanShoreBreak P = BreakParams(A, dB, AlongTaps(m, ph.along, dB));
    OceanShoreProfile s0 = Profile(u, lam, P, true);
    OceanShoreProfile s1 = Profile(u - e / lam, lam, P, false);
    float face = s0.face * env;
    float roller = s0.roller * env;
    float3 disp = float3(ph.dir.x * s0.x, s0.y, ph.dir.y * s0.x) * env;
    float dX = e + (s1.x - s0.x) * env;
    float dY = (s1.y - s0.y) * env;
    float3 tAlong = float3(ph.dir.x * dX, dY, ph.dir.y * dX);
    float3 tAcross = float3(-ph.dir.y, 0.0, ph.dir.x);
    float3 n = normalize(cross(tAcross, tAlong) + float3(0.0, 1e-4, 0.0));
    float3 nShore = normalize(float3(n.x, max(n.y, 0.04), n.z));
    if (roller != 0.0) {
      float sx = u * lam;
      float t = time;
      float lumpy = saturate(Perlin2(float2(ph.along * 0.045, m * 3.7)) * 1.2 + 0.55);
      float amp = roller * lerp(0.25, 0.7, lumpy);
      float2 q1 = float2(ph.along * 0.28, sx * 0.7 - t * 0.8);
      float2 q2 = float2(ph.along * 0.8 + 11.3, sx * 1.6 - t * 1.5);
      float eL = 0.25;
      float L0 = Perlin2(q1) * 0.7 + Perlin2(q2) * 0.3;
      float La = Perlin2(q1 + float2(eL * 0.28, 0.0)) * 0.7 + Perlin2(q2 + float2(eL * 0.8, 0.0)) * 0.3;
      float Ls = Perlin2(q1 + float2(0.0, eL * 0.7)) * 0.7 + Perlin2(q2 + float2(0.0, eL * 1.6)) * 0.3;
      float lump = max(L0 * 1.5 + 0.2, -0.3);
      disp.y += lump * amp;
      bool up = L0 * 1.5 + 0.2 > -0.3;
      float dAlong = up ? (La - L0) / eL * 1.5 : 0.0;
      float dSx = up ? (Ls - L0) / eL * 1.5 : 0.0;
      float2 g = (float2(-ph.dir.y, ph.dir.x) * dAlong + ph.dir * -dSx) * amp * n.y;
      nShore = normalize(float3(n.x - g.x, max(n.y, 0.04), n.z - g.y));
    }
    OceanShoreRunup swr = SwashRunup(ph.sh, ph.along, groundH);
    float front = swr.Rt - swr.inland;
    float fm = front + max(${f(SHORE.swashOvershoot)}, overshoot);
    float thick = clamp(min(fm * 0.3, max(fm - 0.1, 0.0) * (${f(SHORE.beachSlope)} * 0.22) + 0.03), -0.1, 0.12);
    float wwPatch = 0.0;
    if (s0.foam * env != 0.0) wwPatch = smoothstep(-0.5, 0.45, Perlin2(float2(ph.along * 0.06, m * 2.9 + 0.4)));
    OceanShoreSample o;
    o.disp = disp; o.nShore = nShore; o.env = env;
    o.foam = s0.foam * env * lerp(0.3, 1.0, wwPatch);
    o.swashLevel = groundH + thick; o.face = face; o.roller = roller;
    return o;
  }
  float CrestPath(Texture2D H, Texture2D S, float2 p, float d, float3 T) {
    float o = 1e4;
    if (d >= 6.0 || enabled <= 0.0) return o;
    OceanShorePhase ph = PhaseAt(H, S, p);
    float tXi = dot(T.xz, ph.dir);
    float env = smoothstep(26.0, 13.0, d) * saturate(ph.exposure * 1.4) * enabled;
    if (env > 0.05 && tXi < -0.05) {
      float lam = sqrt(clamp(d, 0.3, 25.0) * ${f(GRAVITY)}) * ${f(SHORE.period)};
      float m = floor(ph.s + 0.5);
      float u = ph.s - m;
      float A = WaveAmp(m, ph.along);
      float dB = BreakDepth(H, p, ph.dir, u, lam, d);
      OceanShoreBreak P = BreakParams(A, dB, AlongTaps(m, ph.along, dB));
      OceanShoreProfile s0 = Profile(u, lam, P, false);
      float y0 = s0.y * env;
      if (y0 > A * 0.2 && P.b > -1.5) {
        float xi0 = -u * lam + s0.x * env;
        float slope = T.y / -tXi;
        float prevGap = 0.0; float prevDist = 0.0; float off = 1.1;
        [loop] for (int k = 0; k < 3; k++) {
          float uk = min(u + off / lam, 0.5);
          OceanShoreProfile sk = Profile(uk, lam, P, false);
          float dist = abs(xi0 - (-uk * lam + sk.x * env));
          float gap = y0 + slope * dist - sk.y * env;
          if (gap > 0.0) {
            float fr = -prevGap / max(gap - prevGap, 1e-4);
            o = lerp(prevDist, dist, saturate(fr)) / -tXi;
            break;
          }
          prevGap = gap; prevDist = dist; off *= 2.6;
        }
      }
    }
    return o;
  }
  OceanShoreWorld World(Texture2D H, Texture2D S, float2 xz, float depth, float groundH) {
    OceanShorePhase ph = PhaseAt(H, S, xz);
    float Tp = ${f(SHORE.period)};
    float d = depth;
    float c = sqrt(clamp(d, 0.3, 25.0) * ${f(GRAVITY)});
    float lam = c * Tp;
    float m = floor(ph.s + 0.5);
    float u = ph.s - m;
    float A0 = WaveAmp(m, ph.along);
    float An = WaveAmp(m + sign(u), ph.along);
    float A = lerp(A0, An, smoothstep(0.32, 0.5, abs(u)) * 0.5);
    float dB = BreakDepth(H, xz, ph.dir, u, lam, d);
    float env = smoothstep(26.0, 13.0, d) * smoothstep(-0.25, 0.05, d) * saturate(ph.exposure * 1.4) * enabled;
    OceanShoreBreak P = BreakParams(A, dB, AlongTaps(m, ph.along, dB));
    OceanShoreProfile s0 = Profile(u, lam, P, false);
    OceanShoreProfile s1 = Profile(u + s0.x * env / lam, lam, P, false);
    float whitewater = Whitewater(-u * lam, lam, P);
    float eta = s1.y * env;
    OceanShoreRunup swr = SwashRunup(ph.sh, ph.along, groundH);
    float front = swr.Rt - swr.inland;
    bool covered = front > 0.0;
    float dRdt = (swr.isUp ? pow(1.0 - swr.su, 0.5) * (1.5 / ${f(SHORE.swashUp)}) : pow(max(swr.sb, 1e-3), 0.6) * (-1.6 / ${f(SHORE.swashDown)})) * swr.RhMax / Tp;
    float uprush = smoothstep(0.0, ${f(SHORE.swashOnset)}, swr.edgeTau) * smoothstep(0.46, 0.32, swr.edgeTau);
    float edge = smoothstep(0.8, 0.0, front) * smoothstep(-0.05, 0.05, front) * uprush * smoothstep(0.0, 1.0, swr.Rt);
    float uWave = clamp(c * eta / (max(d, 0.0) + max(eta, d * -0.8) + 0.15), -2.5, 4.0);
    float rel = saturate(swr.inland / max(swr.Rt, 0.5));
    float uSwash = dRdt * (swr.isUp ? clamp((swr.inland + 3.0) / (swr.Rt + 3.0), 0.15, 1.0) : (1.0 - rel) * 0.6 + 0.9);
    float wSwash = smoothstep(0.3, 0.05, d);
    float uFlow = lerp(uWave, uSwash, wSwash) * ((covered || d > 0.02) ? 1.0 : 0.0);
    float wwPatch = 0.0;
    if (whitewater * env != 0.0) wwPatch = smoothstep(-0.5, 0.45, Perlin2(float2(ph.along * 0.06, m * 2.9 + 0.4)));
    OceanShoreWorld o;
    o.foam = whitewater * env * lerp(0.3, 1.0, wwPatch);
    o.swashFoam = edge * 0.9;
    o.runup = swr.Rt; o.inland = swr.inland;
    o.dir = ph.dir; o.flow = ph.dir * uFlow;
    return o;
  }
`;

export const shoreMath = (cascadeSizes: readonly number[], access: ShoreAccess = MATERIAL_ACCESS) => `
struct OceanShoreBreak { float4 taps; float bw; float db; float b; float Ash; float p; float meanP; float crestPeak; float yc; float yt; float H; float wBore; float Xi; float Hb; float ycB; float ytB; float Xc; float Wt; };
struct OceanShoreProfile { float x; float y; float b; float foam; float face; float roller; };
struct OceanShorePhase { float4 sh; float T; float2 dir; float exposure; float along; float s; };
struct OceanShoreRunup { float tau; float edgeTau; float Rt; float inland; float RhMax; float su; float sb; bool isUp; };
struct OceanShoreSample { float3 disp; float3 nShore; float env; float foam; float swashLevel; float face; float roller; };
struct OceanShoreWorld { float foam; float swashFoam; float runup; float inland; float2 dir; float2 flow; };
struct OceanShoreMath {
  float time;
  float enabled;
${NOISE}${(fields(access) + WAVES.replace('{ D0 }', `{ ${cascadeSizes.map((size) => f(Math.min(40, size * 0.08))).join(', ')} }`)).replaceAll('Texture2D ', `${access.type} `)}};
`;
