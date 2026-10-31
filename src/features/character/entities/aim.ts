import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { world } from '../../../shared/engine/world';
import type { BoneTurn, PostureSource } from '../posture/Posture';

export interface AimCamera {
  distance: number;
  shoulder: number;
  fieldOfView: number;
}

export interface AimView {
  yaw: number;
  pitch: number;
}

export const AIM_CAMERA: AimCamera = { distance: 150, shoulder: 55, fieldOfView: 60 };

const AIM_BLEND_SECONDS = 0.15;
const TURN_DEGREES_PER_SECOND = 900;
const FIRE_INTERVAL_SECONDS = 0.15;
const RECOIL_PITCH_DEGREES = 1.2;
const RECOIL_YAW_DEGREES = 0.4;
const SHOT_RANGE_CM = 20000;
const SHOT_IMPULSE = 60000;
const TRIGGER_PRESSED = 0.3;

const KEYS = {
  aim: new UE.Key('RightMouseButton'),
  padAim: new UE.Key('Gamepad_LeftTriggerAxis'),
  fire: new UE.Key('LeftMouseButton'),
  padFire: new UE.Key('Gamepad_RightTriggerAxis'),
};

export interface AimState {
  blend: number;
  cooldown: number;
  shots: number;
}

const states = new WeakMap<UE.Character, AimState>();
export const aimOf = (pawn: UE.Character): AimState => states.get(pawn) ?? { blend: 0, cooldown: 0, shots: 0 };

const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;
const held = (controller: UE.PlayerController, key: UE.Key, axis: UE.Key) => controller.IsInputKeyDown(key) || controller.GetInputAnalogKeyState(axis) > TRIGGER_PRESSED;

function frameCamera(pawn: UE.Character, blend: number, rest: AimCamera) {
  const arm = pawn.GetComponentByClass(UE.SpringArmComponent.StaticClass()) as UE.SpringArmComponent | undefined;
  const camera = pawn.GetComponentByClass(UE.CameraComponent.StaticClass()) as UE.CameraComponent | undefined;
  if (arm) {
    arm.TargetArmLength = lerp(rest.distance, AIM_CAMERA.distance, blend);
    arm.SocketOffset = new UE.Vector(0, lerp(rest.shoulder, AIM_CAMERA.shoulder, blend), 0);
  }
  camera?.SetFieldOfView(lerp(rest.fieldOfView, AIM_CAMERA.fieldOfView, blend));
  return camera;
}

function faceView(pawn: UE.Character, view: AimView, deltaSeconds: number) {
  const now = pawn.K2_GetActorRotation();
  const delta = ((view.yaw - now.Yaw + 540) % 360) - 180;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), TURN_DEGREES_PER_SECOND * deltaSeconds);
  pawn.K2_SetActorRotation(new UE.Rotator(0, now.Yaw + step, 0), false);
}

function shoot(pawn: UE.Character, camera: UE.CameraComponent) {
  const from = camera.K2_GetComponentLocation();
  const direction = camera.GetForwardVector();
  const to = new UE.Vector(from.X + direction.X * SHOT_RANGE_CM, from.Y + direction.Y * SHOT_RANGE_CM, from.Z + direction.Z * SHOT_RANGE_CM);
  const hit = $ref(new UE.HitResult());
  const ignored = UE.NewArray(UE.Actor);
  ignored.Add(pawn);
  if (!UE.KismetSystemLibrary.LineTraceSingle(world, from, to, UE.ETraceTypeQuery.TraceTypeQuery1, false, ignored, UE.EDrawDebugTrace.ForDuration, hit, true, UE.LinearColor.Red, UE.LinearColor.Green, 0.5)) return;
  const result = $unref(hit);
  const target = result.Component as UE.PrimitiveComponent | undefined;
  if (target?.IsSimulatingPhysics()) target.AddImpulseAtLocation(new UE.Vector(direction.X * SHOT_IMPULSE, direction.Y * SHOT_IMPULSE, direction.Z * SHOT_IMPULSE), result.ImpactPoint, 'None');
}

export interface AimStep {
  pawn: UE.Character;
  controller: UE.PlayerController;
  view: AimView;
  rest: AimCamera;
  deltaSeconds: number;
}

export function stepAim({ pawn, controller, view, rest, deltaSeconds }: AimStep): AimState {
  const previous = aimOf(pawn);
  const aiming = held(controller, KEYS.aim, KEYS.padAim);
  const blend = Math.min(1, Math.max(0, previous.blend + (aiming ? 1 : -1) * (deltaSeconds / AIM_BLEND_SECONDS)));
  const camera = frameCamera(pawn, blend, rest);
  pawn.CharacterMovement.bOrientRotationToMovement = !aiming;
  if (aiming) faceView(pawn, view, deltaSeconds);
  let cooldown = Math.max(0, previous.cooldown - deltaSeconds);
  let shots = previous.shots;
  if (aiming && camera && cooldown === 0 && held(controller, KEYS.fire, KEYS.padFire)) {
    shoot(pawn, camera);
    view.pitch -= RECOIL_PITCH_DEGREES;
    view.yaw += (Math.random() * 2 - 1) * RECOIL_YAW_DEGREES;
    cooldown = FIRE_INTERVAL_SECONDS;
    shots += 1;
  }
  const state = { blend, cooldown, shots };
  states.set(pawn, state);
  return state;
}

export interface AimPostureOptions {
  spine: readonly string[];
  view: () => AimView | undefined;
  pawn: () => UE.Character | null | undefined;
}

export function aimPosture(base: PostureSource | undefined, { spine, view, pawn }: AimPostureOptions): PostureSource {
  return {
    at(deltaSeconds) {
      const turns: BoneTurn[] = [...(base?.at(deltaSeconds) ?? [])];
      const character = pawn();
      const looking = view();
      const share = character && looking && spine.length ? (looking.pitch * aimOf(character).blend) / spine.length : 0;
      return [...turns, ...spine.map((bone) => ({ bone, roll: share }))];
    },
  };
}
