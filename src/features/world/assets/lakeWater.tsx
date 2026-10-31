import { defineMaterial } from '../../../shared/material';

const ripples = (
  <custom
    description="LakeRipples"
    outputType="Float3"
    inputs={{ p: <worldPosition />, t: <time /> }}
    code={`
float2 q = p.xy / 100;
float2 slope = float2(0, 0);
slope += float2(cos(q.x * 0.9 + t * 1.1), sin(q.y * 0.7 + t * 0.8)) * 0.05;
slope += float2(cos((q.x + q.y) * 2.3 - t * 1.7), cos((q.x - q.y) * 2.9 + t * 1.3)) * 0.03;
slope += float2(sin(q.x * 6.1 + t * 2.6), cos(q.y * 5.3 - t * 2.2)) * 0.015;
return normalize(float3(-slope, 1));
`}
  />
);

export const lakeWater = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    shadingModel="SingleLayerWater"
    baseColor={[0.02, 0.06, 0.07]}
    roughness={0.04}
    specular={0.5}
    normal={ripples}
  >
    <singleLayerWaterMaterialOutput scatteringCoefficients={[0.02, 0.06, 0.05]} absorptionCoefficients={[0.45, 0.12, 0.09]} phaseG={0.1} colorScaleBehindWater={1} />
  </material>,
);
