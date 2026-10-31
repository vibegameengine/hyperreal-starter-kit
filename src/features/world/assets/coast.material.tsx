import { defineMaterial } from '../../../shared/material';
import { COAST_LAYERS, type CoastLayer } from './coastTextures';
import { scanGround } from './scanLayers';

const MACRO_OF: Record<CoastLayer, 'MacroSand' | 'MacroLand'> = { Ground: 'MacroLand', Rock: 'MacroLand', Shore: 'MacroSand', Sand: 'MacroSand' };

const ground = scanGround(COAST_LAYERS.map((layer) => ({ name: layer, set: layer, macro: MACRO_OF[layer], wet: layer === 'Sand' })));

export const coastGround = defineMaterial(
  <material baseColor={ground.baseColor} normal={ground.normal} roughness={ground.roughness} ambientOcclusion={ground.ambientOcclusion} specular={ground.specular} />,
);
