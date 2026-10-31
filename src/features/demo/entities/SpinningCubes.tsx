import * as UE from 'ue';
import { useRef } from 'react';
import { colored } from '../../../shared/engine/world';
import { defineEditable, useFrame } from '../../../shared/react';
import type { Vector3 } from '../../../shared/react/props';

export interface SpinningCubesProps {
  at: Vector3;
  count?: number;
  degreesPerSecond?: number;
}

const CUBE = '/Engine/BasicShapes/Cube.Cube';

export function SpinningCubes({ at, count = 5, degreesPerSecond = 90 }: SpinningCubesProps) {
  const cubes = useRef<(UE.StaticMeshActor | null)[]>([]);
  const yaw = useRef(0);
  useFrame((deltaSeconds) => {
    yaw.current = (yaw.current + degreesPerSecond * deltaSeconds) % 360;
    cubes.current.forEach((cube, i) => cube?.K2_SetActorRotation(new UE.Rotator(0, yaw.current + i * 15, 0), false));
  });
  const material = colored([0.9, 0.25, 0.1]);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <staticMeshActor
          key={i}
          ref={(actor) => {
            cubes.current[i] = actor;
          }}
          location={[at[0], at[1] + (i - (count - 1) / 2) * 180, at[2]]}
          staticMeshComponent={{ mobility: UE.EComponentMobility.Movable, staticMesh: CUBE, overrideMaterials: [material] }}
        />
      ))}
    </>
  );
}

defineEditable({
  component: SpinningCubes,
  title: 'Spinning cubes',
  argTypes: {
    count: { control: { type: 'range', min: 1, max: 10, step: 1 }, description: 'How many cubes stand in the row' },
    degreesPerSecond: { name: 'Spin', control: { type: 'range', min: -360, max: 360, step: 5 }, description: 'Turn rate of every cube, degrees per second' },
  },
});
