import * as UE from 'ue';
import { useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { colored } from '../../../../shared/engine/world';
import { useHudMessages, useHudState, Vehicle, type VehicleState } from '../../../../shared/react';
import type { Vector3 } from '../../../../shared/react/props';
import { car } from '../../assets/car.vehicle';

const CUBE = '/Engine/BasicShapes/Cube.Cube';
const CYLINDER = '/Engine/BasicShapes/Cylinder.Cylinder';
const RAMPS: { at: Vector3; pitch: number; length: number }[] = [
  { at: [2500, 0, 60], pitch: 12, length: 1000 },
  { at: [7000, 0, 120], pitch: 18, length: 900 },
];
const BUMPS = Array.from({ length: 10 }, (_, index) => [4200 + index * 260, 0, -12] as Vector3);

export function Scene() {
  const state = useRef<VehicleState>({ speedKmh: 0, gear: 0, rpm: 0, suspension: [] });
  const [cruise, setCruise] = useState(0);
  const [round, setRound] = useState(0);
  const [steer, setSteer] = useState(0);
  useHudMessages((message) => {
    if (message.type === 'vehicle/cruise') setCruise(Number(message.value));
    if (message.type === 'vehicle/steer') setSteer(Number(message.value));
    if (message.type === 'vehicle/reset') {
      setCruise(0);
      setSteer(0);
      setRound((value) => value + 1);
    }
  });
  useHudState('vehicle/state', () => ({ cruise, steer, speedKmh: Math.round(state.current.speedKmh), gear: state.current.gear, rpm: Math.round(state.current.rpm), suspension: state.current.suspension.map((value) => +value.toFixed(2)) }));

  return (
    <>
      <LabStage camera={null} groundSize={2000} />
      {RAMPS.map(({ at, pitch, length }, index) => (
        <staticMeshComponent key={`ramp${index}`} location={at} rotation={[pitch, 0, 0]} scale={[length / 100, 8, 0.4]} staticMesh={CUBE} overrideMaterials={[colored([0.5, 0.45, 0.38])]} />
      ))}
      {BUMPS.map((at, index) => (
        <staticMeshComponent key={`bump${index}`} location={at} rotation={[0, 0, 90]} scale={[0.4, 0.4, 8]} staticMesh={CYLINDER} overrideMaterials={[colored([0.3, 0.3, 0.32])]} />
      ))}
      <Vehicle key={round} vehicle={car} at={[0, 0, 80]} driven cruise={cruise} steer={steer} onState={(next) => (state.current = next)} />
    </>
  );
}
