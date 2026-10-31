import * as UE from 'ue';
import { lakeWater } from '../assets/water.material';
import { LAKE } from '../assets/valleyShape';

const PLANE = '/Engine/BasicShapes/Plane.Plane';
const PLANE_SIZE = 100;

export function Lake() {
  const width = (LAKE.radius * 2 * 1.4 * 1.1) / PLANE_SIZE;
  const depth = (LAKE.radius * 2 * 1.1) / PLANE_SIZE;
  return <staticMeshComponent location={[LAKE.x, LAKE.y, LAKE.level]} scale={[width, depth, 1]} staticMesh={PLANE} overrideMaterials={[lakeWater]} collisionEnabled={UE.ECollisionEnabled.NoCollision} />;
}
