import { defineGraph, float, param } from '../../../shared/pcg';
import { bark, leaves, stone } from './nature/nature.material';
import { PATH_WIDTH } from './pcgLabShape';

const treeMaterials = [bark, leaves];
const up = { x: 0, y: 0, z: 1 };
const box = (x: number, y: number, z: number) => ({ boundsMin: { x: -x, y: -y, z: -z }, boundsMax: { x, y, z } });

export const forest = defineGraph({
  params: {
    treeDensity: float(0.012),
    rockDensity: float(0.01),
    flatness: float(0.82),
  },
  nodes: {
    surface: { type: 'World Ray Hit Query', params: { queryParams: { bIgnorePCGHits: true, bIgnoreSelfHits: true } } },
    path: { type: 'Get Spline Data' },
    pathPoints: { type: 'Spline Sampler', params: { samplerParams: { dimension: 'OnSpline', mode: 'Distance', distanceIncrement: 150 } } },
    pathWidth: { type: 'Bounds Modifier', params: { mode: 'Set', ...box(PATH_WIDTH + 80, PATH_WIDTH + 80, 3000) } },

    trees: { type: 'Surface Sampler', params: { pointsPerSquaredMeter: param('treeDensity'), pointExtents: { x: 150, y: 150, z: 500 }, pointSteepness: 0.5 } },
    treeSlope: { type: 'Normal To Density', params: { normal: up, densityMode: 'Set' } },
    treeFlat: { type: 'Density Filter', params: { lowerBound: param('flatness'), upperBound: 1 } },
    treeJitter: { type: 'Transform Points', params: { rotationMin: { pitch: -5, yaw: -180, roll: -5 }, rotationMax: { pitch: 5, yaw: 180, roll: 5 }, scaleMin: { x: 0.8, y: 0.8, z: 0.8 }, scaleMax: { x: 1.3, y: 1.3, z: 1.3 } } },
    treeBounds: { type: 'Bounds Modifier', params: { mode: 'Set', ...box(32, 32, 100), bAffectSteepness: true } },
    treeClear: { type: 'Difference', params: { densityFunction: 'Binary' } },
    treePoints: { type: 'To Point' },
    treeSpawn: { type: 'Static Mesh Spawner', meshes: [{ model: './nature/tree.glb', materials: treeMaterials }, { model: './nature/tree-tall.glb', materials: treeMaterials }] },

    rocks: { type: 'Surface Sampler', params: { pointsPerSquaredMeter: param('rockDensity'), pointExtents: { x: 100, y: 75, z: 60 }, pointSteepness: 0.5 } },
    rockSlope: { type: 'Normal To Density', params: { normal: up, densityMode: 'Set' } },
    rockSteep: { type: 'Density Filter', params: { lowerBound: param('flatness'), upperBound: 1, bInvertFilter: true } },
    rockJitter: { type: 'Transform Points', params: { rotationMin: { pitch: 0, yaw: -180, roll: 0 }, rotationMax: { pitch: 0, yaw: 180, roll: 0 }, scaleMin: { x: 0.6, y: 0.6, z: 0.6 }, scaleMax: { x: 2, y: 2, z: 2 } } },
    rockPrune: { type: 'Self Pruning' },
    rockClear: { type: 'Difference', params: { densityFunction: 'Binary' } },
    rockPoints: { type: 'To Point' },
    rockSpawn: { type: 'Static Mesh Spawner', meshes: [{ model: './nature/rock.glb', materials: [stone] }, { model: './nature/rock-flat.glb', materials: [stone] }] },
  },
  edges: [
    ['path', 'pathPoints:Spline'],
    ['pathPoints', 'pathWidth'],

    ['surface', 'trees:Surface'],
    ['trees', 'treeSlope'],
    ['treeSlope', 'treeFlat'],
    ['treeFlat', 'treeJitter'],
    ['treeJitter', 'treeBounds'],
    ['treeBounds', 'treeClear:Source'],
    ['pathWidth', 'treeClear:Differences'],
    ['treeClear', 'treePoints'],
    ['treePoints', 'treeSpawn'],

    ['surface', 'rocks:Surface'],
    ['rocks', 'rockSlope'],
    ['rockSlope', 'rockSteep'],
    ['rockSteep', 'rockJitter'],
    ['rockJitter', 'rockPrune'],
    ['rockPrune', 'rockClear:Source'],
    ['treeBounds', 'rockClear:Differences'],
    ['pathWidth', 'rockClear:Differences'],
    ['rockClear', 'rockPoints'],
    ['rockPoints', 'rockSpawn'],
  ],
});
