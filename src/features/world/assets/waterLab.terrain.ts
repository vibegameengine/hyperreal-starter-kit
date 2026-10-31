import { defineTerrain, type WaterPoint } from '../../../shared/terrain';
import { valleyGround } from './valley.material';
import { clamp01, smooth } from './valleyShape';
import { LAKE_CENTER, LAKE_RADIUS, RIVER, RIVER_DEPTH, RIVER_WIDTH, WATER_LEVEL, waterLabHeight } from './waterLabShape';

const lakeShore = (count: number): WaterPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = LAKE_RADIUS * (0.72 + 0.06 * Math.sin(angle * 3));
    return { at: [LAKE_CENTER[0] + Math.cos(angle) * radius, LAKE_CENTER[1] + Math.sin(angle) * radius, WATER_LEVEL] };
  });

const shore = (h: number) => smooth(clamp01((h - WATER_LEVEL - 30) / 60));

export const waterLab = defineTerrain({
  components: 3,
  quadsPerSection: 63,
  spacing: 100,
  height: waterLabHeight,
  material: valleyGround,
  runtimeMaterialParameters: true,
  layers: [
    { name: 'Grass', weight: ({ height }) => shore(height) },
    { name: 'Sand', weight: ({ height }) => 1 - shore(height) },
  ],
  water: {
    zone: { extent: [19000, 19000] },
    bodies: [
      { type: 'lake', points: lakeShore(10) },
      { type: 'river', points: RIVER.map(([x, y, z]) => ({ at: [x, y, z], width: RIVER_WIDTH, depth: RIVER_DEPTH, velocity: 150 })) },
    ],
  },
});
