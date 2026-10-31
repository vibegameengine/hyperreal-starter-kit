import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { world } from '../../../shared/engine/world';

export interface GliderTuning {
  hoverHeight: number;
  acceleration: number;
  maxSpeed: number;
  drag: number;
  turnDegreesPerSecond: number;
  bankDegrees: number;
  hoverStiffness: number;
  hoverDamping: number;
  mountReach: number;
}

export const SCOOTER: GliderTuning = { hoverHeight: 70, acceleration: 1400, maxSpeed: 2400, drag: 0.8, turnDegreesPerSecond: 110, bankDegrees: 22, hoverStiffness: 60, hoverDamping: 12, mountReach: 260 };

interface Ride {
  glider: UE.Actor;
  velocity: UE.Vector;
  verticalSpeed: number;
  bank: number;
}

const gliders = new Set<UE.Actor>();
const rides = new WeakMap<UE.Character, Ride>();
const mountHeld = new WeakSet<UE.Character>();

export const registerGlider = (glider: UE.Actor) => {
  gliders.add(glider);
  return () => {
    gliders.delete(glider);
  };
};
export const isRiding = (pawn: UE.Character) => rides.has(pawn);

const MOUNT_KEYS = [new UE.Key('E'), new UE.Key('Gamepad_FaceButton_Top')];
const PROBE_CM = 1000;

function groundBelow(pawn: UE.Character, from: UE.Vector, ignore: UE.Actor) {
  const hit = $ref(new UE.HitResult());
  const ignored = UE.NewArray(UE.Actor);
  ignored.Add(pawn);
  ignored.Add(ignore);
  const to = new UE.Vector(from.X, from.Y, from.Z - PROBE_CM);
  return UE.KismetSystemLibrary.LineTraceSingle(world, from, to, UE.ETraceTypeQuery.TraceTypeQuery1, false, ignored, UE.EDrawDebugTrace.None, hit, true, UE.LinearColor.Red, UE.LinearColor.Green, 0) ? $unref(hit).ImpactPoint.Z : undefined;
}

function nearestGlider(pawn: UE.Character, reach: number) {
  const at = pawn.K2_GetActorLocation();
  let best: UE.Actor | undefined;
  let bestDistance = reach;
  for (const glider of gliders) {
    const distance = UE.Vector.Dist(at, glider.K2_GetActorLocation());
    if (distance < bestDistance) [best, bestDistance] = [glider, distance];
  }
  return best;
}

function toggleMount(pawn: UE.Character, tuning: GliderTuning) {
  const ride = rides.get(pawn);
  if (ride) {
    rides.delete(pawn);
    pawn.CharacterMovement.SetMovementMode(UE.EMovementMode.MOVE_Falling, 0);
    return;
  }
  const glider = nearestGlider(pawn, tuning.mountReach);
  if (!glider) return;
  rides.set(pawn, { glider, velocity: new UE.Vector(0, 0, 0), verticalSpeed: 0, bank: 0 });
  pawn.CharacterMovement.SetMovementMode(UE.EMovementMode.MOVE_Flying, 0);
}

export interface GliderInput {
  pawn: UE.Character;
  controller: UE.PlayerController;
  throttle: number;
  strafe: number;
  viewYaw: number;
  deltaSeconds: number;
}

function steer(pawn: UE.Character, ride: Ride, { throttle, strafe, viewYaw, deltaSeconds }: GliderInput, tuning: GliderTuning) {
  const yaw = pawn.K2_GetActorRotation().Yaw;
  const delta = ((viewYaw - yaw + 540) % 360) - 180;
  const turn = Math.sign(delta) * Math.min(Math.abs(delta), tuning.turnDegreesPerSecond * deltaSeconds);
  const heading = yaw + turn;
  const radians = (heading * Math.PI) / 180;
  const forward = new UE.Vector(Math.cos(radians), Math.sin(radians), 0);
  const right = new UE.Vector(-Math.sin(radians), Math.cos(radians), 0);
  const push = tuning.acceleration * deltaSeconds;
  const damped = Math.max(0, 1 - tuning.drag * deltaSeconds);
  let velocity = new UE.Vector((ride.velocity.X + (forward.X * throttle + right.X * strafe * 0.5) * push) * damped, (ride.velocity.Y + (forward.Y * throttle + right.Y * strafe * 0.5) * push) * damped, 0);
  const speed = Math.hypot(velocity.X, velocity.Y);
  if (speed > tuning.maxSpeed) velocity = new UE.Vector((velocity.X * tuning.maxSpeed) / speed, (velocity.Y * tuning.maxSpeed) / speed, 0);
  const targetBank = (-turn / Math.max(1e-6, tuning.turnDegreesPerSecond * deltaSeconds)) * tuning.bankDegrees * Math.min(1, speed / 600);
  return { heading, velocity, bank: ride.bank + (targetBank - ride.bank) * Math.min(1, 6 * deltaSeconds) };
}

function hover(pawn: UE.Character, ride: Ride, tuning: GliderTuning, deltaSeconds: number) {
  const at = pawn.K2_GetActorLocation();
  const halfHeight = pawn.CapsuleComponent.GetScaledCapsuleHalfHeight();
  const ground = groundBelow(pawn, at, ride.glider);
  const target = ground === undefined ? at.Z : ground + tuning.hoverHeight + halfHeight;
  const accel = (target - at.Z) * tuning.hoverStiffness - ride.verticalSpeed * tuning.hoverDamping;
  return ride.verticalSpeed + accel * deltaSeconds;
}

export function stepGlider(input: GliderInput, tuning: GliderTuning = SCOOTER): boolean {
  const { pawn, controller, deltaSeconds } = input;
  const pressed = MOUNT_KEYS.some((key) => controller.IsInputKeyDown(key));
  if (pressed && !mountHeld.has(pawn)) toggleMount(pawn, tuning);
  if (pressed) mountHeld.add(pawn);
  else mountHeld.delete(pawn);
  const ride = rides.get(pawn);
  if (!ride) return false;
  const { heading, velocity, bank } = steer(pawn, ride, input, tuning);
  const verticalSpeed = hover(pawn, ride, tuning, deltaSeconds);
  const at = pawn.K2_GetActorLocation();
  const next = new UE.Vector(at.X + velocity.X * deltaSeconds, at.Y + velocity.Y * deltaSeconds, at.Z + verticalSpeed * deltaSeconds);
  pawn.K2_SetActorLocation(next, true, $ref(new UE.HitResult()), false);
  pawn.K2_SetActorRotation(new UE.Rotator(0, heading, 0), false);
  pawn.CharacterMovement.Velocity = new UE.Vector(velocity.X, velocity.Y, verticalSpeed);
  const feet = pawn.CapsuleComponent.GetScaledCapsuleHalfHeight();
  ride.glider.K2_SetActorLocationAndRotation(new UE.Vector(next.X, next.Y, next.Z - feet), new UE.Rotator(0, heading, bank), false, $ref(new UE.HitResult()), true);
  rides.set(pawn, { ...ride, velocity, verticalSpeed, bank });
  return true;
}
