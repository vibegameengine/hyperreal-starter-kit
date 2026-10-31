import { cloneElement } from 'react';
import { defineMaterial } from '../../../../shared/material';
import { SEA_LEVEL } from '../coastShape';
import { BREAKER_CAPACITY } from './breakerSpec';
import { CREST_READ } from './breakerLip';
import { shoreTexture } from './oceanShore';
import { SPRAY_COLUMNS, SPRAY_KIND, SPRAY_MAX_DISTANCE } from './spraySpec';

const fixed = (value: number) => value.toFixed(6);
const byKind = (values: readonly number[]) => `kinds.By(kind, ${values.map(fixed).join(', ')})`;

const KINDS = `struct SprayKinds {
  float By(float k, float a, float b, float c, float d, float e) { return k < 0.5 ? a : (k < 1.5 ? b : (k < 2.5 ? c : (k < 3.5 ? d : e))); }
};
SprayKinds kinds;`;

const WAVE_SHADOW = `${CREST_READ}
struct SprayWaveShadow {
  float At(Texture2D C, float3 p, float seedTag, float3 L) {
    float result = 1.0;
    float idx = floor(seedTag) - 1.0;
    if (idx >= 0.0 && idx < ${fixed(BREAKER_CAPACITY * 2)}) {
      BreakerCrestRead crest;
      uint k = uint(idx);
      float4 c0 = crest.At(C, k / 2u, k % 2u, 0u); float4 c1 = crest.At(C, k / 2u, k % 2u, 1u); float4 c2 = crest.At(C, k / 2u, k % 2u, 2u);
      float2 d2 = c2.xy;
      float Ld = dot(L.xz, d2);
      if (c2.w > 0.5 && Ld < -0.02) {
        float3 root = c0.xyz; float b = c0.w; float H = c1.w;
        float q = clamp(b / 0.9, 0.0, 1.0) * (1.0 - smoothstep(1.0, 1.3, b));
        float2 plane = root.xz + d2 * (H * 0.8 * q * 0.6);
        float s = dot(p.xz - plane, d2);
        float yRay = p.y + L.y * (s / -Ld);
        float top = root.y + 0.05;
        result = 1.0 - smoothstep(top, top - 0.4, yRay) * smoothstep(-0.1, 0.1, s) * smoothstep(14.0, 6.0, s) * 0.55;
      }
    }
    return result;
  }
};`;

const VERTEX = `${KINDS}
${WAVE_SHADOW}
SprayWaveShadow waveShadow;
uint i = uint(round(index));
int3 tx = int3(i % ${SPRAY_COLUMNS}u, i / ${SPRAY_COLUMNS}u, 0);
float4 posA = Ps.Load(tx); float4 velA = Vl.Load(tx); float4 info = In.Load(tx);
float3 p = posA.xyz; float age = posA.w; float3 vel = velA.xyz; float kind = info.x; float life = info.y;
bool isDrop = kind < 0.5; bool isLig = kind > 1.5 && kind < 2.5; bool isMist = kind > 0.5 && kind < 1.5;
bool water = isDrop || isLig;
bool alive = life > 0.0 && age < life;
float3 toCam = float3(eye.x, eye.z, eye.y) / 100.0 - p;
float dist = max(length(toCam), 0.05);
float3 Vd = toCam / dist;
float pixel = dist * 2.0 / (View.ViewToClip[1][1] * View.ViewSizeAndInvSize.y);
float r0 = velA.w;
float tAge = age / max(life, 1e-3);
float r = (kind > 2.5 && kind < 3.5) ? r0 * lerp(0.45, 1.0, smoothstep(0.0, 0.25, tAge)) : r0;
float size = max(r, pixel * 1.3);
float3 vPerp = vel - Vd * dot(vel, Vd);
float speed = length(vPerp);
float stretchLen = speed * ${byKind(SPRAY_KIND.stretch)};
float elong = isLig ? r * 2.0 : 0.0;
float3 up = speed > 1e-3 ? vPerp / max(speed, 1e-3) : float3(0.0, 1.0, 0.0);
float rot = frac(info.w) * 6.283 + age * (frac(info.w) - 0.5);
float3 camRight = normalize(cross(float3(0.0, 1.0, 0.0), Vd) + float3(1e-5, 0.0, 0.0));
float3 camUp = cross(Vd, camRight);
float3 mRight = camRight * cos(rot) + camUp * sin(rot);
float3 mUp = camUp * cos(rot) - camRight * sin(rot);
bool isSheet = kind > 2.5;
float3 side = normalize(cross(Vd, up));
float tilt = (frac(info.w * 7.31) - 0.5) * 0.7;
float3 sUp = up * cos(tilt) + side * sin(tilt);
float3 sSide = side * cos(tilt) - up * sin(tilt);
bool alongMotion = isSheet || (isMist && speed > 0.3);
float3 axisY = water ? up : (alongMotion ? sUp : mUp);
float3 axisX = water ? side : (alongMotion ? sSide : mRight);
float sheetLen = isSheet ? size * clamp(speed * 0.08, 0.0, 0.8) : 0.0;
float mistLen = isMist ? size * clamp((speed - 0.3) * 0.35, 0.0, 1.4) : 0.0;
float halfY = size + stretchLen * 0.5 + elong + sheetLen + mistLen;
float halfX = isSheet ? size * 1.05 : size;
float2 corner = uv;
float3 world = p + axisX * (corner.x * halfX) + axisY * (corner.y * halfY);
float kShape = isLig ? 4.5 : 3.5;
float cover = water ? min(r * (r + elong) * kShape / (halfX * halfY), 1.0) : saturate(r / size);
float3 L = normalize(float3(sun.x, sun.z, sun.y));
float t = age / max(life, 1e-3);
float fadeIn = smoothstep(0.0, ${byKind(SPRAY_KIND.fadeIn)}, t);
float fadeOut = 1.0 - smoothstep(${byKind(SPRAY_KIND.fadeOut)}, 1.0, t);
float distFade = smoothstep(maxDistance, maxDistance * 0.55, dist) * (water ? 1.0 : smoothstep(0.6, 3.0, dist));
float a = ${byKind(SPRAY_KIND.alpha)} * fadeIn * fadeOut * cover * distFade * intensity;
SprayA = float4(corner, a, waveShadow.At(C, p, info.w, L));
SprayMisc = float4(kind + saturate(t) * 0.45, info.z, size, frac(info.w));
SprayView = float4(Vd, halfX / pixel);
float3 P = (alive && a > 1e-4) ? world : float3(0.0, -1e5, 0.0);
return float3(P.x * 100.0, P.z * 100.0, P.y * 100.0 + ${fixed(SEA_LEVEL)}) - wp;`;

