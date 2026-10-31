import { cloneElement } from 'react';
import { defineMaterial } from '../../../../shared/material';
import { SEA_LEVEL } from '../coastShape';
import { CREST_COLUMNS, CREST_TEXELS, LIP_PROFILE_VERTICES, STATION_RES, STATION_SPACING } from './breakerSpec';
import { LACE_TILE } from './oceanSpectrum';
import { shoreTexture } from './oceanShore';

const fixed = (value: number) => value.toFixed(6);

export const CREST_READ = `struct BreakerCrestRead {
  float4 At(Texture2D T, uint station, uint slot, uint n) {
    return T.Load(int3((station % ${CREST_COLUMNS}u) * ${CREST_TEXELS}u + slot * 3u + n, station / ${CREST_COLUMNS}u, 0));
  }
};`;

const vertex = (
  <custom
    description="BreakerLipVertex"
    outputType="Float3"
    inputs={{
      wp: <worldPosition worldPositionShaderOffset="ExcludeAllShaderOffsets" />,
      uv: <textureCoordinate />,
      segment: <perInstanceCustomData dataIndex={0} />,
      slot: <perInstanceCustomData dataIndex={1} />,
      C: shoreTexture('BreakerCrest'),
      F: shoreTexture('BreakerFade'),
    }}
    additionalOutputs={{ LipN: 'Float3', Lip: 'Float4', LipFade: 'Float1' }}
    code={`${CREST_READ}
BreakerCrestRead crest;
float k = round(uv.x);
uint side = uint(round(uv.y));
uint seg = uint(round(segment));
uint sl = uint(round(slot));
uint st = seg + side;
uint ot = seg + (1u - side);
float4 c0 = crest.At(C, st, sl, 0u);
float4 c1 = crest.At(C, st, sl, 1u);
float4 c2 = crest.At(C, st, sl, 2u);
float mOther = crest.At(C, ot, sl, 2u).w;
float bOther = crest.At(C, ot, sl, 0u).w;
bool valid = c2.w > 0.5 && abs(mOther - c2.w) < 0.5 && c0.w < 1.25 && bOther < 1.25;
float3 root = c0.xyz;
float4 fade = F.Load(int3(st % ${STATION_RES}u, st / ${STATION_RES}u, 0));
float taper = fade[sl];
float b = fade[2u + sl];
float3 back = c1.xyz;
float H = c1.w;
float3 d3 = float3(c2.x, 0.0, c2.y);
float trough = c2.z;
float q = clamp(b / 0.9, 0.0, 1.35) * taper;
float Xi = max(H * 0.8, 0.05);
float Yi = max(root.y - trough, 0.05);
float pv = k < 0.5 ? -1.0 : (k < 1.5 ? -0.45 : (k - 2.0) / ${fixed(LIP_PROFILE_VERTICES - 3)});
float xl = Xi * q * max(pv, 0.0);
float fl = xl / Xi;
float yl = -Yi * (fl * fl);
float3 onLip = root + d3 * xl + float3(0.0, yl, 0.0);
float3 onCap = lerp(root, back, max(-pv, 0.0)) + float3(0.0, 0.012, 0.0);
float3 P = pv < 0.0 ? onCap : onLip;
float slope = Yi * 2.0 * xl / (Xi * Xi);
LipN = normalize(float3(0.0, 1.0, 0.0) + d3 * slope);
Lip = float4(pv, b, float(st) * ${fixed(STATION_SPACING)}, Xi * q + Yi * q * q);
float capA = smoothstep(-1.0, -0.1, pv);
LipFade = capA * smoothstep(0.02, 0.12, q) * (1.0 - smoothstep(1.0, 1.2, b)) * taper;
P = valid ? P : float3(0.0, -1e5, 0.0);
return float3(P.x * 100.0, P.z * 100.0, P.y * 100.0 + ${fixed(SEA_LEVEL)}) - wp;`}
  />
);

const vertexOutput = (output: string) => <vertexInterpolator input={cloneElement(vertex, { output } as Record<string, unknown>)} />;

