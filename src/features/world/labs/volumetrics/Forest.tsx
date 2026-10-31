import { useMemo } from 'react';
import treeTallModel from '../../assets/nature/tree-tall.glb';
import treeModel from '../../assets/nature/tree.glb';
import { TREE_SLOTS, useTextured } from '../../entities/Nature';

const TREE_COUNT = 44;
const INNER_RADIUS = 1100;
const OUTER_RADIUS = 2800;

function ring() {
  let state = 7;
  const next = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  return Array.from({ length: TREE_COUNT }, (_, index) => {
    const angle = (index / TREE_COUNT) * Math.PI * 2 + next() * 0.3;
    const radius = INNER_RADIUS + next() * (OUTER_RADIUS - INNER_RADIUS);
    return { location: [Math.cos(angle) * radius, Math.sin(angle) * radius, -10] as const, yaw: next() * 360, scale: 0.9 + next() * 0.5, tall: next() < 0.5 };
  });
}

export function Forest() {
  const tree = useTextured(treeModel, TREE_SLOTS);
  const treeTall = useTextured(treeTallModel, TREE_SLOTS);
  const placements = useMemo(ring, []);
  return (
    <>
      {placements.map((p, index) => {
        const { mesh, materials } = p.tall && treeTall.mesh ? treeTall : tree;
        if (!mesh) return null;
        return <staticMeshComponent key={index} location={p.location} rotation={[0, p.yaw, 0]} scale={[p.scale, p.scale, p.scale]} staticMesh={mesh} overrideMaterials={materials} />;
      })}
    </>
  );
}
