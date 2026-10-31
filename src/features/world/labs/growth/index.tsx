import { useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { Player } from '../../../character/entities/Player';
import { eveningClouds } from '../../assets/sky';
import { valley } from '../../assets/valley';
import { GroundTextures } from '../../entities/GroundTextures';
import { Lake } from '../../entities/Lake';
import { Nature } from '../../entities/Nature';
import { Growth } from '../../growth/Growth';
import { Clouds, Terrain, useHudMessages } from '../../../../shared/react';
import { routeStart, Walk } from './Walk';

export function Scene() {
  const [run, setRun] = useState(0);
  useHudMessages((message) => {
    if (message.type === 'growth/restart') setRun((count) => count + 1);
  });

  return (
    <>
      <LabStage ground={false} camera={null} sunPitch={-38} sunYaw={200} fogDensity={0.004} />
      <Clouds material={eveningClouds} />
      <Terrain terrain={valley}>
        <GroundTextures />
        <Lake />
        <Growth key={run}>
          <Nature />
          <Player at={routeStart} />
          <Walk />
        </Growth>
      </Terrain>
    </>
  );
}
