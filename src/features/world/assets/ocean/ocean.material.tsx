import { cloneElement } from 'react';
import { defineMaterial } from '../../../../shared/material';
import { CASCADE_SIZES, FFT_SIZE, FOAM, FOAM_WEIGHTS, WIND_SPEED } from './oceanSpectrum';
import { SHORE, SHORE_EXTENT, SHORE_ORIGIN, shoreInputs, shoreMath, shoreTexture } from './oceanShore';
import { surfFoamCode } from './oceanSurfFoam';
import { WAKE_CELL, WAKE_RES, WAKE_SIZE } from './wakeSpec';
import { DETAIL_RES, EDGE, SURF_DETAIL } from '../../ocean/lod';

const WATER_ROUGHNESS = 0.035;
const SCATTERING_PER_METRE = [0.012, 0.018, 0.024];
const ABSORPTION_PER_METRE = [0.42, 0.075, 0.035];
const SURF_SCATTER = [0.9, 1.0, 0.85];
const SURF_ABSORB = [0.1, 0.2, 0.62];
const AERATION_SCATTER = 1.6;
const SSS_COLOR = [0.12, 0.55, 0.45];
const FOAM_ALBEDO = 0.85;
const FOAM_SCALE = 0.09;
const NEAR = { k1: 7.3, k2: 3.1, a1: 0.63, a2: 2.14 };
const SWASH_ONSET = SHORE.swashOnset;
const SWASH_FOAM_END = 0.9;
const RIPPLE_DEPTH = { dry: 0.0, full: 0.6 };
const fixed = (value: number) => value.toFixed(6);
const vec3 = (values: readonly number[]) => `float3(${values.map(fixed).join(', ')})`;
const SHORE_MATH = shoreMath(CASCADE_SIZES);

const oceanTexture = (name: string) => (
  <textureObjectParameter parameterName={name} texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" samplerSource="SSM_Wrap_WorldGroupSettings" />
);

const node = (index: number) => <perInstanceCustomData dataIndex={index} />;

const cascadeVertex = (c: number) => `{
  float level = max(log2(sp / ${fixed(CASCADE_SIZES[c] / FFT_SIZE)}) + 0.7, 0.0);
  float2 uv = worldXY / ${fixed(CASCADE_SIZES[c])};
  float att = math.CascadeAttenuation(${c}, depth);
  float4 s = D${c}.SampleLevel(D${c}Sampler, uv, level);
  disp += s.xyz * att;
  float fv = level < 1.5 ? D${c}.SampleLevel(D${c}Sampler, uv, 1.5).w : s.w;
  vfoam += fv * ${fixed(FOAM_WEIGHTS[c])} * att;
}`;

const WAKE_READ = `struct OceanWakeRead {
  float4 window;
  float4 Sample(Texture2D T, float2 xz) {
    float2 rel = abs(xz - window.xy);
    float edge = ${fixed(WAKE_SIZE / 2)} - max(rel.x, rel.y);
    if (window.z <= 0.0 || edge <= 0.5) return 0.0;
    float2 fp = xz / ${fixed(WAKE_CELL)} - 0.5;
    int2 i = int2(floor(fp)); float2 t = frac(fp); int m = ${WAKE_RES - 1};
    float4 v = lerp(lerp(T.Load(int3(i & m, 0)), T.Load(int3((i + int2(1, 0)) & m, 0)), t.x), lerp(T.Load(int3((i + int2(0, 1)) & m, 0)), T.Load(int3((i + int2(1, 1)) & m, 0)), t.x), t.y);
    float fade = smoothstep(0.5, 2.0, edge) * window.z;
    float fadeLong = smoothstep(0.5, 5.0, edge) * window.z;
    return float4(v.xyz * fade, v.w * fadeLong);
  }
};`;

const wakeInputs = () => ({
  Wk: oceanTexture('OceanWake'),
  wakeWin: <vectorParameter parameterName="OceanWakeWindow" defaultValue={[0, 0, 0, 0]} />,
});

