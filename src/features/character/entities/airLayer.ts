import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useRef, useState } from 'react';
import { world } from '../../../shared/engine/world';
import { landingEnd, landingLayerWeight, landingTimingsOf, landWeightFor, LIGHT_LAND_SPEED, MIN_FALL_SECONDS, REACH_SECONDS, timeToLand, type ClipFrame, type LandingTimings } from './airborne';
import type { GroundedSkeleton } from './GroundedLegs';

export interface AirReading {
  weight: number;
  jumped: boolean;
  reaching: boolean;
}

export const GROUNDED_READING: AirReading = { weight: 0, jumped: false, reaching: false };

export interface AirState extends AirReading {
  phase: 'ground' | 'air' | 'land';
  since: number;
  lastVerticalSpeed: number;
  landEnteredAt?: number;
  landWeight: number;
  landedMoving: boolean;
}

export const GROUNDED_AIR: AirState = { ...GROUNDED_READING, phase: 'ground', since: 0, lastVerticalSpeed: 0, landWeight: 0, landedMoving: false };

const JUMPED_SPEED = 100;
const SAMPLE_SECONDS = 1 / 60;
const PROBE_CM = 2000;

function groundBelow(pawn: UE.Character): number | undefined {
  const capsule = pawn.CapsuleComponent;
  const from = pawn.K2_GetActorLocation();
  const bottom = new UE.Vector(from.X, from.Y, from.Z - capsule.GetScaledCapsuleHalfHeight());
  const to = new UE.Vector(bottom.X, bottom.Y, bottom.Z - PROBE_CM);
  const hit = $ref(new UE.HitResult());
  const ignored = UE.NewArray(UE.Actor);
  ignored.Add(pawn);
  const found = UE.KismetSystemLibrary.LineTraceSingle(world, bottom, to, UE.ETraceTypeQuery.TraceTypeQuery1, false, ignored, UE.EDrawDebugTrace.None, hit, true, UE.LinearColor.Red, UE.LinearColor.Green, 0);
  return found ? $unref(hit).Distance : undefined;
}

export interface AirInputs {
  pawn: UE.Character;
  deltaSeconds: number;
  now: number;
  timings: LandingTimings;
  landStart: number;
}

function landedState(state: AirState, movement: UE.CharacterMovementComponent, pushing: boolean, now: number): AirState {
  const velocity = movement.Velocity;
  const impact = -state.lastVerticalSpeed;
  if (state.weight < 0.01) return GROUNDED_AIR;
  const landWeight = impact < LIGHT_LAND_SPEED ? 0 : landWeightFor(impact, Math.hypot(velocity.X, velocity.Y), movement.JumpZVelocity);
  return { ...state, phase: 'land', since: 0, landWeight, landedMoving: pushing, landEnteredAt: state.landEnteredAt ?? now, reaching: false };
}

export function stepAir(state: AirState, { pawn, deltaSeconds, now, timings, landStart }: AirInputs): AirState {
  const movement = pawn.CharacterMovement;
  const falling = movement.IsFalling();
  const verticalSpeed = movement.Velocity.Z;
  const accel = movement.GetCurrentAcceleration();
  const pushing = Math.hypot(accel.X, accel.Y) >= 1;
  if (state.phase !== 'air' && falling) return { ...state, phase: 'air', since: 0, jumped: verticalSpeed > JUMPED_SPEED, reaching: false, landEnteredAt: undefined, lastVerticalSpeed: verticalSpeed };
  if (state.phase === 'air' && !falling) return landedState(state, movement, pushing, now);
  if (state.phase === 'air') {
    const since = state.since + deltaSeconds;
    const shown = state.jumped || since >= MIN_FALL_SECONDS ? 1 : 0;
    const weight = Math.min(shown, state.weight + deltaSeconds / REACH_SECONDS);
    const landsIn = timeToLand(groundBelow(pawn), verticalSpeed, -movement.GetGravityZ());
    const reaching = state.reaching || (weight > 0 && landsIn !== undefined && landsIn <= REACH_SECONDS);
    return { ...state, since, weight, reaching, lastVerticalSpeed: verticalSpeed, landEnteredAt: reaching ? (state.landEnteredAt ?? now) : undefined };
  }
  if (state.phase === 'land') {
    const clipTime = landStart + (now - (state.landEnteredAt ?? now));
    if (clipTime >= landingEnd(state.landWeight, state.landedMoving, timings)) return GROUNDED_AIR;
    return { ...state, since: state.since + deltaSeconds, weight: landingLayerWeight(clipTime, state.landWeight, state.landedMoving, timings) };
  }
  return state;
}

