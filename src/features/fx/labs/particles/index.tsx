import * as UE from 'ue';
import { $ref } from 'puerts';
import { useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { NiagaraSystem, useFrame, useHudMessages, useHudState } from '../../../../shared/react';
import { burst, meshes, ribbon, sparks } from '../../assets/effects';

const TINTS: Record<string, readonly [number, number, number, number]> = {
  ember: [1, 0.45, 0.12, 1],
  ice: [0.25, 0.6, 1, 1],
  toxic: [0.4, 1, 0.2, 1],
};

const RIBBON_CENTRE = [0, 450, 150] as const;
const RIBBON_RADIUS = 150;
const RIBBON_TURNS_PER_SECOND = 0.4;
const ignoredHit = $ref(new UE.HitResult());

export function Scene() {
  const [rate, setRate] = useState(2000);
  const [tint, setTint] = useState('ember');
  const ribbonActor = useRef<UE.NiagaraActor | null>(null);
  const angle = useRef(0);

  useHudMessages((message) => {
    if (message.type === 'particles/rate') setRate(Number(message.rate));
    if (message.type === 'particles/tint' && String(message.tint) in TINTS) setTint(String(message.tint));
  });
  useHudState('particles/state', () => ({ rate, tint, tints: Object.keys(TINTS) }));

  useFrame((deltaSeconds) => {
    angle.current = (angle.current + deltaSeconds * RIBBON_TURNS_PER_SECOND * Math.PI * 2) % (Math.PI * 2);
    const at = new UE.Vector(RIBBON_CENTRE[0] + Math.cos(angle.current) * RIBBON_RADIUS, RIBBON_CENTRE[1] + Math.sin(angle.current) * RIBBON_RADIUS, RIBBON_CENTRE[2]);
    ribbonActor.current?.K2_SetActorLocation(at, false, ignoredHit, false);
  });

  return (
    <>
      <LabStage sunPitch={-12} />
      <NiagaraSystem system={sparks} at={[0, -450, 0]} params={{ Rate: rate, Tint: TINTS[tint] }} />
      <NiagaraSystem system={burst} at={[0, -150, 150]} />
      <NiagaraSystem system={ribbon} at={[...RIBBON_CENTRE]} actorRef={ribbonActor} />
      <NiagaraSystem system={meshes} at={[200, 150, 0]} />
    </>
  );
}
