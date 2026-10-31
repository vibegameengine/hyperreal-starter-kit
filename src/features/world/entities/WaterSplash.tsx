import * as UE from 'ue';
import { $ref } from 'puerts';
import { useRef } from 'react';
import { world } from '../../../shared/engine/world';
import { NiagaraSystem, useFrame } from '../../../shared/react';
import { coastHeight, SEA_LEVEL } from '../assets/coastShape';
import { waterSplash } from '../assets/ocean/splash.niagara';

const DROPS_PER_METRE = 220;
const MAX_RATE = 1600;
const FULL_DEPTH_CM = 35;
const THROW_RISE = 0.7;
const MAX_LEG_SPEED = 3;
const THROW_BASE = 45;
const THROW_PER_SPEED = 55;
const ignoredHit = $ref(new UE.HitResult());

interface LegSplash {
  previous?: UE.Vector;
}

function splashLeg(actor: UE.NiagaraActor | null, mesh: UE.SkeletalMeshComponent, socket: string, state: LegSplash, dt: number) {
  const component = actor?.NiagaraComponent;
  const at = mesh.GetSocketLocation(socket);
  const previous = state.previous;
  state.previous = at;
  if (!actor || !component || !previous || dt <= 0) return;
  const depth = SEA_LEVEL - coastHeight(at.X, at.Y);
  const immersed = Math.min(1, Math.max(0, depth / FULL_DEPTH_CM));
  const vx = (at.X - previous.X) / dt;
  const vy = (at.Y - previous.Y) / dt;
  const speed = Math.min(MAX_LEG_SPEED, Math.hypot(vx, vy) / 100);
  actor.K2_SetActorLocation(new UE.Vector(at.X, at.Y, SEA_LEVEL + 2), false, ignoredHit, true);
  component.SetVariableFloat('Rate', Math.min(MAX_RATE, speed * DROPS_PER_METRE * immersed));
  const length = Math.hypot(vx, vy) || 1;
  component.SetVariableVec3('Throw', new UE.Vector(vx / length, vy / length, THROW_RISE));
  component.SetVariableFloat('Speed', THROW_BASE + speed * THROW_PER_SPEED);
}

export function WaterSplash() {
  const left = useRef<UE.NiagaraActor | null>(null);
  const right = useRef<UE.NiagaraActor | null>(null);
  const legs = useRef<[LegSplash, LegSplash]>([{}, {}]);
  useFrame((dt) => {
    const pawn = UE.GameplayStatics.GetPlayerCharacter(world, 0);
    if (!pawn?.Mesh) return;
    splashLeg(left.current, pawn.Mesh, 'ball_l', legs.current[0], dt);
    splashLeg(right.current, pawn.Mesh, 'ball_r', legs.current[1], dt);
  });
  return (
    <>
      <NiagaraSystem system={waterSplash} at={[0, 0, 0]} actorRef={left} />
      <NiagaraSystem system={waterSplash} at={[0, 0, 0]} actorRef={right} />
    </>
  );
}