export function landingStartOf(timings: LandingTimings | undefined) {
  return timings ? Math.max(0, timings.touchdown - REACH_SECONDS) : 0;
}

function framesOf(clip: UE.AnimSequenceBase, mesh: UE.SkeletalMesh, skeleton: GroundedSkeleton): ClipFrame[] {
  const bones = [skeleton.pelvis, ...skeleton.legs.flatMap((leg) => [leg.foot, leg.ball])];
  const names = UE.NewArray(UE.BuiltinName);
  bones.forEach((bone) => names.Add(bone));
  const positions = UE.VgeScriptLibrary.SampleClipBones(clip, mesh, names, SAMPLE_SECONDS);
  const count = Math.floor(positions.Num() / bones.length);
  const heights = Array.from({ length: count }, (_, frame) => bones.map((_, bone) => positions.Get(frame * bones.length + bone).Z));
  const rest = bones.map((_, bone) => Math.min(...heights.map((frame) => frame[bone])));
  return heights.map((frame, index) => ({
    time: index * SAMPLE_SECONDS,
    pelvis: frame[0] - Math.min(...frame.slice(1)),
    lift: skeleton.legs.map((_, leg) => Math.min(frame[1 + leg * 2] - rest[1 + leg * 2], frame[2 + leg * 2] - rest[2 + leg * 2])),
  }));
}

export interface AirLayer {
  landStart: number;
  step(pawn: UE.Character, deltaSeconds: number): AirReading;
}

export function useAirLayer(landClip: string | undefined, mesh: string | UE.SkeletalMesh | undefined, skeleton: GroundedSkeleton): AirLayer {
  const timings = useLandingTimings(landClip, mesh, skeleton);
  const state = useRef<AirState>(GROUNDED_AIR);
  const landStart = landingStartOf(timings);
  return {
    landStart,
    step(pawn, deltaSeconds) {
      if (!timings) return { weight: pawn.CharacterMovement.IsFalling() ? 1 : 0, jumped: pawn.CharacterMovement.Velocity.Z > JUMPED_SPEED, reaching: false };
      const shown = state.current.weight;
      const next = stepAir(state.current, { pawn, deltaSeconds, now: UE.KismetSystemLibrary.GetGameTimeInSeconds(world), timings, landStart });
      const step = deltaSeconds / REACH_SECONDS;
      state.current = { ...next, weight: Math.min(shown + step, Math.max(shown - step, next.weight)) };
      return state.current;
    },
  };
}

export function useLandingTimings(landClip: string | undefined, mesh: string | UE.SkeletalMesh | undefined, skeleton: GroundedSkeleton): LandingTimings | undefined {
  const [timings, setTimings] = useState<LandingTimings>();
  const meshKey = mesh === undefined ? '' : typeof mesh === 'string' ? mesh : UE.KismetSystemLibrary.GetPathName(mesh);
  useEffect(() => {
    const clip = landClip ? (UE.Object.Load(landClip) as UE.AnimSequenceBase | undefined) : undefined;
    const skeletal = typeof mesh === 'string' ? (UE.Object.Load(mesh) as UE.SkeletalMesh | undefined) : mesh;
    setTimings(clip && skeletal ? landingTimingsOf(framesOf(clip, skeletal, skeleton)) : undefined);
  }, [landClip, meshKey, skeleton]);
  return timings;
}
