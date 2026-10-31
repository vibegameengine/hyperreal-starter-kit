import { LabStage } from '../lab-stage/LabStage';
import { Player } from '../../features/character/entities/Player';
import { GroundTextures } from '../../features/world/entities/GroundTextures';
import { Lake } from '../../features/world/entities/Lake';
import { Nature } from '../../features/world/entities/Nature';
import { eveningClouds } from '../../features/world/assets/sky.material';
import { valley } from '../../features/world/assets/valley.terrain';
import { frameRateLimit, setFrameRateLimit } from '../../shared/engine/display';
import { Clouds, Terrain, useHudMessages, useHudState, useSmoothedFps } from '../../shared/react';

export function Scene() {
  const fps = useSmoothedFps();

  useHudMessages((message) => {
    if (message.type === 'world/frameRateLimit') setFrameRateLimit(Number(message.limit));
  });
  useHudState('world/state', () => ({ fps: Math.round(fps.current), frameRateLimit: frameRateLimit() }));

  return (
    <>
      <LabStage ground={false} camera={null} sunPitch={-38} sunYaw={200} fogDensity={0.004} />
      <Clouds material={eveningClouds} />
      <Terrain terrain={valley}>
        <GroundTextures />
        <Nature />
        <Lake />
        <Player at={[0, 0, 600]} />
      </Terrain>
    </>
  );
}
