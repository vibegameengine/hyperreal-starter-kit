import { cloneElement, type ReactElement } from 'react';
import groundSets from './scans/groundSets.json';

export type GroundSet = keyof typeof groundSets;

export interface ScanLayer {
  name: string;
  set: GroundSet;
  macro: GroundSet;
  wet?: boolean;
}

type PackKind = 'A' | 'B' | 'C';
export type PackFilter = (layer: ScanLayer, pack: (layer: ScanLayer) => ReactElement, outputType: 'Float4' | 'Float2') => ReactElement;

const FAR_SCALE = 4;
const FAR_BLEND = { start: 1500, range: 2500 };
const HEIGHT_CONTRAST = 6;
const WET = { top: 70, band: 30, film: 15, heightScale: 40 };

const DEFAULT = {
  Color: { texture: '/Engine/EngineResources/WhiteSquareTexture', samplerType: 'Color' },
  Normal: { texture: '/Engine/EngineMaterials/DefaultNormal', samplerType: 'Normal' },
  Surface: { texture: '/Engine/EngineMaterials/DefaultDiffuse_TC_Masks', samplerType: 'Masks' },
} as const;

const textureObject = (set: string, map: keyof typeof DEFAULT) => (
  <textureObjectParameter parameterName={`${set}${map}`} texture={DEFAULT[map].texture} samplerType={DEFAULT[map].samplerType} />
);

const HEX = `struct Hex {
float2 Hash(float2 p) { float2 r = mul(float2x2(127.1, 311.7, 269.5, 183.3), p); return frac(sin(r) * 43758.5453); }
void Grid(out float3 w, out int2 v1, out int2 v2, out int2 v3, float2 st) {
  st *= 2 * sqrt(3.0);
  float2 skewed = mul(float2x2(1.0, -0.57735027, 0.0, 1.15470054), st);
  int2 base = int2(floor(skewed));
  float3 t = float3(frac(skewed), 0); t.z = 1.0 - t.x - t.y;
  float s = step(0.0, -t.z); float s2 = 2 * s - 1;
  w = float3(-t.z * s2, s - t.y * s2, s - t.x * s2);
  v1 = base + int2(s, s); v2 = base + int2(s, 1 - s); v3 = base + int2(1 - s, s);
}
float2 Centre(int2 v) { return mul(float2x2(1.0, 0.5, 0.0, 1.0 / 1.15470054), float2(v)) / (2 * sqrt(3.0)); }
float2x2 Rotation(int2 v) {
  float a = abs(v.x * v.y) + abs(v.x + v.y) + 3.14159265;
  a = fmod(a, 6.2831853); if (a < 0) a += 6.2831853; if (a > 3.14159265) a -= 6.2831853;
  float c = cos(a), s = sin(a); return float2x2(c, -s, s, c);
}
float3 Gain3(float3 x, float r) {
  float k = log(1 - r) / log(0.5);
  float3 s = 2 * step(0.5, x); float3 m = 2 * (1 - s);
  float3 res = 0.5 * s + 0.25 * m * pow(max(0.0, s + x * m), k);
  return res / (res.x + res.y + res.z);
}
float2 Derivative(float4 raw) { float2 xy = raw.xy * 2 - 1; float z = sqrt(saturate(1 - dot(xy, xy))); return -xy / max(z, 0.05); }
void Sample(Texture2D C, Texture2D N, Texture2D S, SamplerState ss, float2 st, out float3 albedo, out float2 deriv, out float3 arh) {
  float2 dx = ddx(st), dy = ddy(st);
  float3 w; int2 v1, v2, v3; Grid(w, v1, v2, v3, st);
  int2 v[3] = { v1, v2, v3 };
  float3 a[3]; float2 d[3]; float3 h[3]; float3 metric;
  for (int i = 0; i < 3; i++) {
    float2x2 r = Rotation(v[i]); float2 c = Centre(v[i]);
    float2 uv = mul(st - c, r) + c + Hash(float2(v[i]));
    float2 gx = mul(dx, r), gy = mul(dy, r);
    a[i] = C.SampleGrad(ss, uv, gx, gy).rgb;
    d[i] = mul(r, Derivative(N.SampleGrad(ss, uv, gx, gy)));
    h[i] = S.SampleGrad(ss, uv, gx, gy).rgb;
    metric[i] = h[i].b;
  }
  float3 W = pow(w, 7) * lerp(1, metric, 0.6); W /= (W.x + W.y + W.z);
  float3 Wc = Gain3(W, 0.7);
  albedo = a[0] * Wc.x + a[1] * Wc.y + a[2] * Wc.z;
  arh = h[0] * Wc.x + h[1] * Wc.y + h[2] * Wc.z;
  deriv = d[0] * W.x + d[1] * W.y + d[2] * W.z;
}
};`;

