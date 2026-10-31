import { LabStage } from '../lab-stage/LabStage';
import { Player } from '../../features/character/entities/Player';
import { Coast } from '../../features/world/entities/Coast';
import { coast } from '../../features/world/assets/coast';
import { coastHeight, LAGOON } from '../../features/world/assets/coastShape';
import { eveningClouds } from '../../features/world/assets/sky';
import { Clouds, Terrain } from '../../shared/react';

const START: [number, number] = [LAGOON.x, LAGOON.y + LAGOON.radiusY + 1800];

export function Scene() {
  return (
    <>
      <LabStage ground={false} camera={null} sunPitch={-38} sunYaw={60} fogDensity={0.004} />
      <Clouds material={eveningClouds} />
      <Terrain terrain={coast}>
        <Coast />
        <Player at={[START[0], START[1], coastHeight(START[0], START[1]) + 200]} />
      </Terrain>
    </>
  );
}