const vertex = (
  <custom
    description="SprayVertex"
    outputType="Float3"
    inputs={{
      wp: <worldPosition worldPositionShaderOffset="ExcludeAllShaderOffsets" />,
      uv: <textureCoordinate />,
      index: <perInstanceCustomData dataIndex={0} />,
      eye: <cameraPositionWS />,
      sun: <skyAtmosphereLightDirection lightIndex={0} />,
      Ps: shoreTexture('SprayPos'),
      Vl: shoreTexture('SprayVel'),
      In: shoreTexture('SprayInfo'),
      C: shoreTexture('BreakerCrest'),
      maxDistance: <scalarParameter parameterName="SprayMaxDistance" defaultValue={SPRAY_MAX_DISTANCE} />,
      intensity: <scalarParameter parameterName="SprayIntensity" defaultValue={1} />,
    }}
    additionalOutputs={{ SprayA: 'Float4', SprayMisc: 'Float4', SprayView: 'Float4' }}
    code={VERTEX}
  />
);

const vertexOutput = (output: string) => <vertexInterpolator input={cloneElement(vertex, { output } as Record<string, unknown>)} />;

const SHAPE = `float2 uv = A.xy; float kind = M.x;
bool isDrop = kind < 0.5; bool isLig = kind > 1.5 && kind < 2.5; bool isMist = kind > 0.5 && kind < 1.5;
bool isSheet = kind > 2.5; bool isClear = kind > 3.5; bool water = isDrop || isLig;
float t = saturate(frac(kind) / 0.45);
float r2 = dot(uv, uv);
float2 sd = float2(M.w, M.w * 1.7);
float drop = max(exp(r2 * -3.5) - 0.03, 0.0);
float lig = max(exp(r2 * -4.5) * (sin(uv.y * 5.0 + M.w * 40.0) * 0.2 + 0.9) - 0.03, 0.0);
float env = saturate(1.0 - r2);
float fib = Pf.Sample(PfSampler, float2(uv.x * 0.5, uv.y * 0.26) + sd).x;
float fine = Pf.Sample(PfSampler, float2(uv.x * 1.2, uv.y * 0.6) + sd * 2.3).x;
float field = fib * 0.6 + fine * 0.4 + (env - 0.55) * 0.75 - smoothstep(0.8, 1.0, r2);
float farK = smoothstep(14.0, 3.0, Vw.w) * ((isSheet && !isClear) ? 1.0 : 0.0);
float erode = lerp(0.26, 0.7, t) + farK * 0.16;
float dens = saturate((field - erode) * 3.0);
float torn = smoothstep(erode - 0.04, erode + 0.2, field) * (dens * 0.45 + 0.55);
float dots = Dt.Sample(DtSampler, uv * float2(0.5, 0.32) + sd * 3.7).x;
float swarm = dots * smoothstep(0.25, 0.55, fib + env * 0.45 - t * 0.2) * (1.0 - t * 0.5);
float sheet = max(torn * (1.0 - smoothstep(0.15, 0.6, t)), swarm);
float m1 = Pf.Sample(PfSampler, uv * 0.2 + sd).x;
float m2 = Pf.Sample(PfSampler, uv * 0.55 + sd * 3.1).x;
float veil = smoothstep(0.28, 0.8, m1 * 0.7 + m2 * 0.3 + env * 0.3 - 0.12) * sqrt(env) * (1.0 - t * 0.4);
float shape = isDrop ? drop : (isLig ? lig : (isSheet ? sheet : veil));
float shade = (isSheet && !isClear) ? 1.0 - dens * 0.15 : 1.0;
float glow = isClear ? 1.0 - dens * 0.3 : (isSheet ? 1.0 - dens * 0.6 : 1.0);
float PI = 3.14159265;
float3 Vd = Vw.xyz;
float3 L = normalize(float3(sun.x, sun.z, sun.y));
float cosT = dot(-Vd, L); float cosA = dot(Vd, L);
float3 sunE = sunIllum * A.w;
float3 skyE = skyIrr * PI;
float gW = 0.85; float gS = 0.6; float gM = 0.75; float gC = 0.8;
float hgW = (1.0 - gW * gW) / (4.0 * PI) / pow(max(1.0 + gW * gW - 2.0 * gW * cosT, 1e-4), 1.5);
float hgS = (1.0 - gS * gS) / (4.0 * PI) / pow(max(1.0 + gS * gS - 2.0 * gS * cosT, 1e-4), 1.5);
float hgM = (1.0 - gM * gM) / (4.0 * PI) / pow(max(1.0 + gM * gM - 2.0 * gM * cosT, 1e-4), 1.5);
float hgC = (1.0 - gC * gC) / (4.0 * PI) / pow(max(1.0 + gC * gC - 2.0 * gC * cosT, 1e-4), 1.5);
float3 cWater = skyE * 0.9 + sunE * (hgW * 1.2 + 0.12);
float lambert = (sqrt(max(1.0 - cosA * cosA, 0.0)) + (PI - acos(clamp(cosA, -1.0, 1.0))) * cosA) / PI;
float3 cSpray = sunE * ((lambert * 0.65 + 0.35) / PI) + skyE * 1.15;
float3 cMist = sunE * (0.25 / PI) + skyE * 0.9;
float3 cClear = skyE * 0.95 + sunE * 0.05;
float3 col = water ? cWater : (isMist ? cMist : (isClear ? cClear : cSpray));
float3 fwd = water ? float3(0.0, 0.0, 0.0) : (isMist ? sunE * hgM : (isClear ? sunE * (hgC * 1.1) : sunE * (hgS * 0.9)));
float soft = M.z * 1.5 + 0.03;
float fadeScene = saturate((sceneZ - pixelZ) / 100.0 / soft);
float fadeWater = saturate((wpos.z / 100.0 - M.y) / (soft * 0.6) + 0.15);
float aOut = A.z * shape * fadeScene * fadeWater * (1.0 - farK * 0.4);
aOut = aOut < 0.002 ? 0.0 : aOut;
Alpha = aOut;
return (col * shade + fwd * glow) * aOut;`;

