import * as UE from 'ue';
import { useRef } from 'react';
import { useFrame, useMotionMatchingDatabases } from '../../../shared/react';
import type { MotionMatchingRef } from '../../../shared/motion';
import { stopExitDue, trackStop, type StopExit } from './stopExit';

export type Situation = 'idle' | 'starting' | 'moving' | 'stopping' | 'pivoting';
export type Gait = 'walk' | 'jog';
export type SituationDatabases = Partial<Record<Situation | `${Situation}:${Gait}`, MotionMatchingRef>>;
export interface MotionSituations {
  databases: SituationDatabases;
  speeds: Record<Gait, number>;
  braking: Record<Gait, number>;
  acceleration?: Record<Gait, number>;
  jogFromInput: number;
  speedScale?: number;
  stopShortOfEnd?: readonly [number, number];
}

function usePlayRateScale(linked: () => UE.AnimInstance | undefined, motion: MotionSituations | undefined) {
  const applied = useRef<{ instance?: UE.AnimInstance; playRate?: number }>({});
  useFrame(() => {
    const instance = linked();
    const playRate = motion?.speedScale;
    if (!instance || playRate === undefined || (applied.current.instance === instance && applied.current.playRate === playRate)) return;
    if (UE.VgeScriptLibrary.SetAnimNodeFields(instance, 'AnimNode_MotionMatching', JSON.stringify({ PlayRate: { Min: playRate, Max: playRate } })) > 0) applied.current = { instance, playRate };
  });
}

const STOP_SPEED = 10;
const FUTURE_SECONDS = 0.45;
const START_GAIN = 100;
const PIVOT_DEGREES = 45;

const situations = new WeakMap<UE.Character, Situation>();
const coreOf = (situation: Situation, gait: Gait) => `${situation === 'idle' || situation === 'stopping' ? 'idle' : 'moving'}:${gait}`;
const keys = new WeakMap<UE.Character, string>();
export const situationOf = (pawn: UE.Character) => keys.get(pawn);

const gaits = new WeakMap<UE.Character, Gait>();
const running = new WeakSet<UE.Character>();

export function setRunning(pawn: UE.Character, run: boolean) {
  if (run) running.add(pawn);
  else running.delete(pawn);
}

function gaitOf(pawn: UE.Character, { speeds, braking, acceleration, jogFromInput }: MotionSituations): Gait {
  const movement = pawn.CharacterMovement;
  const input = movement.GetLastInputVector();
  const strength = Math.min(1, Math.hypot(input.X, input.Y));
  const previous = gaits.get(pawn) ?? 'walk';
  if (strength < 0.01) return previous;
  const gait: Gait = running.has(pawn) || strength >= jogFromInput ? 'jog' : 'walk';
  movement.MaxWalkSpeed = speeds[gait] / strength;
  movement.BrakingDecelerationWalking = braking[gait];
  if (acceleration) movement.MaxAcceleration = acceleration[gait];
  gaits.set(pawn, gait);
  return gait;
}

function futureVelocity(movement: UE.CharacterMovementComponent) {
  const velocity = movement.Velocity;
  const input = movement.GetCurrentAcceleration();
  if (Math.hypot(input.X, input.Y) < 1) {
    const speed = Math.hypot(velocity.X, velocity.Y);
    const scale = speed > 0 ? Math.max(0, speed - movement.BrakingDecelerationWalking * FUTURE_SECONDS) / speed : 0;
    return [velocity.X * scale, velocity.Y * scale];
  }
  const ahead = [velocity.X + input.X * FUTURE_SECONDS, velocity.Y + input.Y * FUTURE_SECONDS];
  const speed = Math.hypot(ahead[0], ahead[1]);
  const limit = movement.MaxWalkSpeed * movement.GetAnalogInputModifier();
  return speed > limit ? ahead.map((axis) => (axis * limit) / speed) : ahead;
}

export function situationFrom(movement: UE.CharacterMovementComponent, current: Situation | undefined): Situation {
  const velocity = movement.Velocity;
  const speed = Math.hypot(velocity.X, velocity.Y);
  const input = movement.GetCurrentAcceleration();
  const pushing = Math.hypot(input.X, input.Y) >= 1;
  if (!pushing) return speed < STOP_SPEED ? 'idle' : 'stopping';
  const future = futureVelocity(movement);
  const futureSpeed = Math.hypot(future[0], future[1]);
  if (speed > STOP_SPEED && futureSpeed > STOP_SPEED) {
    const turn = Math.abs(Math.atan2(velocity.X * future[1] - velocity.Y * future[0], velocity.X * future[0] + velocity.Y * future[1]));
    if ((turn * 180) / Math.PI >= PIVOT_DEGREES) return 'pivoting';
  }
  if (futureSpeed >= speed + START_GAIN && current !== 'pivoting') return 'starting';
  return 'moving';
}

export function useMotionSituation(character: { current: UE.Character | null }, linked: () => UE.AnimInstance | undefined, motion: MotionSituations | undefined) {
  const loaded = useMotionMatchingDatabases(motion?.databases);
  usePlayRateScale(linked, motion);
  const applied = useRef<{ instance?: UE.AnimInstance; database?: UE.PoseSearchDatabase; core?: string }>({});
  const stop = useRef<StopExit>({ done: false });
  useFrame(() => {
    const pawn = character.current;
    if (!pawn || !motion) return;
    const situation = situationFrom(pawn.CharacterMovement, situations.get(pawn));
    situations.set(pawn, situation);
    trackStop(stop.current, situation, motion.stopShortOfEnd);
    const gait = gaitOf(pawn, motion);
    const shown: Situation = stop.current.done && situation === 'stopping' ? 'idle' : situation;
    const key = `${shown}:${gait}` as const;
    keys.set(pawn, key);
    const database = loaded[key] ?? loaded[shown] ?? loaded['moving:walk'] ?? loaded.moving;
    const instance = linked();
    if (!database || !instance) return;
    const core = coreOf(shown, gait);
    const settling = situation === 'idle' || situation === 'stopping';
    if (settling && stopExitDue(stop.current, instance, loaded[`stopping:${gait}`] ?? loaded.stopping)) {
      const idle = loaded[`idle:${gait}`] ?? loaded.idle ?? database;
      stop.current.done = UE.VgeScriptLibrary.SetMotionMatchingDatabase(instance, idle, UE.EPoseSearchInterruptMode.ForceInterrupt);
      if (stop.current.done) applied.current = { instance, database: idle, core: coreOf('idle', gait) };
      return;
    }
    if (applied.current.instance === instance && applied.current.database === database) return;
    const interrupt = applied.current.instance === instance && applied.current.core === core ? UE.EPoseSearchInterruptMode.DoNotInterrupt : UE.EPoseSearchInterruptMode.InterruptOnDatabaseChange;
    if (UE.VgeScriptLibrary.SetMotionMatchingDatabase(instance, database, interrupt)) applied.current = { instance, database, core };
  });
}
