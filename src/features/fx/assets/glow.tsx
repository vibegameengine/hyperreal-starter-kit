import { defineMaterial, param } from '../../../shared/material';

const falloff = (
  <custom
    description="SoftDot"
    outputType="Float1"
    inputs={{ uv: <textureCoordinate /> }}
    code={`
float d = saturate(1 - length(uv * 2 - 1));
return d * d;
`}
  />
);

const glow = defineMaterial(
  <material
    usage={['niagaraSprites']}
    blendMode="Additive"
    shadingModel="Unlit"
    emissiveColor={<multiply a={<multiply a={<particleColor />} b={falloff} />} b={param('glowStrength', 4, { sliderMin: 0, sliderMax: 50 })} />}
  />,
);
export default glow;
