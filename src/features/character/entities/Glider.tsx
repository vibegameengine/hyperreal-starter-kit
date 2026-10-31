import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import type { Vector3 } from '../../../shared/react/props';
import { registerGlider } from './gliderRide';

const BOARD = '/Engine/BasicShapes/Cube.Cube';
const BOARD_SCALE: Vector3 = [1.6, 0.7, 0.12];

export interface GliderProps {
  at: Vector3;
  yaw?: number;
}

export function Glider({ at, yaw = 0 }: GliderProps) {
  const actor = useRef<UE.StaticMeshActor>(null);
  useEffect(() => (actor.current ? registerGlider(actor.current) : undefined), []);
  return (
    <staticMeshActor
      ref={actor}
      location={at}
      rotation={[0, yaw, 0]}
      scale={BOARD_SCALE}
      staticMeshComponent={{ staticMesh: BOARD, mobility: UE.EComponentMobility.Movable, collisionEnabled: UE.ECollisionEnabled.NoCollision }}
    />
  );
}