const shoreTextures = shoreInputs();

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
      finerEdges: node(7),
      D0: oceanTexture('OceanDisplacement0'),
      D1: oceanTexture('OceanDisplacement1'),
      D2: oceanTexture('OceanDisplacement2'),
      D3: oceanTexture('OceanDisplacement3'),
      ...shoreTextures,
      ...wakeInputs(),
      Dt: shoreTexture('OceanDetail'),
    }}
    additionalOutputs={{ Lag: 'Float2', ShoreN: 'Float3', Surf: 'Float3', VFoam: 'Float2' }}
    code={`${SHORE_MATH}
${WAKE_READ}
OceanShoreMath math; math.time = time; math.enabled = shoreOn;
OceanWakeRead wake; wake.window = float4(wakeWin.xyz, 0.0);
float2 origin = float2(nx, ny);
float2 grid = (wp.xy / 100.0 - origin) / size;
float2 p = origin + grid * size;
float2 idx = floor(p / spacing + 1e-3);
float2 snapped = idx * spacing;
float rawDist = length(eye / 100.0 - float3(snapped, wp.z / 100.0));
float detailScale = math.Bilinear(Dt, snapped, ${fixed(DETAIL_RES)}, true).x;
float dist = rawDist * (detailScale + (1.0 - detailScale) * smoothstep(${fixed(SURF_DETAIL.near)}, ${fixed(SURF_DETAIL.far)}, rawDist));
float morphK = saturate((dist - morphStart) * morphInv);
uint edges = uint(finerEdges + 0.5);
float gridEps = 1e-4;
bool pinned = ((edges & ${EDGE.left}u) != 0u && grid.x < gridEps) || ((edges & ${EDGE.right}u) != 0u && grid.x > 1.0 - gridEps) || ((edges & ${EDGE.bottom}u) != 0u && grid.y < gridEps) || ((edges & ${EDGE.top}u) != 0u && grid.y > 1.0 - gridEps);
if (pinned) morphK = 0.0;
float2 odd = frac(idx * 0.5) * 2.0;
float2 worldXY = snapped - odd * spacing * morphK;
float sp = spacing * (morphK + 1.0);
float ground = math.HeightAt(H, worldXY);
float depth = -ground;
float3 disp = 0;
float vfoam = 0.0;
${CASCADE_SIZES.map((_, c) => cascadeVertex(c)).join('\n')}
float3 extra = 0;
float3 shoreN = float3(0.0, 1.0, 0.0);
float shoreFoam = 0.0;
float2 surfMask = 0.0;
float swashLevel = -1e4;
float waveDepth = -math.WaveHeightAt(H, worldXY);
bool nearShore = depth < ${fixed(SHORE.deep)} && shoreOn > 0.5;
if (nearShore) {
  OceanShoreSample sw = math.Evaluate(H, S, worldXY, waveDepth, ground, sp * 2.0);
  extra += sw.disp;
  shoreN = clamp(sw.nShore, -1.0, 1.0);
  shoreFoam = sw.foam;
  surfMask = float2(sw.face, sw.roller);
  swashLevel = sw.swashLevel;
}
extra.y += wake.Sample(Wk, worldXY).x;
float3 total = disp + extra;
float y = total.y;
if (nearShore) {
  float k = 0.04;
  float2 nr = math.RockNormal(H, worldXY);
  float gentle = smoothstep(0.45, 0.25, length(nr));
  float hmx = saturate((swashLevel - y) / k * 0.5 + 0.5) * gentle;
  float smax = lerp(y, swashLevel, hmx) + hmx * (1.0 - hmx) * k;
  y = smax;
  shoreN = normalize(lerp(shoreN, float3(nr.x, 1.0, nr.y), hmx));
  float still = 1.0 - hmx;
  total = float3(total.x * still, total.y, total.z * still);
  surfMask *= still;
}
if (shoreOn > 0.5) {
  float below = depth < -3.0 ? min(ground - 2.0, -1.0) : ground - 0.06;
  if (y < ground) y = min(y, below);
}
Lag = worldXY;
ShoreN = shoreN;
Surf = float3(shoreFoam, surfMask);
VFoam = float2(vfoam, total.y);
return float3(worldXY * 100.0 - wp.xy, 0.0) + float3(total.x, total.z, y) * 100.0;`}
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
      shoreNv: vertexOutput('ShoreN'),
      surf: vertexOutput('Surf'),
      vfoamIn: vertexOutput('VFoam'),
      wpos: <worldPosition />,
      view: <cameraVectorWS />,
      eye: <cameraPositionWS />,
      facing: <twoSidedSign />,
      layersOff: <scalarParameter parameterName="OceanLayersOff" defaultValue={0} />,
      sun: <skyAtmosphereLightDirection lightIndex={0} />,
      sunIllum: <skyAtmosphereLightIlluminance lightIndex={0} />,
      ...shoreTextures,
      Lc: oceanTexture('OceanLace'),
      St: shoreTexture('OceanShoreState'),
      D0: oceanTexture('OceanDisplacement0'),
      D1: oceanTexture('OceanDisplacement1'),
      D2: oceanTexture('OceanDisplacement2'),
      D3: oceanTexture('OceanDisplacement3'),
      R0: oceanTexture('OceanDerivatives0'),
      R1: oceanTexture('OceanDerivatives1'),
      R2: oceanTexture('OceanDerivatives2'),
      R3: oceanTexture('OceanDerivatives3'),
      F: oceanTexture('OceanFoamPattern'),
      ...wakeInputs(),
    }}
    additionalOutputs={{ Foam: 'Float1', Rough: 'Float1', Medium: 'Float2', Albedo: 'Float3', Edge: 'Float1', SkyDir: 'Float3', CrestGlow: 'Float3', Sss: 'Float3' }}
    code={`${SHORE_MATH}
${surfFoamCode}
${WAKE_READ}
OceanShoreMath math; math.time = time; math.enabled = shoreOn;
OceanWakeRead wake; wake.window = float4(wakeWin.xyz, 0.0);
float4 wakeHere = wake.Sample(Wk, lag);
OceanSurfFoam sf; sf.time = time;
float2 xz = wpos.xy / 100.0;
float groundH = math.HeightAt(H, xz);
float depth = -math.HeightAt(H, lag);
float footprint = max(length(fwidth(lag)), 1e-4);
float4 d = 0;
${CASCADE_SIZES.map((size, c) => `d += R${c}.Sample(R${c}Sampler, lag / ${fixed(size)}) * math.CascadeAttenuation(${c}, depth);`).join('\n')}
float2 slopes = float2(d.x / max(d.z + 1.0, 0.2), d.y / max(d.w + 1.0, 0.2));
float near = smoothstep(0.04, 0.01, footprint) * smoothstep(${fixed(RIPPLE_DEPTH.dry)}, ${fixed(RIPPLE_DEPTH.full)}, depth);
if (near > 0.002) {
  float4 c1 = R${finest}.SampleLevel(R${finest}Sampler, ${rotate('lag', NEAR.a1)} * ${fixed(NEAR.k1 / finestSize)}, max(log2(footprint / ${fixed(finestSize / NEAR.k1 / FFT_SIZE)}), 0.0));
  float4 c2 = R${finest}.SampleLevel(R${finest}Sampler, ${rotate('lag', NEAR.a2)} * ${fixed(NEAR.k2 / finestSize)}, max(log2(footprint / ${fixed(finestSize / NEAR.k2 / FFT_SIZE)}), 0.0));
  float2 g1 = c1.xy;
  float2 g2 = c2.xy;
  slopes += (${rotate('g1', -NEAR.a1)} * 0.55 + ${rotate('g2', -NEAR.a2)} * 0.35) * near;
}
slopes += wakeHere.yz;
float jac = (d.z + 1.0) * (d.w + 1.0);
float shoreFoam = surf.x;
float face = saturate(surf.y);
float3 sn = clamp(shoreNv, -1.0, 1.0) + float3(0.0, 1e-3, 0.0);
float3 Ns0 = sn / max(length(sn), 1e-4);
float3 Ns = normalize(float3(Ns0.x, max(Ns0.y, 0.12), Ns0.z));
float3 nd = normalize(float3(-slopes.x, 1.0, -slopes.y));
float3 tq = Ns + float3(0.0, 1.0, 0.0);
float3 uq = float3(slopes.x, 1.0, slopes.y) * nd.y;
float3 nY = normalize(tq * (dot(tq, uq) / tq.y) - uq);
float thickness = wpos.z / 100.0 - groundH;
float frontD = 1e3; float swTau = 0.0; float swRt = 0.0;
if (depth < 1.0 && shoreOn > 0.5) {
  float tRaw = thickness;
  float4 se = math.SwashEdge(H, S, xz, thickness);
  thickness = se.x; frontD = se.y; swTau = se.z; swRt = se.w;
  float backwash = smoothstep(0.32, 0.46, swTau);
  if (backwash > 0.0 && swRt > 0.0 && frontD < 3.0) {
    frontD += (math.Perlin2(xz * 1.1) * 0.35 + math.Perlin2(xz * 3.7 + float2(5.3, 1.9)) * 0.15) * backwash;
    thickness = min(tRaw, frontD * lerp(0.08, 0.025, backwash));
  }
}
float uprush = smoothstep(0.0, ${fixed(SWASH_ONSET)}, swTau) * smoothstep(0.46, 0.32, swTau);
float bead = smoothstep(-0.01, 0.05, frontD) * smoothstep(0.6, 0.12, frontD);
float trail = smoothstep(-0.01, 0.25, frontD) * smoothstep(2.2, 0.3, frontD);
float edgePatch = 1.0;
if (swRt > 0.0 && depth < 0.4) edgePatch = smoothstep(-0.45, 0.55, math.Perlin2(xz * 0.42)) * 0.7 + smoothstep(-0.3, 0.6, math.Perlin2(xz * 1.7 + float2(3.1, 7.7))) * 0.3;
float foamLife = smoothstep(0.0, ${fixed(SWASH_ONSET)}, swTau) * smoothstep(${fixed(SWASH_FOAM_END)}, 0.32, swTau);
float edgeFoam = (bead * lerp(0.45, 1.1, foamLife) * lerp(0.35, 1.0, edgePatch) + trail * lerp(0.12, 0.4, foamLife) * edgePatch) * smoothstep(0.0, 1.0, swRt) * smoothstep(0.4, -0.2, depth);
float2 stateUv = (xz - ${fixed(SHORE_ORIGIN)}) / ${fixed(SHORE_EXTENT)};
float4 simState = shoreOn > 0.5 ? St.SampleLevel(StSampler, stateUv, 0.0) * sf.Inside(xz) : 0.0;
uint off = uint(layersOff + 0.5);
float simFoam = simState.x * (1.0 - face * 0.72) * ((off & 2u) != 0u ? 0.0 : 1.0);
float fresh = shoreFoam * ((off & 4u) != 0u ? 0.0 : 1.0) + edgeFoam * ((off & 32u) != 0u ? 0.0 : 1.0);
float foamSum = simFoam + fresh * 0.55 + wakeHere.w;
float aeration = saturate(fresh * 1.2 + simFoam * 0.7) * (1.0 - face) * smoothstep(-0.1, 0.3, depth);
float whitecaps = vfoamIn.x + saturate((${fixed(FOAM.bias)} - 0.15 - jac) * 2.0);
float coverage = saturate(foamSum + whitecaps);
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
float4 fieldHere = math.ShoreSample(S, xz);
float2 waveDir = fieldHere.yz / max(length(fieldHere.yz), 1e-4);
SurfFoamArgs fa;
fa.coverage = coverage; fa.foam = foam; fa.footprint = max(length(fwidth(xz)), 1e-4); fa.depth = depth; fa.bubbles = p1.y;
fa.lagXZ = lag; fa.normal = nY; fa.baseNormal = Ns; fa.fresh = fresh; fa.sim = simFoam; fa.simState = simState; fa.roller = surf.z;
fa.P = float3(xz.x, wpos.z / 100.0, xz.y); fa.sun = normalize(float3(sun.x, sun.z, sun.y));
SurfFoamInfo info = sf.Shade(Lc, LcSampler, fa, waveDir);
foam = saturate(info.foam);
float3 foamNormal = sf.ReliefNormal(info, nY, fa.P);
nY = normalize(lerp(nY, foamNormal, foam));
float3 V = normalize(float3(view.x, view.z, view.y));
float camH = eye.z / 100.0;
bool folded = jac < 0.1 || Ns0.y < 0.35;
bool nearSurface = abs(camH) < 1.5;
bool viewFromBelow = (nearSurface && !folded) ? facing < 0.0 : camH < 0.0;
float3 Nside = viewFromBelow ? -nY : nY;
nY = normalize(Nside + V * max(-dot(Nside, V) + 0.03, 0.0));
float ao = lerp(lerp(1.0, info.height * 0.3 + 0.76, info.surf), info.cavity, info.ww);
Albedo = ${fixed(FOAM_ALBEDO)} * ao * lerp(1.0, info.selfShadow, info.ww);
float mss = 0.003 + ${fixed(WIND_SPEED)} * 0.00512;
float kpx = 3.14159265 / footprint;
float unresolved = saturate(log2(110.0 / kpx) / 9.0);
float alpha2 = ${fixed(WATER_ROUGHNESS * WATER_ROUGHNESS)} + mss * 2.0 * unresolved + foam * 0.2 + aeration * 0.03;
Foam = foam;
Rough = pow(alpha2, 0.25);
Medium = float2(math.SurfMedium(fieldHere, depth) * (saturate(simState.x * 2.5) * 1.8 + 0.45), aeration);
Edge = smoothstep(0.0, clamp(fwidth(thickness) * 1.5, 0.004, 0.03), thickness) * ((off & 1u) != 0u && depth < 1.0 ? 0.0 : 1.0);
float3 L = normalize(float3(sun.x, sun.z, sun.y));
float3 Tr = refract(-V, nY, 1.0 / 1.33);
float3 Tv = normalize(float3(Tr.x, min(Tr.y, -0.08), Tr.z));
float Lter = clamp(max(wpos.z / 100.0 - groundH, 0.0) / max(-Tv.y, 0.04), 0.0, 400.0);
float crestT = shoreOn > 0.5 ? math.CrestPath(H, S, lag, -math.WaveHeightAt(H, lag), Tv) : 1e4;
float fresnel = 0.02 + 0.98 * pow(1.0 - saturate(dot(nY, V)), 5.0);
float3 sigT = ${vec3(ABSORPTION_PER_METRE.map((a, i) => a + SCATTERING_PER_METRE[i]))} + ${vec3(SURF_ABSORB.map((a, i) => a + SURF_SCATTER[i]))} * Medium.x + Medium.y * ${fixed(AERATION_SCATTER)};
SkyDir = normalize(float3(Tv.x, Tv.z, max(abs(Tv.y), 0.03)));
float2 vH = normalize(V.xz + 1e-5);
float2 lH = normalize(L.xz + 1e-5);
float back = pow(saturate(dot(vH, -lH) * 0.6 + 0.4), 2.5);
float crest = saturate(vfoamIn.y * 0.9 + 0.1) * (saturate((1.0 - nY.y) * 4.0) + 0.25);
float3 sss = sunIllum * ${vec3(SSS_COLOR)} * 0.06 * back * crest * smoothstep(0.0, 0.25, L.y);
CrestGlow = crestT < Lter ? exp(-sigT * crestT) * (1.0 - fresnel) * (1.0 - foam) : 0.0;
Sss = sss * (1.0 - foam);
return float3(nY.x, nY.z, nY.y) * facing;`}
  />
);

