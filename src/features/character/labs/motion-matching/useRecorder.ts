import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { $ref } from 'puerts';
import { useFrame } from '../../../../shared/react';
import { situationOf } from '../../entities/motionSituation';
import { CAPSULE_HALF_HEIGHT, SCENARIO, START, linkedInstance, pawnOf, type Mode } from './lab';
import { ViolationLog, drawPath, drawPose, measurePose, parseMotion, type Pose, type Sample } from './probe';

const PATH_FRAMES = 240;
const RECORD_SECONDS = 60;

interface Recording {
  t: number;
  scripted: boolean;
  samples: Sample[];
  path: UE.Vector[];
}

function sampleOf(pawn: UE.Character, instance: UE.AnimInstance, { t, step, pose }: { t: number; step: string; pose: Pose }): Sample {
  const velocity = pawn.CharacterMovement.Velocity;
  return {
    t: +t.toFixed(3),
    step,
    situation: situationOf(pawn) ?? '',
    speed: Math.round(Math.hypot(velocity.X, velocity.Y)),
    ...parseMotion(UE.VgeScriptLibrary.DescribeMotionMatching(instance)),
    pose,
  };
}

export function useRecorder(mode: Mode) {
  const recording = useRef<Recording>({ t: 0, scripted: false, samples: [], path: [] });
  const log = useRef(new ViolationLog());
  const current = useRef<Sample | undefined>(undefined);

  const restart = (scripted: boolean) => {
    if (scripted) pawnOf()?.K2_SetActorLocationAndRotation(new UE.Vector(...START), new UE.Rotator(0, 0, 0), false, $ref(new UE.HitResult()), true);
    recording.current = { t: 0, scripted, samples: [], path: [] };
    log.current.clear();
    current.current = undefined;
  };

  useEffect(() => restart(recording.current.scripted && mode === 'scenario'), [mode]);

  useFrame((dt) => {
    const pawn = pawnOf();
    const state = recording.current;
    const instance = pawn && linkedInstance(pawn);
    if (!pawn || !instance || mode === 'clip') return;
    state.t += dt;
    const step = state.scripted ? SCENARIO.find((s) => state.t < s.until) : undefined;
    if (state.scripted && !step) state.scripted = false;
    if (step?.input) pawn.AddMovementInput(new UE.Vector(step.direction[0], step.direction[1], 0), step.input, false);
    const ground = pawn.K2_GetActorLocation().Z - CAPSULE_HALF_HEIGHT - pawn.CharacterMovement.CurrentFloor.FloorDist;
    const pose = measurePose(pawn.Mesh, { ground, velocity: pawn.CharacterMovement.Velocity, anchor: pawn.K2_GetActorLocation() }, current.current?.pose, dt);
    const sample = sampleOf(pawn, instance, { t: state.t, step: step?.name ?? mode, pose });
    current.current = sample;
    if (mode === 'drive' || step) {
      state.samples.push(sample);
      if (pawn.CharacterMovement.IsMovingOnGround()) log.current.add(sample);
      while (state.samples.length && state.t - state.samples[0].t > RECORD_SECONDS) state.samples.shift();
    }
    state.path.push(pawn.K2_GetActorLocation());
    if (state.path.length > PATH_FRAMES) state.path.shift();
    drawPath(state.path);
    drawPose(pose);
  });

  return { recording, log, current, restart };
}

export type Recorder = ReturnType<typeof useRecorder>;
