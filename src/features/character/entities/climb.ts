import * as UE from 'ue';
import { $ref } from 'puerts';
import { chooseAction, findLedge, rootPathOf, warpedLocation, type RootPath, type WarpedMove } from './traversal';

export interface ClimbClip {
  clip: UE.AnimSequenceBase;
  mesh: UE.SkeletalMesh;
  pelvis: string;
}

interface Climb {
  move: WarpedMove;
  time: number;
}

const INWARD_CM = 35;
const climbs = new WeakMap<UE.Character, Climb>();
const paths = new WeakMap<UE.AnimSequenceBase, RootPath>();
export const isClimbing = (pawn: UE.Character) => climbs.has(pawn);

function pathOf({ clip, mesh, pelvis }: ClimbClip) {
  const known = paths.get(clip);
  if (known) return known;
  const path = rootPathOf(clip, mesh, pelvis);
  paths.set(clip, path);
  return path;
}

export function tryStartClimb(pawn: UE.Character, source: ClimbClip): boolean {
  if (climbs.has(pawn) || pawn.CharacterMovement.IsFalling()) return false;
  const ledge = findLedge(pawn);
  const action = chooseAction(ledge);
  if (!ledge || !action || action.kind === 'vault') return false;
  const halfHeight = pawn.CapsuleComponent.GetScaledCapsuleHalfHeight();
  const inward = new UE.Vector(-ledge.normal.X, -ledge.normal.Y, 0);
  const end = new UE.Vector(ledge.top.X + inward.X * INWARD_CM, ledge.top.Y + inward.Y * INWARD_CM, ledge.top.Z + halfHeight);
  const yaw = (Math.atan2(inward.Y, inward.X) * 180) / Math.PI;
  climbs.set(pawn, { move: { start: pawn.K2_GetActorLocation(), end, yaw, path: pathOf(source) }, time: 0 });
  pawn.CharacterMovement.SetMovementMode(UE.EMovementMode.MOVE_Flying, 0);
  pawn.CharacterMovement.Velocity = new UE.Vector(0, 0, 0);
  pawn.K2_SetActorRotation(new UE.Rotator(0, yaw, 0), false);
  return true;
}

export function stepClimb(pawn: UE.Character, deltaSeconds: number): boolean {
  const climb = climbs.get(pawn);
  if (!climb) return false;
  const time = climb.time + deltaSeconds;
  pawn.K2_SetActorLocation(warpedLocation(climb.move, time), false, $ref(new UE.HitResult()), true);
  pawn.CharacterMovement.Velocity = new UE.Vector(0, 0, 0);
  if (time >= climb.move.path.length) {
    climbs.delete(pawn);
    pawn.CharacterMovement.SetMovementMode(UE.EMovementMode.MOVE_Walking, 0);
    return false;
  }
  climbs.set(pawn, { ...climb, time });
  return true;
}
