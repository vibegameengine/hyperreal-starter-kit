import { defineInstance, defineMaterial, param } from '../../../shared/material';

const glowColor = param('glowColor', [1, 0.32, 0.04], { group: 'Glow' });

const cracks = (
  <custom
    description="LavaCracks"
    outputType="Float1"
    inputs={{ uv: <textureCoordinate />, t: <time />, scale: param('crackScale', 3, { group: 'Flow' }), speed: param('flowSpeed', 0.25, { group: 'Flow' }) }}
    code={`
float2 p = uv * scale + float2(t * speed, t * speed * 0.6);
float v = 0;
float a = 0.5;
for (int i = 0; i < 4; i++)
{
  v += a * abs(sin(p.x * 3.1 + sin(p.y * 2.3 + t * 0.7)));
  p = p * 2.03 + 1.7;
  a *= 0.5;
}
return saturate(1 - v * 1.6);
`}
  />
);

const lava = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    baseColor={<linearInterpolate a={param('rockColor', [0.04, 0.035, 0.03])} b={glowColor} alpha={cracks} />}
    emissiveColor={<multiply a={<multiply a={glowColor} b={cracks} />} b={param('glowStrength', 20, { group: 'Glow', sliderMin: 0, sliderMax: 100 })} />}
    roughness={param('roughness', 0.65)}
  />,
);
export default lava;

export const cooled = defineInstance(lava, { glowStrength: 1.5, glowColor: [0.5, 0.08, 0.02], flowSpeed: 0.05 });
