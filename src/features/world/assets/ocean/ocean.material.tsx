import { cloneElement } from 'react';
import { defineMaterial } from '../../../../shared/material';
import { CASCADE_SIZES, FFT_SIZE, FOAM, FOAM_WEIGHTS, WIND_SPEED } from './oceanSpectrum';

const FOAM_BIAS = FOAM.bias;
const WATER_ROUGHNESS = 0.035;
const FOAM_SCALE = 0.09;
const FOAM_ALBEDO = 0.85;
const NEAR = { k1: 7.3, k2: 3.1, a1: 0.63, a2: 2.14 };

const fixed = (value: number) => value.toFixed(6);

const oceanTexture = (name: string) => (
  <textureObjectParameter parameterName={name} texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" />
);

const node = (index: number) => <perInstanceCustomData dataIndex={index} />;

const cascadeVertex = (c: number) => `{
  float level = max(log2(sp / ${fixed(CASCADE_SIZES[c] / FFT_SIZE)}) + 0.7, 0.0);
  float2 uv = worldXY / ${fixed(CASCADE_SIZES[c])};
  float4 s = D${c}.SampleLevel(D${c}Sampler, uv, level);
  disp += s.xyz;
  float fv = s.w;
  if (level < 1.5) fv = D${c}.SampleLevel(D${c}Sampler, uv, 1.5).w;
  foam += fv * ${fixed(FOAM_WEIGHTS[c])};
}`;

const vertex = (
  <custom
    description="OceanVertex"
    outputType="Float3"
    inputs={{
      wp: <worldPosition worldPositionShaderOffset="ExcludeAllShaderOffsets" />,
      eye: <cameraPositionWS />,
      nx: node(0),
      ny: node(1),
      size: node(2),
      morphStart: node(4),
      morphInv: node(5),
      spacing: node(6),
      D0: oceanTexture('OceanDisplacement0'),
      D1: oceanTexture('OceanDisplacement1'),
      D2: oceanTexture('OceanDisplacement2'),
      D3: oceanTexture('OceanDisplacement3'),
    }}
    additionalOutputs={{ Lag: 'Float2', Foam: 'Float1' }}
    code={`float2 origin = float2(nx, ny);
float2 grid = (wp.xy / 100.0 - origin) / size;
float2 p = origin + grid * size;
float2 idx = floor(p / spacing + 1e-3);
float2 snapped = idx * spacing;
float dist = length(eye / 100.0 - float3(snapped, wp.z / 100.0));
float morphK = saturate((dist - morphStart) * morphInv);
float2 odd = frac(idx * 0.5) * 2.0;
float2 worldXY = snapped - odd * spacing * morphK;
float sp = spacing * (morphK + 1.0);
float3 disp = 0;
float foam = 0;
${CASCADE_SIZES.map((_, c) => cascadeVertex(c)).join('\n')}
Lag = worldXY;
Foam = foam;
return float3(worldXY * 100.0 - wp.xy, 0.0) + float3(disp.x, disp.z, disp.y) * 100.0;`}
  />
);

const vertexOutput = (output: string) => <vertexInterpolator input={cloneElement(vertex, { output } as Record<string, unknown>)} />;

const rotate = (v: string, a: number) =>
  `float2(${v}.x * ${fixed(Math.cos(a))} - ${v}.y * ${fixed(Math.sin(a))}, ${v}.x * ${fixed(Math.sin(a))} + ${v}.y * ${fixed(Math.cos(a))})`;

const finest = CASCADE_SIZES.length - 1;
const finestSize = CASCADE_SIZES[finest];