const surfaceOutput = (output: string) => cloneElement(surface, { output } as Record<string, unknown>);

const glow = (
  <custom
    description="OceanGlow"
    outputType="Float3"
    inputs={{
      sky: <skyAtmosphereViewLuminance worldDirection={surfaceOutput('SkyDir')} />,
      crest: surfaceOutput('CrestGlow'),
      sss: surfaceOutput('Sss'),
    }}
    code="return sky * crest + sss;"
  />
);

const medium = (base: readonly number[], surfK: readonly number[], aeration: number, description: string) => (
  <custom
    description={description}
    outputType="Float3"
    inputs={{ m: surfaceOutput('Medium') }}
    code={`return (${vec3(base)} + ${vec3(surfK)} * m.x + m.y * ${fixed(aeration)}) / 100.0;`}
  />
);

export const oceanWater = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    shadingModel="SingleLayerWater"
    blendMode="Masked"
    opacityMask={surfaceOutput('Edge')}
    twoSided
    tangentSpaceNormal={false}
    baseColor={surfaceOutput('Albedo')}
    specular={0.255}
    roughness={surfaceOutput('Rough')}
    opacity={surfaceOutput('Foam')}
    normal={surface}
    emissiveColor={glow}
    worldPositionOffset={vertex}
  >
    <singleLayerWaterMaterialOutput
      scatteringCoefficients={medium(SCATTERING_PER_METRE, SURF_SCATTER, AERATION_SCATTER, 'WaterScattering')}
      absorptionCoefficients={medium(ABSORPTION_PER_METRE, SURF_ABSORB, 0, 'WaterAbsorption')}
      phaseG={0.6}
      colorScaleBehindWater={1}
    />
  </material>,
);
