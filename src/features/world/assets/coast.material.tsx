import { cloneElement } from 'react';
import { defineMaterial } from '../../../shared/material';
import { COAST_LAYERS, type CoastLayer } from './coastTextures';
import { SEA_LEVEL } from './coastShape';
import { SHORE_EXTENT, SHORE_ORIGIN, shoreTexture } from './ocean/oceanShore';
import { LACE_SIZE, LACE_TILE, LOCAL_SEA } from './ocean/oceanSpectrum';
import { TRAIL_RES, TRAIL_SPAN, TRAIL_TEXEL } from './sand/sandTrailSpec';
import { scanGround } from './scanLayers';

const MACRO_OF: Record<CoastLayer, 'MacroSand' | 'MacroLand'> = { Ground: 'MacroLand', Rock: 'MacroLand', Shore: 'MacroSand', Sand: 'MacroSand' };
const WET_DARKEN = 0.55;
const RESIDUE_COLOR = [0.88, 0.9, 0.9];
const POND = { darken: 0.25, roughness: 0.06, flatten: 0.85 } as const;

const f = (value: number) => value.toFixed(6);
const WIND_DIRECTION = (LOCAL_SEA.windDirection * Math.PI) / 180;
const RIPPLE = { wavelength: 0.105, relief: 0.005 } as const;

const RIPPLE_NOISE = `struct RippleNoise {
  float2 Hash(float2 p) { p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3))); return frac(sin(p) * 43758.5453) * 2.0 - 1.0; }
  float Noise(float2 p) {
    float2 i = floor(p); float2 q = frac(p); float2 u = q * q * q * (q * (q * 6.0 - 15.0) + 10.0);
    float a = dot(Hash(i), q); float b = dot(Hash(i + float2(1.0, 0.0)), q - float2(1.0, 0.0));
    float c = dot(Hash(i + float2(0.0, 1.0)), q - float2(0.0, 1.0)); float d = dot(Hash(i + 1.0), q - 1.0);
    return lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y) * 1.4;
  }
};`;

const TRAIL_SAMPLE = `struct SandTrail {
  float4 At(Texture2D T, float2 xz) {
  float2 fp = xz / ${f(TRAIL_TEXEL)} - 0.5;
  int2 i = int2(floor(fp)); float2 t = frac(fp); int m = ${TRAIL_RES - 1};
  float4 a = T.Load(int3(i & m, 0)); float4 b = T.Load(int3((i + int2(1, 0)) & m, 0));
  float4 c = T.Load(int3((i + int2(0, 1)) & m, 0)); float4 d = T.Load(int3((i + int2(1, 1)) & m, 0));
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
  }
  float Height(Texture2D T, float2 xz) { float4 v = At(T, xz); return v.y - v.x; }
};`;

const ground = scanGround(COAST_LAYERS.map((layer) => ({ name: layer, set: layer, macro: MACRO_OF[layer], wet: layer === 'Sand' })));

