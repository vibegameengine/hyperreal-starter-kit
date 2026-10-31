import { defineFracture } from '../../../shared/fracture';

const thresholds = (...perLevel: number[]) => ({
  DamageModel: 'Chaos_Damage_Model_UserDefined_Damage_Threshold',
  bUseSizeSpecificDamageThreshold: false,
  DamageThreshold: perLevel,
});

export const brickWall = defineFracture({
  nodes: {
    mesh: { type: 'FStaticMeshToCollectionDataflowNode_v2', model: './destruction/brick-wall.glb' },
    slabs: { type: 'FPlaneCutterDataflowNode_v2', params: { NumPlanes: 5, RandomSeed: 3, Amplitude: 4, Frequency: 0.05 } },
    chunks: { type: 'FUniformFractureDataflowNode', params: { MinVoronoiSites: 6, MaxVoronoiSites: 10, RandomSeed: 5 } },
    out: { type: 'FGeometryCollectionTerminalDataflowNode_v2' },
  },
  edges: [
    ['mesh:Collection', 'slabs:Collection'],
    ['slabs:Collection', 'chunks:Collection'],
    ['slabs:NewGeometryTransformSelection', 'chunks:TransformSelection'],
    ['chunks:Collection', 'out:Collection'],
    ['mesh:Materials', 'out:Materials'],
  ],
  collection: thresholds(400000, 60000, 8000),
});

export const stoneColumn = defineFracture({
  nodes: {
    mesh: { type: 'FStaticMeshToCollectionDataflowNode_v2', model: './destruction/stone-column.glb' },
    bounds: { type: 'FBoundingBoxDataflowNode' },
    sites: { type: 'FClusterScatterPointsDataflowNode', params: { NumberClustersMin: 4, NumberClustersMax: 6, PointsPerClusterMin: 3, PointsPerClusterMax: 8, ClusterRadiusFractionMin: 0.1, ClusterRadiusFractionMax: 0.25, RandomSeed: 9 } },
    fracture: { type: 'FVoronoiFractureDataflowNode_v2', params: { RandomSeed: 9 } },
    out: { type: 'FGeometryCollectionTerminalDataflowNode_v2' },
  },
  edges: [
    ['mesh:Collection', 'bounds:Collection'],
    ['bounds:BoundingBox', 'sites:BoundingBox'],
    ['mesh:Collection', 'fracture:Collection'],
    ['sites:Points', 'fracture:Points'],
    ['fracture:Collection', 'out:Collection'],
    ['mesh:Materials', 'out:Materials'],
  ],
  collection: thresholds(250000, 20000),
});
