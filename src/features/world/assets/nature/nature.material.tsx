import { defineMaterial, param, type MaterialParam } from '../../../../shared/material';
import { GROWTH_STAGES } from '../../growth/field';
import { metresBehindFront } from '../growthFront';
import { LEAF_PRESETS, leafOptics, measuredBodyReflectance, USGS_LAWN_GRASS_GDS91, type LeafBiochemistry } from './leafOptics';

const USAGE = ['nanite', 'instancedStaticMeshes'] as const;

const NOISE = `
float hash(float2 q) { return frac(sin(dot(q, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 q) {
  float2 i = floor(q);
  float2 f = frac(q);
  float2 u = f * f * (3 - 2 * f);
  return lerp(lerp(hash(i), hash(i + float2(1, 0)), u.x), lerp(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
`;

const sway = (strength: number, reach: number) => (
  <custom
    description="NatureWind"
    outputType="Float3"
    inputs={{ p: <worldPosition />, o: <objectPositionWS />, t: <time /> }}
    code={`
float rise = saturate((p.z - o.z) / ${reach});
float phase = o.x * 0.0031 + o.y * 0.0047;
float gust = 0.6 + 0.4 * sin(t * 0.37 + phase * 3);
float flutter = sin(t * 1.9 + phase + p.x * 0.012) * 0.7 + sin(t * 3.7 + p.y * 0.02) * 0.3;
return float3(1, 0.4, 0) * flutter * gust * rise * rise * ${strength};
`}
  />
);

const WHITE = '/Engine/EngineResources/WhiteSquareTexture';
const FLAT_NORMAL = '/Engine/EngineMaterials/DefaultNormal';
const MASKS = '/Engine/EngineMaterials/DefaultDiffuse_TC_Masks';

const barkTexture = {
  color: param('BarkColor', WHITE, { samplerType: 'Color' }),
  normal: param('BarkNormal', FLAT_NORMAL, { samplerType: 'Normal' }),
  surface: param('BarkSurface', MASKS, { samplerType: 'Masks' }),
};

const leafTexture = {
  color: param('LeafColor', WHITE, { samplerType: 'Color' }),
  normal: param('LeafNormal', FLAT_NORMAL, { samplerType: 'Normal' }),
  surface: param('LeafSurface', MASKS, { samplerType: 'Masks' }),
};

const channel = (description: string, source: MaterialParam, code: string) => (
  <custom description={description} outputType="Float1" inputs={{ s: source, side: <twoSidedSign /> }} code={code} />
);

const leafOpticsOfBroadleaf = leafOptics(LEAF_PRESETS.broadleaf);
const transmitGain = leafOpticsOfBroadleaf.transmittance.map((t, c) => (t / Math.max(leafOpticsOfBroadleaf.reflectance[c], 0.001)).toFixed(4)).join(', ');

const leafColor = (
  <custom
    description="LeafColor"
    outputType="Float3"
    inputs={{ c: leafTexture.color, o: <objectPositionWS />, side: <twoSidedSign /> }}
    code={`return c * (0.9 + 0.2 * frac(o.x * 0.0013 + o.y * 0.0029)) * (side < 0 ? 1.25 : 1);`}
  />
);

const leafTransmission = (
  <custom description="LeafTransmission" outputType="Float3" inputs={{ c: leafTexture.color }} code={`return saturate(c * float3(${transmitGain}));`} />
);

const stoneTexture = {
  color: param('StoneColor', WHITE, { samplerType: 'Color' }),
  normal: param('StoneNormal', FLAT_NORMAL, { samplerType: 'Normal' }),
  surface: param('StoneSurface', MASKS, { samplerType: 'Masks' }),
};

const stoneColor = (
  <custom description="Stone" outputType="Float3" inputs={{ c: stoneTexture.color, crevice: <vertexColor /> }} code={`return c * lerp(1, 0.5, crevice.r);`} />
);

const stoneOcclusion = (
  <custom description="StoneCrevice" outputType="Float1" inputs={{ s: stoneTexture.surface, crevice: <vertexColor /> }} code={`return s.r * lerp(1, 0.4, crevice.r);`} />
);

const GRASS_CANOPY_LAI = 1.5;
const BEAM_EXTINCTION = 0.5;
const DIFFUSE_EXTINCTION = 0.8;

const hlslRgb = ([r, g, b]: readonly number[]) => `float3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const modelGrass = leafOptics(LEAF_PRESETS.grass);
const measuredGrass = measuredBodyReflectance(USGS_LAWN_GRASS_GDS91, LEAF_PRESETS.grass);
const measuredToModel = luminance(measuredGrass) / luminance(modelGrass.reflectance);
const calibratedGrass = (preset: LeafBiochemistry) =>
  leafOptics(preset).reflectance.map((value, c) => Math.max(0, measuredGrass[c] + (value - modelGrass.reflectance[c]) * measuredToModel));
const grassOptics = {
  mature: measuredGrass,
  young: calibratedGrass(LEAF_PRESETS.grassYoung),
  dry: calibratedGrass(LEAF_PRESETS.grassDry),
};
const grassTransmitGain = modelGrass.transmittance.map((t, c) => t / Math.max(modelGrass.reflectance[c], 0.001));

const grassColor = (
  <custom
    description="GrassBlade"
    outputType="Float3"
    inputs={{ uv: <textureCoordinate />, shade: <vertexColor />, p: <worldPosition /> }}
    code={`struct N { ${NOISE} }; N n;
