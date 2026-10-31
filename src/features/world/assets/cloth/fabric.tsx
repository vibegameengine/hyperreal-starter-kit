import { defineInstance, defineMaterial, param } from '../../../../shared/material';

const woven = (
  <custom
    description="WovenFabric"
    outputType="Float3"
    inputs={{
      uv: <textureCoordinate />,
      base: param('baseColor', [0.62, 0.05, 0.04], { group: 'Fabric' }),
      stripe: param('stripeColor', [0.92, 0.86, 0.7], { group: 'Fabric' }),
      stripes: param('stripes', 0, { group: 'Fabric', sliderMin: 0, sliderMax: 8 }),
      threads: param('threads', 420, { group: 'Fabric', sliderMin: 50, sliderMax: 1200 }),
    }}
    code={`
float band = stripes > 0 ? step(0.5, frac(uv.y * stripes)) : 0;
float3 color = lerp(base, stripe, band);
float warp = sin(uv.x * threads * 6.2832);
float weft = sin(uv.y * threads * 6.2832);
float weave = 0.86 + 0.14 * (warp * weft * 0.5 + 0.5);
return color * weave;
`}
  />
);

const fabric = defineMaterial(
  <material
    usage={['skeletalMesh', 'clothing']}
    twoSided
    baseColor={woven}
    roughness={param('roughness', 0.82, { group: 'Fabric' })}
    specular={param('specular', 0.35, { group: 'Fabric' })}
  />,
);
export default fabric;

export const flagFabric = defineInstance(fabric, { baseColor: [0.62, 0.05, 0.04], stripeColor: [0.95, 0.88, 0.72], stripes: 5 });
export const capeFabric = defineInstance(fabric, { baseColor: [0.3, 0.02, 0.05], stripeColor: [0.85, 0.65, 0.2], stripes: 0, threads: 700, roughness: 0.7 });
export const curtainFabric =defineInstance(fabric, { baseColor: [0.07, 0.12, 0.34], stripes: 0, threads: 600, roughness: 0.9 });