const SHADE = `struct BreakerOptics {
  float Fresnel(float cosI, float eta) {
    float c = clamp(cosI, 0.0, 1.0);
    float g2 = eta * eta - 1.0 + c * c;
    float g = sqrt(max(g2, 0.0));
    float a = (g - c) / (g + c);
    float b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
    return g2 < 0.0 ? 1.0 : 0.5 * a * a * (b * b + 1.0);
  }
};
BreakerOptics optics;
float PI = 3.14159265;
float v = lip.x; float b = lip.y; float a = lip.z; float len = lip.w;
float3 pos = float3(wpos.x, wpos.z, wpos.y) / 100.0;
float3 V = normalize(float3(view.x, view.z, view.y));
float3 Nw = normalize(lipN);
float3 dpx = ddx(pos);
float3 dpy = ddy(pos);
float3 Ng = cross(dpx, dpy);
Ng = dot(Ng, V) < 0.0 ? -Ng : Ng;
float3 N0 = dot(Nw, Ng) >= 0.0 ? Nw : -Nw;
float t = time;
float flowS = v * len - t * 1.1;
float aw = a + sin(a * 0.23 + 1.7) * 1.6 + sin(a * 0.61 + 4.2) * 0.4 + sin(a * 1.37 + 0.4) * 0.12;
float4 sv = Lc.Sample(LcSampler, float2(aw / 0.83, flowS / 3.0));
float4 sbv = Lc.Sample(LcSampler, float2(aw / 2.9, flowS / 9.0) + float2(0.37, 0.61));
float sb = sbv.z;
float hS = sv.x * 0.02 + sv.z * 0.012;
float3 r1 = cross(dpy, N0);
float3 r2 = cross(N0, dpx);
float det = dot(dpx, r1);
float3 grad = (r1 * ddx(hS) + r2 * ddy(hS)) * sign(det);
float3 N = normalize(N0 * abs(det) - grad + N0 * 1e-9);
float NdV = max(dot(N, V), 1e-3);
float F = optics.Fresnel(NdV, 1.333);
float3 L = normalize(float3(sun.x, sun.z, sun.y));
float3 sunE = sunIllum;
float3 skyE = skyIrr * PI;
float3 Rr = reflect(-V, N);
float3 R = normalize(float3(Rr.x, max(Rr.y, 0.004), Rr.z));
ReflDir = float3(R.x, R.z, R.y);
float3 Hh = normalize(L + V);
float3 spec = sunE * (pow(max(dot(N, Hh), 0.0), 180.0) * 12.0) * F;
float3 tint = float3(0.16, 0.62, 0.56);
float backLit = pow(saturate(dot(-V, L) * 0.5 + 0.5), 4.0);
float thin = lerp(1.5, 0.7, v) * (sv.z * 0.3 + 0.8) * (sb * 0.8 + 0.6);
float3 glow = (sunE * tint * (backLit * 0.9 + 0.08) + skyE * tint * 1.4) * thin;
float aW = F + min((1.0 - F) * lerp(0.42, 0.16, v) * (sv.x * 0.5 + 0.75) * (sb * 0.7 + 0.65), 0.85);
float3 waterRest = spec + glow * (1.0 - F) * 0.42;
float flowM = v * len - t * 1.1;
float4 fls = Lc.Sample(LcSampler, float2(aw / 1.9 + 0.53, flowM / 1.8));
float vary = fls.z - 0.5 + sin(aw * 0.29 + b * 2.1) * 0.15;
float tipN = sin(aw * 1.3 + t * 0.3) * 0.6 + sin(aw * 4.7 + 1.3) * 0.4;
float edge = v + tipN * 0.03 + vary * 0.04;
float thrown = smoothstep(0.35, 0.8, b);
float rim = smoothstep(0.9, 0.96, edge) * (fls.z * 0.2 + 0.2) * thrown;
float fing = (sv.w * 0.55 + sv.z * 0.2) * (smoothstep(0.25, 0.75, sbv.w * 0.6 + sb * 0.4) * 0.8 + 0.2) * 0.34;
float wh = smoothstep((1.0 - v) * 0.18 + 0.9 - fing, (1.0 - v) * 0.18 + 1.0 - fing, b);
float4 lc = Lc.Sample(LcSampler, float2(aw * 0.83 + 1.9, v * len - t * 1.3) / ${fixed(LACE_TILE * 0.8)});
float blot = lc.z * 0.7 + lc.y * 0.3;
float gone = smoothstep(1.0, 1.25, b);
float clumpW = smoothstep(gone - 0.12, gone + 0.12, blot);
float clumps = saturate((blot - gone) * 2.5);
float fil = (1.0 - smoothstep(0.02, 0.12, sv.x)) * smoothstep(0.15, 0.8, v) * (sv.w * 0.5 + 0.25) * (sb * 0.9 + 0.3) * thrown;
float aer = lerp(max(rim, fil), 0.95, wh);
float3 foamLit = (sunE * (max(dot(N, L), 0.0) * 0.5 + 0.5 + backLit * 1.2) / PI + skyE) * 0.9;
float tip = 1.0 - smoothstep(0.93, 1.0, edge);
float alpha = lipFade * tip * sheet * lerp(1.0, clumpW, wh);
float aF = aer * 0.92;
ReflK = F * (1.0 - aF) * alpha;
Alpha = (aF + aW * (1.0 - aF)) * alpha;
return (foamLit * lerp(1.0, clumps * 0.4 + 0.75, wh) * aF + waterRest * (1.0 - aF)) * alpha;`;

const shade = (
  <custom
    description="BreakerLipShade"
    outputType="Float3"
    inputs={{
      lipN: vertexOutput('LipN'),
      lip: vertexOutput('Lip'),
      lipFade: vertexOutput('LipFade'),
      wpos: <worldPosition />,
      view: <cameraVectorWS />,
      sun: <skyAtmosphereLightDirection lightIndex={0} />,
      sunIllum: <skyAtmosphereLightIlluminance lightIndex={0} />,
      skyIrr: <skyLightEnvMapSample direction={[0, 0, 1]} roughness={1} />,
      Lc: <textureObjectParameter parameterName="BreakerLace" texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" />,
      time: <time />,
      sheet: <scalarParameter parameterName="BreakerSheet" defaultValue={1} />,
    }}
    additionalOutputs={{ ReflDir: 'Float3', ReflK: 'Float1', Alpha: 'Float1' }}
    code={SHADE}
  />
);

const shadeOutput = (output: string) => cloneElement(shade, { output } as Record<string, unknown>);

const color = (
  <custom
    description="BreakerLipColor"
    outputType="Float3"
    inputs={{ base: shade, refl: <skyLightEnvMapSample direction={shadeOutput('ReflDir')} roughness={0} />, k: shadeOutput('ReflK') }}
    code="return base + refl * k;"
  />
);

export const breakerLip = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    shadingModel="Unlit"
    blendMode="AlphaComposite"
    twoSided
    emissiveColor={color}
    opacity={shadeOutput('Alpha')}
    worldPositionOffset={vertex}
  />,
);
