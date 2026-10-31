import * as UE from 'ue';
import { useState } from 'react';
import { LabStage } from '../lab-stage/LabStage';
import { Player } from '../../features/character/entities/Player';
import { flightCase, LiveAsset, SpinningCubes } from '../../features/demo';
import { BoxPyramid, Colonnade, SphereRain, Stairs } from '../../features/world';
import { frameRateLimit, setFrameRateLimit, setVSync, vsync } from '../../shared/engine/display';
import { useHudMessages, useHudState, useSmoothedFps } from '../../shared/react';

const DEFAULT_SUN_PITCH = -35;

const qualityLevel = () => UE.GameUserSettings.GetGameUserSettings().GetOverallScalabilityLevel();
function setQualityLevel(level: number) {
  const settings = UE.GameUserSettings.GetGameUserSettings();
  settings.SetOverallScalabilityLevel(level);
  settings.ApplyNonResolutionSettings();
}

export function Scene() {
  const [sunPitch, setSunPitch] = useState(DEFAULT_SUN_PITCH);
  const [raining, setRaining] = useState(false);
  const fps = useSmoothedFps();

  useHudMessages((message) => {
    if (message.type === 'main/sun') setSunPitch(Number(message.pitch));
    if (message.type === 'main/rain') setRaining(Boolean(message.on));
    if (message.type === 'main/quality') setQualityLevel(Number(message.level));
    if (message.type === 'main/frameRateLimit') setFrameRateLimit(Number(message.limit));
    if (message.type === 'main/vsync') setVSync(Boolean(message.on));
  });

  useHudState('main/state', () => ({ fps: Math.round(fps.current), sunPitch, raining, quality: qualityLevel(), frameRateLimit: frameRateLimit(), vsync: vsync() }));

  return (
    <>
      <LabStage groundSize={40} camera={null} sunPitch={sunPitch} />
      <Player at={[-300, 0, 100]} />
      <Colonnade at={[0, 0, 0]} radius={900} columns={20} />
      <Stairs at={[-150, 400, 0]} steps={12} />
      <BoxPyramid at={[350, -250, 0]} rows={5} />
      <SpinningCubes at={[350, 350, 100]} count={3} />
      <LiveAsset asset={flightCase} at={[-260.08, -260.19, 114.84]} turnDegreesPerSecond={27.4} />
      {raining && <SphereRain at={[0, 0, 0]} area={700} everyMs={250} max={40} />}
    </>
  );
}
