import * as UE from 'ue';
import type { BoneSample, MotionFrame, Quat, Vec3 } from '../systems/motionChecks';
import { linkedAnimInstance } from './motionClip';
import { situationOf } from './motionSituation';

const vector = (value: UE.Vector): Vec3 => [value.X, value.Y, value.Z];
const quat = (value: UE.Quat): Quat => [value.X, value.Y, value.Z, value.W];

function matchedClip(pawn: UE.Character) {
  const instance = linkedAnimInstance(pawn);
  const [clip = 'graph', time = '0'] = instance ? UE.VgeScriptLibrary.DescribeMotionMatching(instance).split('|') : [];
  return { clip, clipTime: Number(time) || 0 };
}

export function sampleMotion(pawn: UE.Character, bones: readonly string[], time: number, deltaSeconds: number): MotionFrame {
  const mesh = pawn.Mesh;
  const sampled: Record<string, BoneSample> = {};
  for (const bone of bones) {
    const local = mesh.GetSocketTransform(bone, UE.ERelativeTransformSpace.RTS_ParentBoneSpace);
    const body = mesh.GetSocketTransform(bone, UE.ERelativeTransformSpace.RTS_Component);
    sampled[bone] = { local: quat(local.GetRotation()), body: vector(body.GetLocation()), world: vector(mesh.GetSocketLocation(bone)) };
  }
  const velocity = pawn.CharacterMovement.Velocity;
  return { time, deltaSeconds, ...matchedClip(pawn), situation: situationOf(pawn) ?? '', speed: Math.hypot(velocity.X, velocity.Y), yaw: pawn.K2_GetActorRotation().Yaw, bones: sampled };
}
