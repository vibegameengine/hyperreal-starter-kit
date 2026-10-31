import * as UE from 'ue';
import { $ref } from 'puerts';
import { useRef } from 'react';
import { world } from '../../../shared/engine/world';
import { NiagaraSystem, useFrame } from '../../../shared/react';
import { coastHeight, SEA_LEVEL, sandiness } from '../assets/coastShape';
import { sandKick } from '../assets/sand/sandKick.niagara';

const GRAINS_PER_CM = 3;
const MAX_RATE = 900;
const DRY_HEIGHT_CM = 40;
const ignoredHit = $ref(new UE.HitResult());

function kickRate(pawn: UE.Character) {
  const at = pawn.K2_GetActorLocation();
  const ground = coastHeight(at.X, at.Y);
  const speed = Math.hypot(pawn.GetVelocity().X, pawn.GetVelocity().Y);
  const dry = ground > SEA_LEVEL + DRY_HEIGHT_CM ? 1 : 0;
  return Math.min(MAX_RATE, speed * GRAINS_PER_CM * dry * Math.min(1, sandiness(at.X, at.Y) * 2));
}

export function SandKick() {
  const actor = useRef<UE.NiagaraActor | null>(null);
  useFrame(() => {
    const pawn = UE.GameplayStatics.GetPlayerCharacter(world, 0);
    const component = actor.current?.NiagaraComponent;
    if (!pawn || !component) return;
    const at = pawn.K2_GetActorLocation();
    const velocity = pawn.GetVelocity();
    const speed = Math.hypot(velocity.X, velocity.Y) || 1;
    actor.current?.K2_SetActorLocation(new UE.Vector(at.X, at.Y, coastHeight(at.X, at.Y) + 4), false, ignoredHit, true);
    component.SetVariableFloat('Rate', kickRate(pawn));
    component.SetVariableVec3('Back', new UE.Vector(-velocity.X / speed, -velocity.Y / speed, 0.7));
  });
  return <NiagaraSystem system={sandKick} at={[0, 0, 0]} actorRef={actor} />;
}