const layerSurface = (layer: ScanLayer) => {
  const set = groundSets[layer.set];
  const macro = groundSets[layer.macro];
  const inputs: Record<string, ReactElement> = {
    C: textureObject(layer.set, 'Color'),
    N: textureObject(layer.set, 'Normal'),
    S: textureObject(layer.set, 'Surface'),
    M: textureObject(layer.macro, 'Color'),
    p: <worldPosition />,
    eye: <cameraPositionWS />,
    ...(layer.wet ? { WC: textureObject('SandWet', 'Color'), WN: textureObject('SandWet', 'Normal'), WS: textureObject('SandWet', 'Surface') } : {}),
  };
  const wetCode = layer.wet
    ? `float3 wa; float2 wd; float3 wh;
hex.Sample(WC, WN, WS, ss, st, wa, wd, wh);
float wet = 1 - smoothstep(${WET.top - WET.band}, ${WET.top}, p.z + ${WET.heightScale} * (arh.b - 0.5));
float film = 1 - smoothstep(${WET.film - 10}, ${WET.film}, p.z);
albedo = lerp(albedo, wa, wet); deriv = lerp(deriv, wd, wet); arh = lerp(arh, wh, wet);
arh.g = lerp(arh.g, 0.06, film); specular = lerp(0.5, 0.25, film);`
    : '';
  return (
    <custom
      description={`${layer.name}Surface`}
      outputType="Float3"
      inputs={inputs}
      additionalOutputs={{ Deriv: 'Float2', Rough: 'Float1', Occlusion: 'Float1', Height: 'Float1', Spec: 'Float1' }}
      code={`${HEX} Hex hex;
SamplerState ss = GetMaterialSharedSampler(CSampler, View.MaterialTextureBilinearWrapedSampler);
float2 st = p.xy / ${set.tileCentimetres};
float3 albedo; float2 deriv; float3 arh;
hex.Sample(C, N, S, ss, st, albedo, deriv, arh);
float far = saturate((length(p - eye) - ${FAR_BLEND.start}) / ${FAR_BLEND.range});
if (far > 0) {
  float3 fa; float2 fd; float3 fh;
  hex.Sample(C, N, S, ss, st / ${FAR_SCALE}, fa, fd, fh);
  albedo = lerp(albedo, fa, far); deriv = lerp(deriv, fd / ${FAR_SCALE}, far); arh = lerp(arh, fh, far);
}
float specular = 0.5;
${wetCode}
float3 macroColor = M.SampleLevel(ss, p.xy / ${macro.tileCentimetres}, 0).rgb;
float macroLum = dot(macroColor, float3(0.2126, 0.7152, 0.0722));
albedo *= clamp(macroLum / ${macro.meanLuminance.toFixed(5)}, 0.6, 1.5);
Deriv = deriv; Rough = arh.g; Occlusion = arh.r; Height = arh.b; Spec = specular;
return albedo;`}
    />
  );
};

const weighted = (layer: ScanLayer, pack: (surface: (output?: string) => ReactElement) => ReactElement) => {
  const node = layerSurface(layer);
  return pack((output) => (output ? cloneElement(node, { output } as Record<string, unknown>) : node));
};

const exponent = (height: ReactElement) => <custom description="HeightWeight" outputType="Float1" inputs={{ h: height }} code={`return exp(${HEIGHT_CONTRAST} * h);`} />;

const PACKS: Record<PackKind, { outputType: 'Float4' | 'Float2'; zero: readonly number[]; make: (layer: ScanLayer) => ReactElement }> = {
  A: {
    outputType: 'Float4',
    zero: [0, 0, 0, 0],
    make: (layer) =>
      weighted(layer, (surface) => (
        <custom description={`${layer.name}PackA`} outputType="Float4" inputs={{ albedo: surface(), e: exponent(surface('Height')) }} code="return float4(albedo * e, e);" />
      )),
  },
  B: {
    outputType: 'Float4',
    zero: [0, 0, 0, 0],
    make: (layer) =>
      weighted(layer, (surface) => (
        <custom
          description={`${layer.name}PackB`}
          outputType="Float4"
          inputs={{ d: surface('Deriv'), r: surface('Rough'), o: surface('Occlusion'), e: exponent(surface('Height')) }}
          code="return float4(d * e, r * e, o * e);"
        />
      )),
  },
  C: {
    outputType: 'Float2',
    zero: [0, 0],
    make: (layer) =>
      weighted(layer, (surface) => <custom description={`${layer.name}PackC`} outputType="Float2" inputs={{ s: surface('Spec'), e: exponent(surface('Height')) }} code="return float2(s * e, e);" />),
  },
};

const chain = (layers: readonly ScanLayer[], kind: PackKind, filter: PackFilter) => {
  const { outputType, zero, make } = PACKS[kind];
  return layers.reduce<ReactElement | readonly number[]>(
    (base, layer) => <landscapeLayerWeight parameterName={layer.name} base={base} layer={filter(layer, make, outputType)} />,
    zero,
  ) as ReactElement;
};

const unfiltered: PackFilter = (layer, pack) => pack(layer);

export function scanGround(layers: readonly ScanLayer[], filter: PackFilter = unfiltered) {
  const sumA = chain(layers, 'A', filter);
  const sumB = chain(layers, 'B', filter);
  const sumC = chain(layers, 'C', filter);
  const resolve = (description: string, outputType: 'Float1' | 'Float3', code: string) => (
    <custom description={description} outputType={outputType} inputs={{ a: sumA, b: sumB, c: sumC }} code={`float e = max(a.w, 1e-4); ${code}`} />
  );
  return {
    baseColor: resolve('GroundAlbedo', 'Float3', 'return a.rgb / e;'),
    normal: resolve('GroundNormal', 'Float3', 'float2 d = b.xy / e; return normalize(float3(-d, 1));'),
    roughness: resolve('GroundRoughness', 'Float1', 'return b.z / e;'),
    ambientOcclusion: resolve('GroundOcclusion', 'Float1', 'return b.w / e;'),
    specular: resolve('GroundSpecular', 'Float1', 'return c.x / max(c.y, 1e-4);'),
  };
}
