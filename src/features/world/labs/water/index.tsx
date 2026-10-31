import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { Player } from '../../../character/entities/Player';
import { eveningClouds } from '../../assets/sky.material';
import { waterLab } from '../../assets/waterLab.terrain';
import { LAKE_CENTER, WATER_LEVEL } from '../../assets/waterLabShape';
import { Crates } from '../../entities/Crates';
import { GroundTextures } from '../../entities/GroundTextures';
import { Clouds, Terrain } from '../../../../shared/react';

const CRATES = [
  [LAKE_CENTER[0] - 400, LAKE_CENTER[1] + 300, WATER_LEVEL + 150],
  [LAKE_CENTER[0] + 200, LAKE_CENTER[1] - 500, WATER_LEVEL + 250],
  [LAKE_CENTER[0] + 700, LAKE_CENTER[1] + 400, WATER_LEVEL + 200],
  [-4200, -2400, 200],
  [-2700, -1700, 180],
] as const;

export function Scene() {
  return (
    <>
      <LabStage ground={false} camera={null} sunPitch={-35} sunYaw={210} fogDensity={0.004} />
      <Clouds material={eveningClouds} />
      <Terrain terrain={waterLab}>
        <GroundTextures />
        <Crates at={CRATES} />
        <Player at={[-1800, -2200, 300]} />
      </Terrain>
    </>
  );
}