const surface = (
  <custom
    description="OceanSurface"
    outputType="Float3"
    inputs={{
      lag: vertexOutput('Lag'),
      vfoam: vertexOutput('Foam'),
      R0: oceanTexture('OceanDerivatives0'),
      R1: oceanTexture('OceanDerivatives1'),
      R2: oceanTexture('OceanDerivatives2'),
      R3: oceanTexture('OceanDerivatives3'),
      F: oceanTexture('OceanFoamPattern'),
    }}
    additionalOutputs={{ Foam: 'Float1', Rough: 'Float1' }}
    code={`float footprint = max(length(fwidth(lag)), 1e-4);
float4 d = 0;
${CASCADE_SIZES.map((size, c) => `d += R${c}.Sample(R${c}Sampler, lag / ${fixed(size)});`).join('\n')}
float2 slopes = float2(d.x / max(d.z + 1.0, 0.2), d.y / max(d.w + 1.0, 0.2));
float near = smoothstep(0.04, 0.01, footprint);
if (near > 0.002) {
  float4 c1 = R${finest}.SampleLevel(R${finest}Sampler, ${rotate('lag', NEAR.a1)} * ${fixed(NEAR.k1 / finestSize)}, max(log2(footprint / ${fixed(finestSize / NEAR.k1 / FFT_SIZE)}), 0.0));
  float4 c2 = R${finest}.SampleLevel(R${finest}Sampler, ${rotate('lag', NEAR.a2)} * ${fixed(NEAR.k2 / finestSize)}, max(log2(footprint / ${fixed(finestSize / NEAR.k2 / FFT_SIZE)}), 0.0));
  float2 g1 = c1.xy;
  float2 g2 = c2.xy;
  slopes += (${rotate('g1', -NEAR.a1)} * 0.55 + ${rotate('g2', -NEAR.a2)} * 0.35) * near;
}
float jac = (d.z + 1.0) * (d.w + 1.0);
float3 normal = normalize(float3(-slopes.x, -slopes.y, 1.0));
float fresh = saturate((${fixed(FOAM_BIAS)} - 0.15 - jac) * 2.0);
float coverage = saturate(vfoam + fresh);
float2 fuv = lag * ${fixed(FOAM_SCALE)};
float4 p1 = F.Sample(FSampler, fuv);
float2 r2 = float2(fuv.x * 0.8 - fuv.y * 0.6, fuv.x * 0.6 + fuv.y * 0.8);
float4 p2 = F.Sample(FSampler, r2 * 2.37 + float2(0.31, 0.77));
float pattern = p1.x * 0.62 + p2.x * 0.38;
float thresh = 1.05 - coverage * 1.1;
float soft = 0.06 + footprint * 0.1;
float detail = smoothstep(thresh - soft, thresh + soft, pattern) * (p1.y * 0.25 + 0.8);
float far = smoothstep(0.15, 1.2, footprint);
float foam = saturate(lerp(detail, coverage * 0.85, far));
float mss = 0.003 + ${fixed(WIND_SPEED)} * 0.00512;
float kpx = 3.14159265 / footprint;
float unresolved = saturate(log2(110.0 / kpx) / 9.0);
float alpha2 = ${fixed(WATER_ROUGHNESS * WATER_ROUGHNESS)} + mss * 2.0 * unresolved + foam * 0.2;
Foam = foam;
Rough = pow(alpha2, 0.25);
return normal;`}
  />
);

const surfaceOutput = (output: string) => cloneElement(surface, { output } as Record<string, unknown>);

export const oceanWater = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    shadingModel="SingleLayerWater"
    twoSided
    tangentSpaceNormal={false}
    baseColor={[FOAM_ALBEDO, FOAM_ALBEDO, FOAM_ALBEDO]}
    specular={0.255}
    roughness={surfaceOutput('Rough')}
    opacity={surfaceOutput('Foam')}
    normal={surface}
    worldPositionOffset={vertex}
  >
    <singleLayerWaterMaterialOutput scatteringCoefficients={[0.012, 0.018, 0.024]} absorptionCoefficients={[0.42, 0.075, 0.035]} phaseG={0.6} colorScaleBehindWater={1} />
  </material>,
);
