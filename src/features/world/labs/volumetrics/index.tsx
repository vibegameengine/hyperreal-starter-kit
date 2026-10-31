import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { world } from '../../../../shared/engine/world';
import { instance } from '../../../../shared/material';
import { Clouds, useFrame, useHudMessages, useHudState } from '../../../../shared/react';
import { eveningClouds } from '../../assets/sky';
import smoke from '../../assets/smoke';
import { Forest } from './Forest';

const QUALITY = ['low', 'medium', 'high', 'epic', 'cinematic'] as const;
type Quality = (typeof QUALITY)[number];

const consoleCommand = (command: string) => UE.KismetSystemLibrary.ExecuteConsoleCommand(world, command, UE.GameplayStatics.GetPlayerController(world, 0));
const consoleInt = (name: string) => UE.KismetSystemLibrary.GetConsoleVariableIntValue(name);

function useFrameCost() {
  const cost = useRef({ gpu: 0, game: 0 });
  useFrame(() => {
    const times = UE.VgeScriptLibrary.FrameTimes();
    const blend = (old: number, now: number) => (old ? old * 0.95 + now * 0.05 : now);
    cost.current = { gpu: blend(cost.current.gpu, times.GpuMs), game: blend(cost.current.game, times.GameMs) };
  });
  return cost;
}

export function Scene() {
  const [cover, setCover] = useState(0);
  const [bottom, setBottom] = useState(1.5);
  const [height, setHeight] = useState(4);
  const [fog, setFog] = useState(0.25);
  const [smokeDensity, setSmokeDensity] = useState(0.15);
  const [sunPitch, setSunPitch] = useState(-18);
  const [quality, setQuality] = useState<Quality>('epic');
  const cost = useFrameCost();

  useEffect(() => consoleCommand(`scalability ${QUALITY.indexOf(quality)}`), [quality]);
  useEffect(() => () => consoleCommand(`scalability ${QUALITY.indexOf('epic')}`), []);
  useHudMessages((message) => {
    const value = Number(message.value);
    if (message.type === 'volumetrics/cover') setCover(value);
    if (message.type === 'volumetrics/bottom') setBottom(value);
    if (message.type === 'volumetrics/height') setHeight(value);
    if (message.type === 'volumetrics/fog') setFog(value);
    if (message.type === 'volumetrics/smoke') setSmokeDensity(value);
    if (message.type === 'volumetrics/sun') setSunPitch(value);
    if (message.type === 'volumetrics/quality' && QUALITY.includes(message.value as Quality)) setQuality(message.value as Quality);
  });
  useHudState('volumetrics/state', () => ({
    cover,
    bottom,
    height,
    fog,
    smoke: smokeDensity,
    sunPitch,
    quality,
    volumetricFog: consoleInt('r.VolumetricFog'),
    heterogeneousVolumes: consoleInt('r.HeterogeneousVolumes.Allowed'),
    gpuMs: cost.current.gpu,
    gameMs: cost.current.game,
  }));

  return (
    <>
      <LabStage groundSize={80} sunPitch={sunPitch} sunYaw={180} fogDensity={0.01} volumetricFog cloudShadows camera={{ location: [-900, -700, 170], rotation: [14, 30, 0] }} />
      <Clouds material={instance(eveningClouds, { Cloud_GlobalCoverage: cover })} bottomAltitude={bottom} height={height} />
      <Forest />
      <localFogVolume location={[0, 0, 150]} scale={[5, 5, 2.5]} localFogVolumeVolume={{ radialFogExtinction: fog, heightFogExtinction: fog, heightFogFalloff: 600, fogPhaseG: 0.6 }} />
      <heterogeneousVolume location={[300, 100, 320]} scale={[5, 5, 5]} heterogeneousVolumeComponent={{ pivotAtCentroid: true, overrideMaterials: [instance(smoke, { extinction: smokeDensity })] }} />
    </>
  );
}
