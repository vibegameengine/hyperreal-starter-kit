import { defineMaterial, param } from '../../../shared/material';

const density = (
  <custom
    description="SmokeDensity"
    outputType="Float1"
    inputs={{
      p: <transformPosition input={<worldPosition />} transformSourceType="World" transformType="Local" />,
      t: <time />,
      rise: param('riseSpeed', 0.06, { group: 'Shape', sliderMin: 0, sliderMax: 0.5 }),
      detail: param('noiseScale', 3, { group: 'Shape', sliderMin: 0.5, sliderMax: 10 }),
    }}
    code={`
float3 uvw = p / 128.0 + 0.5;
float3 q = uvw * detail + float3(0, 0, -t * rise * detail);
float n = 0;
float a = 0.5;
for (int i = 0; i < 5; i++)
{
  float3 c = floor(q);
  float3 f = frac(q);
  f = f * f * (3 - 2 * f);
  float h000 = frac(sin(dot(c, float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h100 = frac(sin(dot(c + float3(1, 0, 0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h010 = frac(sin(dot(c + float3(0, 1, 0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h110 = frac(sin(dot(c + float3(1, 1, 0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h001 = frac(sin(dot(c + float3(0, 0, 1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h101 = frac(sin(dot(c + float3(1, 0, 1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h011 = frac(sin(dot(c + float3(0, 1, 1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float h111 = frac(sin(dot(c + float3(1, 1, 1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float v = lerp(lerp(lerp(h000, h100, f.x), lerp(h010, h110, f.x), f.y), lerp(lerp(h001, h101, f.x), lerp(h011, h111, f.x), f.y), f.z);
  n += a * v;
  q = q * 2.03 + 1.7;
  a *= 0.5;
}
float2 r = uvw.xy - 0.5;
float column = saturate(1 - length(r) / lerp(0.25, 0.5, uvw.z));
float fade = saturate(uvw.z * 6) * saturate((1 - uvw.z) * 3);
return saturate(n * 1.6 - 0.55) * column * fade;
`}
  />
);

const smoke = defineMaterial(
  <material
    materialDomain="Volume"
    blendMode="Additive"
    usage={['heterogeneousVolumes']}
    baseColor={param('albedo', [0.8, 0.8, 0.82], { group: 'Look' })}
    subsurfaceColor={<multiply a={density} b={param('extinction', 0.15, { group: 'Look', sliderMin: 0, sliderMax: 0.2 })} />}
  />,
);
export default smoke;
