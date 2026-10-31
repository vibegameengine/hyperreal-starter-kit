import { defineTerrain } from '../../../shared/terrain';
import { valleyGround } from './valley.material';
import { clamp01, smooth } from './valleyShape';
import { PATH_WIDTH, pathDistance, pcgLabHeight } from './pcgLabShape';

const steep = (slope: number) => smooth(clamp01((slope - 26) / 10));
const onPath = (x: number, y: number) => 1 - smooth(clamp01((pathDistance(x, y) - PATH_WIDTH * 0.6) / 120));

export const pcgLab = defineTerrain({
  components: 3,
  quadsPerSection: 63,
  spacing: 100,
  height: pcgLabHeight,
  material: valleyGround,
  runtimeMaterialParameters: true,
  layers: [
    { name: 'Grass', weight: ({ x, y, slope }) => (1 - steep(slope)) * (1 - onPath(x, y)) },
    { name: 'Rock', weight: ({ slope }) => steep(slope) },
    { name: 'Gravel', weight: ({ x, y, slope }) => (1 - steep(slope)) * onPath(x, y) },
  ],
});
