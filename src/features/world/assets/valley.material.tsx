import type { ReactElement } from 'react';
import { defineMaterial, param } from '../../../shared/material';
import { GROWTH_STAGES } from '../growth/field';
import { metresBehindFront } from './growthFront';
import { scanGround, type PackFilter, type ScanLayer } from './scanLayers';

const REVEAL_METRES = 4;

const GRASS: ScanLayer = { name: 'Grass', set: 'Ground', macro: 'MacroLand' };
const PATH: ScanLayer = { name: 'Path', set: 'Shore', macro: 'MacroSand' };
const VALLEY_LAYERS: ScanLayer[] = [GRASS, { name: 'Gravel', set: 'Gravel', macro: 'MacroLand' }, { name: 'Rock', set: 'CliffA', macro: 'MacroLand' }, { name: 'Sand', set: 'Sand', macro: 'MacroSand' }, PATH];

const behind = metresBehindFront(<worldPosition />);

const revealOf = (from: number) => <custom description="GrowthReveal" outputType="Float1" inputs={{ m: behind }} code={`return smoothstep(${from}, ${from + REVEAL_METRES}, m);`} />;

const pathLaid: PackFilter = (layer, pack, outputType) =>
  layer !== PATH ? pack(layer) : <custom description="PathLaid" outputType={outputType} inputs={{ before: pack(GRASS), after: pack(PATH), t: revealOf(GROWTH_STAGES.path) }} code="return lerp(before, after, t);" />;

const ground = scanGround(VALLEY_LAYERS, pathLaid);

const BARE = 0.2;

const fromBare = (description: string, outputType: 'Float1' | 'Float3', grown: ReactElement, bare: string) => (
  <custom description={description} outputType={outputType} inputs={{ grown, t: revealOf(GROWTH_STAGES.ground) }} code={`return lerp(${bare}, grown, t);`} />
);

const rising = (
  <custom
    description="ValleyRise"
    outputType="Float3"
    inputs={{ p: <worldPosition />, rise: param('Rise', 1), floor: param('RiseFloor', 0) }}
    code="return float3(0, 0, (floor - p.z) * (1 - rise));"
  />
);

export const valleyGround = defineMaterial(
  <material
    baseColor={fromBare('ValleyAlbedoReveal', 'Float3', ground.baseColor, `float3(${BARE}, ${BARE}, ${BARE})`)}
    normal={fromBare('ValleyNormalReveal', 'Float3', ground.normal, 'float3(0, 0, 1)')}
    roughness={fromBare('ValleyRoughnessReveal', 'Float1', ground.roughness, '0.9')}
    ambientOcclusion={ground.ambientOcclusion}
    specular={ground.specular}
    worldPositionOffset={rising}
  />,
);
