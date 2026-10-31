import { CASCADE_SIZES, FFT_SIZE } from './oceanSpectrum';

const num = (value: number) => value.toFixed(6);

const cascadeLoad = (c: number) => `
float3 BreakerCascade${c}(float2 p) {
  float2 fp = p / ${num(CASCADE_SIZES[c])} * ${FFT_SIZE}.0 - 0.5;
  int2 i = int2(floor(fp)); float2 t = frac(fp); int m = ${FFT_SIZE - 1};
  float4 a = Displacement${c}Load(i & m); float4 b = Displacement${c}Load((i + int2(1, 0)) & m);
  float4 c = Displacement${c}Load((i + int2(0, 1)) & m); float4 d = Displacement${c}Load((i + int2(1, 1)) & m);
  return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y).xyz;
}`;

export const CASCADE_DISPLACEMENT = `
${CASCADE_SIZES.map((_, c) => cascadeLoad(c)).join('\n')}
float3 BreakerFftDisp(OceanShoreMath math, float2 p, float depth) {
  float3 d = 0.0;
${CASCADE_SIZES.map((_, c) => `  d += BreakerCascade${c}(p) * math.CascadeAttenuation(${c}, depth);`).join('\n')}
  return d;
}
`;

export const CASCADE_TEXTURE_NAMES = CASCADE_SIZES.map((_, c) => `Displacement${c}`);
