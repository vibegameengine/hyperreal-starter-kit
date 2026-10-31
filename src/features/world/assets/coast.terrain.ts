import { defineTerrain, type TerrainSample } from '../../../shared/terrain';
import { coastGround } from './coast.material';
import { clamp01, coastHeight, sandiness, shoreDistance, smooth } from './coastShape';
import { grass } from './nature/nature.material';

const steepness = ({ slope }: TerrainSample) => smooth(clamp01((slope - 30) / 10));

const sand = (sample: TerrainSample) => {
  const s = shoreDistance(sample.x, sample.y);
  const beachBand = 1 - smooth(clamp01((s - 3200) / 1600));
  return sandiness(sample.x, sample.y) * beachBand * (1 - steepness(sample));
};

const shore = (sample: TerrainSample) => {
  const s = shoreDistance(sample.x, sample.y);
  const nearWater = 1 - smooth(clamp01((s - 900) / 900));
  return nearWater * (1 - sandiness(sample.x, sample.y)) * (1 - steepness(sample));
};

const ground = (sample: TerrainSample) => clamp01(1 - steepness(sample) - sand(sample) - shore(sample));

export const coast = defineTerrain({
  components: 8,
  quadsPerSection: 63,
  spacing: 100,
  height: coastHeight,
  material: coastGround,
  runtimeMaterialParameters: true,
  layers: [
    { name: 'Ground', weight: ground },
    { name: 'Rock', weight: steepness },
    { name: 'Shore', weight: shore },
    { name: 'Sand', weight: sand },
  ],
  grass: [
    { layer: 'Ground', model: './nature/grass.glb', material: grass, density: 500, startCull: 3000, endCull: 4500, scale: [0.85, 1.25] },
    { layer: 'Ground', model: './nature/grass-far.glb', material: grass, density: 55, startCull: 9000, endCull: 12000, scale: [0.9, 1.2] },
  ],
});
