import { defineMaterial, param } from '../../../../shared/material';

const TILE_CENTIMETRES = 450;
const ROCKS = ['CliffA', 'CliffB'] as const;
const PROJECTIONS = { X: 'p.yz', Y: 'p.xz', Z: 'p.xy' } as const;
type Projection = keyof typeof PROJECTIONS;
type Map = 'Color' | 'Normal' | 'Surface';

const DEFAULTS: Record<Map, { texture: string; samplerType: 'Color' | 'Normal' | 'Masks' }> = {
  Color: { texture: '/Engine/EngineResources/WhiteSquareTexture', samplerType: 'Color' },
  Normal: { texture: '/Engine/EngineMaterials/DefaultNormal', samplerType: 'Normal' },
  Surface: { texture: '/Engine/EngineMaterials/DefaultDiffuse_TC_Masks', samplerType: 'Masks' },
};

const projected = (axis: Projection) => (
  <custom description={`Cliff${axis}Uv`} outputType="Float2" inputs={{ p: <worldPosition /> }} code={`return ${PROJECTIONS[axis]} / ${TILE_CENTIMETRES};`} />
);

const sample = (rock: (typeof ROCKS)[number], map: Map, axis: Projection) =>
  param(`${rock}${map}`, DEFAULTS[map].texture, { samplerType: DEFAULTS[map].samplerType, samplerSource: 'SSM_Wrap_WorldGroupSettings', coordinates: projected(axis) });

const triplanarInputs = (map: Map) => ({
  ax: sample('CliffA', map, 'X'),
  ay: sample('CliffA', map, 'Y'),
  az: sample('CliffA', map, 'Z'),
  bx: sample('CliffB', map, 'X'),
  by: sample('CliffB', map, 'Y'),
  bz: sample('CliffB', map, 'Z'),
  n: <vertexNormalWS />,
  v: <vertexColor />,
});

const WEIGHTS = `float3 w = pow(abs(n), 4); w /= (w.x + w.y + w.z);
float bed = frac(v.g * 7 * 0.618 + 0.13);
float useB = 0;`;

const cliffColor = (
  <custom
    description="CliffColor"
    outputType="Float3"
    inputs={triplanarInputs('Color')}
    code={`${WEIGHTS}
float3 a = ax * w.x + ay * w.y + az * w.z;
float3 b = bx * w.x + by * w.y + bz * w.z;
float3 c = lerp(a, b, useB);
float crack = v.r;
float wet = 1 - smoothstep(0.02, 0.07, v.b);
return c * (0.92 + 0.16 * bed) * lerp(1, 0.45, crack) * lerp(1, 0.55, wet);`}
  />
);

const cliffSurface = (channel: 'r' | 'g', description: string, finish: string) => (
  <custom
    description={description}
    outputType="Float1"
    inputs={triplanarInputs('Surface')}
    code={`${WEIGHTS}
float a = ax.${channel} * w.x + ay.${channel} * w.y + az.${channel} * w.z;
float b = bx.${channel} * w.x + by.${channel} * w.y + bz.${channel} * w.z;
float s = lerp(a, b, useB);
float wet = 1 - smoothstep(0.02, 0.07, v.b);
${finish}`}
  />
);

const cliffNormal = (
  <custom
    description="CliffNormal"
    outputType="Float3"
    inputs={triplanarInputs('Normal')}
    code={`${WEIGHTS}
float3 tx = lerp(ax, bx, useB);
float3 ty = lerp(ay, by, useB);
float3 tz = lerp(az, bz, useB);
float3 s = sign(n);
tx = float3(tx.xy + n.zy, abs(n.x) * tx.z);
ty = float3(ty.xy + n.xz, abs(n.y) * ty.z);
tz = float3(tz.xy + n.xy, abs(n.z) * tz.z);
tx.z *= s.x; ty.z *= s.y; tz.z *= s.z;
return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);`}
  />
);

export const cliff = defineMaterial(
  <material
    usage={['nanite', 'instancedStaticMeshes']}
    tangentSpaceNormal={false}
    baseColor={cliffColor}
    normal={cliffNormal}
    roughness={cliffSurface('g', 'CliffRoughness', 'return lerp(s, 0.25, wet);')}
    ambientOcclusion={cliffSurface('r', 'CliffCavity', 'return s * lerp(1, 0.5, v.r);')}
  />,
);
