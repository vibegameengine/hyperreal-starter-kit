import { defineTerrain, type TerrainSample } from '../../../shared/terrain';
import { grass } from './nature/nature.material';
import { valleyGround } from './valley.material';
import { clamp01, lakeShore, PATH_WIDTH, pathOffset, smooth, valleyHeight } from './valleyShape';

const steep = ({ slope }: TerrainSample) => smooth(clamp01((slope - 24) / 12));
const upland = ({ height }: TerrainSample) => smooth(clamp01((height - 1600) / 600));

export const valley = defineTerrain({
  components: 8,
  quadsPerSection: 63,
  spacing: 100,
  height: valleyHeight,
  material: valleyGround,
  runtimeMaterialParameters: true,
  layers: [
    { name: 'Grass', weight: (sample) => (1 - steep(sample)) * (1 - upland(sample)) * smooth(clamp01((lakeShore(sample.x, sample.y) - 1) / 0.12)) },
    { name: 'Gravel', weight: (sample) => (1 - steep(sample)) * upland(sample) },
    { name: 'Rock', weight: (sample) => steep(sample) + smooth(clamp01((sample.height - 2300) / 500)) },
    { name: 'Sand', weight: ({ x, y }) => 3 * (1 - smooth(clamp01((lakeShore(x, y) - 0.98) / 0.14))) },
    { name: 'Path', weight: ({ x, y, slope }) => (slope < 18 ? 2.5 * (1 - smooth(clamp01((pathOffset(x, y) - PATH_WIDTH) / 140))) : 0) },
  ],
  grass: [
    { layer: 'Grass', model: './nature/grass.glb', material: grass, density: 500, startCull: 3000, endCull: 4500, scale: [0.85, 1.25] },
    { layer: 'Grass', model: './nature/grass-far.glb', material: grass, density: 55, startCull: 9000, endCull: 12000, scale: [0.9, 1.2] },
  ],
});
