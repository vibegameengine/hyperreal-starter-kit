import { defineMaterial } from '../../../shared/material';

const puff = (
  <custom
    description="SoftPuff"
    outputType="Float1"
    inputs={{ uv: <textureCoordinate /> }}
    code={`
float d = saturate(1 - length(uv * 2 - 1));
return d * d * (3 - 2 * d);
`}
  />
);

const dust = defineMaterial(
  <material usage={['niagaraSprites']} blendMode="Translucent" shadingModel="Unlit" emissiveColor={<particleColor />} opacity={<multiply a={puff} b={<particleColor output="A" />} />} />,
);
export default dust;