float height = 1 - uv.y;
float field = n.noise(p.xy / 900) * 0.6 + n.noise(p.xy / 260) * 0.4;
float dry = smoothstep(0.66, 0.8, field) * lerp(0.6, 1, shade.g);
float3 blade = lerp(${hlslRgb(grassOptics.mature)}, ${hlslRgb(grassOptics.young)}, saturate(shade.r * 0.7 + height * 0.3));
float stalk = shade.b * smoothstep(0.3, 0.8, height);
return lerp(blade, ${hlslRgb(grassOptics.dry)}, max(dry * height, stalk));`}
  />
);

const grassTransmission = (
  <custom
    description="GrassTransmission"
    outputType="Float3"
    inputs={{ c: grassColor, uv: <textureCoordinate />, sun: <skyAtmosphereLightDirection /> }}
    code={`float leafAreaAbove = ${GRASS_CANOPY_LAI} * uv.y;
float beam = exp(-${BEAM_EXTINCTION} * leafAreaAbove / max(sun.z, 0.05));
return saturate(c * ${hlslRgb(grassTransmitGain)}) * beam;`}
  />
);

const grassOcclusion = (
  <custom description="GrassCanopyOcclusion" outputType="Float1" inputs={{ uv: <textureCoordinate /> }} code={`return exp(-${DIFFUSE_EXTINCTION} * ${GRASS_CANOPY_LAI} * uv.y);`} />
);

const grassWind = (
  <custom
    description="GrassWind"
    outputType="Float3"
    inputs={{ p: <worldPosition />, o: <objectPositionWS />, t: <time />, uv: <textureCoordinate /> }}
    code={`struct N { ${NOISE} }; N n;
float height = 1 - uv.y;
float growth = 0.55 + 0.9 * (n.noise(o.xy / 1800) * 0.6 + n.noise(o.xy / 520 + 7.3) * 0.4);
float3 stretch = float3(0, 0, (p.z - o.z) * (growth - 1));
float gust = n.noise(p.xy / 2500 + float2(t * 0.32, t * 0.11));
float bend = (0.4 + 0.6 * gust * gust) * height * height * growth;
float flutter = sin(t * 2.3 + p.x * 0.05 + p.y * 0.03) * 0.25 * height;
return stretch + float3(0.83, 0.55, 0) * (bend * 9 + flutter * 3);`}
  />
);

const grassGrowth = (
  <custom
    description="GrassGrowth"
    outputType="Float1"
    inputs={{ o: <objectPositionWS />, m: metresBehindFront(<objectPositionWS />) }}
    code={`float start = ${GROWTH_STAGES.grass} + 8 * frac(sin(dot(o.xy, float2(12.9898, 78.233))) * 43758.5453);
return smoothstep(start, start + 5, m);`}
  />
);

const grownGrassWind = (
  <custom
    description="GrassGrowthOffset"
    outputType="Float3"
    inputs={{ wind: grassWind, g: grassGrowth, p: <worldPosition />, o: <objectPositionWS /> }}
    code="return lerp(o - p, wind, g);"
  />
);

const grownGrassOpacity = (
  <custom description="GrassGrowthOpacity" outputType="Float1" inputs={{ fade: <perInstanceFadeAmount />, g: grassGrowth }} code="return fade * saturate(g * 20);" />
);

export const bark = defineMaterial(
  <material
    usage={USAGE}
    baseColor={barkTexture.color}
    normal={barkTexture.normal}
    roughness={channel('BarkRoughness', barkTexture.surface, 'return s.g;')}
    ambientOcclusion={channel('BarkCavity', barkTexture.surface, 'return s.r;')}
    worldPositionOffset={sway(4, 900)}
  />,
);

export const leaves = defineMaterial(
  <material
    usage={USAGE}
    blendMode="Masked"
    shadingModel="TwoSidedFoliage"
    twoSided
    baseColor={leafColor}
    normal={leafTexture.normal}
    opacityMask={channel('LeafMask', leafTexture.surface, 'return s.r;')}
    subsurfaceColor={leafTransmission}
    roughness={channel('LeafRoughness', leafTexture.surface, 'return side > 0 ? s.g : s.b;')}
    worldPositionOffset={sway(14, 900)}
  />,
);

export const stone = defineMaterial(
  <material
    usage={USAGE}
    baseColor={stoneColor}
    normal={stoneTexture.normal}
    ambientOcclusion={stoneOcclusion}
    roughness={channel('StoneRoughness', stoneTexture.surface, 'return s.g;')}
  />,
);

export const grass = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    blendMode="Masked"
    ditherOpacityMask
    ditheredLODTransition
    shadingModel="TwoSidedFoliage"
    twoSided
    baseColor={grassColor}
    opacityMask={grownGrassOpacity}
    subsurfaceColor={grassTransmission}
    roughness={0.65}
    ambientOcclusion={grassOcclusion}
    worldPositionOffset={grownGrassWind}
  />,
);
