import * as UE from 'ue';
import { useEffect, useMemo, useRef } from 'react';
import { colored } from '../../../shared/engine/world';
import type { Vector3 } from '../../../shared/react/props';

const CUBE = '/Engine/BasicShapes/Cube.Cube';
const SIZE = 80;
const PONTOON_RADIUS = 40;
const BUOYANCY_COEFFICIENT = 0.8;

function crateBuoyancy() {
  const data = new UE.BuoyancyData();
  const pontoons = UE.NewArray(UE.SphericalPontoon);
  const offset = SIZE / 2 - PONTOON_RADIUS / 2;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      const pontoon = new UE.SphericalPontoon();
      pontoon.RelativeLocation = new UE.Vector(x * offset, y * offset, 0);
      pontoon.Radius = PONTOON_RADIUS;
      pontoons.Add(pontoon);
    }
  }
  data.Pontoons = pontoons;
  data.BuoyancyCoefficient = BUOYANCY_COEFFICIENT;
  data.bApplyDragForcesInWater = true;
  return data;
}

export function Crates({ at }: { at: readonly Vector3[] }) {
  const buoyancy = useMemo(crateBuoyancy, []);
  const crates = useRef<(UE.StaticMeshActor | null)[]>([]);
  useEffect(() => {
    for (const crate of crates.current) {
      crate?.StaticMeshComponent.SetCollisionProfileName('PhysicsActor', true);
      crate?.StaticMeshComponent.SetSimulatePhysics(true);
    }
  }, [at]);
  return (
    <>
      {at.map((location, index) => (
        <staticMeshActor
          key={index}
          ref={(crate: UE.StaticMeshActor | null) => {
            crates.current[index] = crate;
          }}
          location={location}
          rotation={[0, index * 37, 0]}
          scale={SIZE / 100}
          staticMeshComponent={{ staticMesh: CUBE, mobility: UE.EComponentMobility.Movable, overrideMaterials: [colored([0.45, 0.3, 0.16])] }}
        >
          <buoyancyComponent buoyancyData={buoyancy} />
        </staticMeshActor>
      ))}
    </>
  );
}
