import * as UE from 'ue';
import { useRef, useState } from 'react';
import { colored } from '../../../../shared/engine/world';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { NiagaraSystem, useHudMessages, useHudState } from '../../../../shared/react';
import { sandstorm } from '../../assets/sandstorm';
import { SANDSTORM_DENSITY, SANDSTORM_WIND } from '../../assets/sandstormDefaults';

const RESOLUTIONS = [96, 128, 192, 256];
const PILLAR = '/Engine/BasicShapes/Cylinder.Cylinder';
const stone = colored([0.42, 0.33, 0.24]);
const [WIND_X, WIND_Y, WIND_Z] = SANDSTORM_WIND;
const WIND_SPEED = Math.hypot(WIND_X, WIND_Y, WIND_Z);

export function Scene() {
  const storm = useRef<UE.NiagaraActor | null>(null);
  const [resolution, setResolution] = useState(192);
  const [wind, setWind] = useState(WIND_SPEED);
  const [density, setDensity] = useState(SANDSTORM_DENSITY);

  useHudMessages((message) => {
    const component = storm.current?.NiagaraComponent;
    if (message.type === 'sandstorm/resolution' && component) {
      const cells = Number(message.cells);
      component.SetVariableInt('ResolutionMaxAxis', cells);
      component.ReinitializeSystem();
      setResolution(cells);
    }
    if (message.type === 'sandstorm/wind' && component) {
      const speed = Number(message.speed);
      const scale = speed / WIND_SPEED;
      component.SetVariableVec3('Wind', new UE.Vector(WIND_X * scale, WIND_Y * scale, WIND_Z * scale));
      setWind(speed);
    }
    if (message.type === 'sandstorm/density' && component) {
      const value = Number(message.density);
      component.SetVariableFloat('Density', value);
      setDensity(value);
    }
    if (message.type === 'sandstorm/restart') component?.ReinitializeSystem();
  });
  useHudState('sandstorm/state', () => ({ resolution, resolutions: RESOLUTIONS, wind, density }));

  return (
    <>
      <LabStage sunPitch={-22} sunYaw={20} groundSize={80} camera={{ location: [-1200, -2400, 380], rotation: [-6, 62, 0] }} />
      <NiagaraSystem system={sandstorm} at={[0, 0, 0]} actorRef={storm} />
      <staticMeshActor location={[0, 0, 250]} scale={[4, 4, 5]} staticMeshComponent={{ mobility: UE.EComponentMobility.Movable, staticMesh: PILLAR, overrideMaterials: [stone] }} />
    </>
  );
}