const shade = (
  <custom
    description="SprayShade"
    outputType="Float3"
    inputs={{
      A: vertexOutput('SprayA'),
      M: vertexOutput('SprayMisc'),
      Vw: vertexOutput('SprayView'),
      wpos: <worldPosition />,
      sceneZ: <sceneDepth />,
      pixelZ: <pixelDepth />,
      sun: <skyAtmosphereLightDirection lightIndex={0} />,
      sunIllum: <skyAtmosphereLightIlluminance lightIndex={0} />,
      skyIrr: <skyLightEnvMapSample direction={[0, 0, 1]} roughness={1} />,
      Pf: <textureObjectParameter parameterName="SprayPuff" texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" samplerSource="SSM_Wrap_WorldGroupSettings" />,
      Dt: <textureObjectParameter parameterName="SprayDots" texture="/Engine/EngineMaterials/DefaultDiffuse_TC_Masks" samplerType="Masks" samplerSource="SSM_Wrap_WorldGroupSettings" />,
    }}
    additionalOutputs={{ Alpha: 'Float1' }}
    code={SHAPE}
  />
);

export const sprayParticles = defineMaterial(
  <material
    usage={['instancedStaticMeshes']}
    shadingModel="Unlit"
    blendMode="AlphaComposite"
    twoSided
    emissiveColor={shade}
    opacity={cloneElement(shade, { output: 'Alpha' } as Record<string, unknown>)}
    worldPositionOffset={vertex}
  />,
);