const shoreSand = (
  <custom
    description="ShoreSand"
    outputType="Float3"
    inputs={{
      albedo: ground.baseColor,
      rough: ground.roughness,
      groundN: ground.normal,
      sandW: <landscapeLayerSample parameterName="Sand" previewWeight={0} />,
      p: <worldPosition />,
      St: shoreTexture('OceanShoreState'),
      Lc: <textureObjectParameter parameterName="OceanLace" texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" />,
      shoreOn: <scalarParameter parameterName="OceanShoreEnabled" defaultValue={0} />,
      Tr: <textureObjectParameter parameterName="SandTrail" texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" />,
      trailWin: <vectorParameter parameterName="SandTrailWindow" defaultValue={[0, 0, 0, 0]} />,
    }}
    additionalOutputs={{ Rough: 'Float1', Normal: 'Float3' }}
    code={`${RIPPLE_NOISE}
${TRAIL_SAMPLE}
RippleNoise rn;
SandTrail st;
float2 xz = p.xy / 100.0;
float h = (p.z - ${f(SEA_LEVEL)}) / 100.0;
float2 uv = (xz - ${f(SHORE_ORIGIN)}) / ${f(SHORE_EXTENT)};
float inside = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x) * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y) * step(0.5, shoreOn);
float4 s = inside > 0.0 ? St.SampleLevel(StSampler, uv, 0.0) * inside : 0.0;
float band = smoothstep(0.45, 0.0, h);
float wet = saturate(max(s.y, band * (1.0 - inside)));
float fp = length(fwidth(xz)) / ${f(LACE_TILE)} * ${f(LACE_SIZE)};
float residue = 0.0;
if (s.z > 0.01) {
  float4 lace = Lc.SampleLevel(LcSampler, (xz + 11.3) / ${f(LACE_TILE)}, 0.0);
  float nearK = smoothstep(3.0, 1.2, fp);
  float keep = smoothstep(lace.w * 0.55, lace.w * 0.55 + 0.08, s.z);
  float lw = s.z * 0.1 + 0.06;
  float strand = (1.0 - smoothstep(lw, lw + 0.07, lace.x)) * (lace.z * 0.5 + 0.6);
  float lines = max(strand * smoothstep(0.02, 0.25, s.z) * keep, lace.y * keep * 0.8);
  residue = lerp(smoothstep(0.08, 0.6, s.z) * 0.12, lines, nearK) * 0.85;
}
float2 trailGrad = 0.0;
float trailDepth = 0.0;
float trailWater = 0.0;
float2 fromCentre = abs(xz - trailWin.xy);
float trailIn = trailWin.z * saturate((${f(TRAIL_SPAN * 0.45)} - max(fromCentre.x, fromCentre.y)) / 1.0);
if (trailIn > 0.0) {
  float4 tC = st.At(Tr, xz);
  float hC = tC.y - tC.x; float hX = st.Height(Tr, xz + float2(${f(TRAIL_TEXEL)}, 0.0)); float hY = st.Height(Tr, xz + float2(0.0, ${f(TRAIL_TEXEL)}));
  trailDepth = -min(hC, 0.0) * trailIn;
  trailWater = saturate(tC.w) * smoothstep(0.0005, 0.002, trailDepth);
  trailGrad = float2(hX - hC, hY - hC) / ${f(TRAIL_TEXEL)} * trailIn * (1.0 - trailWater * ${f(POND.flatten)});
}
float dryEdge = smoothstep(0.0, 0.6, wet) * smoothstep(1.0, 0.6, wet);
float wetK = max(wet * (1.0 - dryEdge * 0.3), trailWater);
float3 darker = albedo * ${f(WET_DARKEN)};
float grey = dot(darker, float3(0.2126, 0.7152, 0.0722));
float3 wetAlbedo = max(lerp(grey, darker, 1.15), 0.0) * float3(0.97, 0.98, 1.0) * (1.0 - trailWater * ${f(POND.darken)});
float3 color = lerp(albedo, wetAlbedo, wetK);
color = lerp(color, float3(${RESIDUE_COLOR.map(f).join(', ')}), residue);
float r = lerp(rough, lerp(0.42, 0.16, wet), wetK);
r = lerp(r, ${f(POND.roughness)}, trailWater);
Rough = lerp(r, 0.7, residue);
float2 wd = float2(${f(Math.cos(WIND_DIRECTION))}, ${f(Math.sin(WIND_DIRECTION))});
float dM = rn.Noise(xz * 0.9) * 0.5 + 0.5;
float dN = rn.Noise(xz * 3.1 + 17.0) * 0.5 + 0.5;
float macroB = rn.Noise(xz * 0.05 + 3.0) * 0.5 + 0.5;
float ph1 = dot(xz, wd) * (6.2832 / ${f(RIPPLE.wavelength)}) + dM * 24.0 + dN * 7.0 + macroB * 30.0;
float fade1 = 1.0 - smoothstep(0.6, 2.2, fwidth(ph1));
float base = sin(ph1) * 0.5 + 0.5;
float rip1 = pow(base, 1.6);
float windK = fade1 * smoothstep(1.5, 2.2, h) * smoothstep(0.2, 0.5, macroB + dM * 0.3) * sandW * (1.0 - wet) * (1.0 - saturate(trailDepth / 0.004));
color *= (rip1 - 0.5) * 0.12 * windK + 1.0;
float slope = ${f(RIPPLE.relief)} * windK * 1.6 * pow(max(base, 1e-4), 0.6) * 0.5 * cos(ph1) * (6.2832 / ${f(RIPPLE.wavelength)});
Normal = normalize(groundN - float3(wd * slope + trailGrad, 0.0));
return color;`}
  />
);

export const coastGround = defineMaterial(
  <material
    baseColor={shoreSand}
    normal={cloneElement(shoreSand, { output: 'Normal' } as Record<string, unknown>)}
    roughness={cloneElement(shoreSand, { output: 'Rough' } as Record<string, unknown>)}
    ambientOcclusion={ground.ambientOcclusion}
    specular={ground.specular}
  />,
);
