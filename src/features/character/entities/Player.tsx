import * as UE from 'ue';
import { $ref, $unref, type $Ref } from 'puerts';
import { useEffect, useMemo, useRef, type ComponentType, type ReactNode, type RefObject } from 'react';
import { world } from '../../../shared/engine/world';
import { isGameInputHeld } from '../../../shared/engine/gameInput';
import { isMouseCaptured } from '../../../shared/engine/mouse';
import { param, useFrame, useMotionMatchingClass, useMouseCapture } from '../../../shared/react';
import type { MotionMatchingRef } from '../../../shared/motion';
import type { Vector3 } from '../../../shared/react/props';
import { MANNEQUIN_MESHES, type MannequinVariant } from './mannequin';
import { GroundedLegs, type GroundedSkeleton } from './GroundedLegs';
import { setRunning, useMotionSituation, type MotionSituations } from './motionSituation';
import { MannequinLocomotion, setLocomotion, type LayerWeights, type LocomotionClips } from './MannequinLocomotion';
import { LivePosture, type PostureSource } from '../posture/Posture';
import { aimOf, aimPosture, stepAim } from './aim';
import { stepGlider } from './gliderRide';
import { stepClimb, tryStartClimb, type ClimbClip } from './climb';

function useClimbClip(look: PlayerLook | undefined, pelvis: string): ClimbClip | undefined {
  return useMemo(() => {
    const clip = look?.clips.climb ? (UE.Object.Load(look.clips.climb) as UE.AnimSequenceBase | undefined) : undefined;
    const mesh = typeof look?.mesh === 'string' ? (UE.Object.Load(look.mesh) as UE.SkeletalMesh | undefined) : look?.mesh;
    return clip && mesh ? { clip, mesh, pelvis } : undefined;
  }, [look?.clips.climb, look?.mesh, pelvis]);
}

const LAYER_BLEND_SECONDS = 0.25;
const approach = (from: number, to: number, deltaSeconds: number) => (to > from ? Math.min(to, from + deltaSeconds / LAYER_BLEND_SECONDS) : Math.max(to, from - deltaSeconds / LAYER_BLEND_SECONDS));
import { JointNoise, type NoisyJoint } from '../posture/JointNoise';

const CAPSULE_HALF_HEIGHT = 88;
const CAMERA_START_PITCH = -18;

export interface PlayerCamera {
  distance: number;
  height: number;
  shoulder: number;
  lagSpeed: number;
  rotationLagSpeed: number;
  fieldOfView: number;
}

export const ORBIT_CAMERA: PlayerCamera = { distance: 560, height: 90, shoulder: 0, lagSpeed: 0, rotationLagSpeed: 0, fieldOfView: 90 };

export interface PlayerPace {
  walkSpeed: number;
  runSpeed: number;
  maxAcceleration: number;
  brakingDeceleration: number;
  turnDegreesPerSecond: number;
}
const PITCH_RANGE = [-70, 20] as const;
const MOUSE_DEGREES_PER_UNIT = 0.4;
const STICK_DEGREES_PER_SECOND = 140;
const STICK_DEADZONE = 0.15;
const KEYS = {
  forward: new UE.Key('W'), back: new UE.Key('S'), left: new UE.Key('A'), right: new UE.Key('D'), jump: new UE.Key('SpaceBar'),
  padJump: new UE.Key('Gamepad_FaceButton_Bottom'), run: new UE.Key('LeftShift'), padRun: new UE.Key('Gamepad_LeftThumbstick'),
  moveX: new UE.Key('Gamepad_LeftX'), moveY: new UE.Key('Gamepad_LeftY'), lookX: new UE.Key('Gamepad_RightX'), lookY: new UE.Key('Gamepad_RightY'),
};

const stick = (controller: UE.PlayerController, key: UE.Key) => {
  const value = controller.GetInputAnalogKeyState(key);
  return Math.abs(value) < STICK_DEADZONE ? 0 : value;
};
const pressed = (controller: UE.PlayerController, key: UE.Key) => (controller.IsInputKeyDown(key) ? 1 : 0);

const BLEND_SPACE_RUN_SPEED = 450;
const MOTION_MATCHING_JOG_SPEED = 343;
const MOTION_MATCHING_DYNAMICS = { maxAcceleration: 700, brakingDecelerationWalking: 800, groundFriction: 4.5, useSeparateBrakingFriction: true, brakingFriction: 0 };

export interface SecondaryMotionProps {
  body: RefObject<UE.SkeletalMeshComponent | null>;
  children: ReactNode;
}

export interface PlayerLook {
  mesh: string | UE.SkeletalMesh;
  clips: LocomotionClips;
  secondary?: ComponentType<SecondaryMotionProps>;
  posture?: PostureSource;
  jointNoise?: readonly NoisyJoint[];
  springDamping?: number;
  aimSpine?: readonly string[];
}

const MANNY_SPINE = ['spine_01', 'spine_02', 'spine_03'];

export interface PlayerProps {
  at: Vector3;
  variant?: MannequinVariant;
  look?: PlayerLook;
  motion?: MotionMatchingRef;
  situations?: MotionSituations;
  legs?: boolean | GroundedSkeleton;
  camera?: PlayerCamera;
  pace?: PlayerPace;
  cameraRig?: ReactNode;
  drive?: PlayerDrive;
}

export interface PlayerInput {
  x: number;
  y: number;
  run: boolean;
  jumping: boolean;
}

export interface PlayerView {
  yaw: number;
  pitch: number;
}

export type PlayerDrive = (view: PlayerView) => PlayerInput | undefined;

interface MouseDelta {
  x: $Ref<number>;
  y: $Ref<number>;
}

function readInput(controller: UE.PlayerController, view: PlayerView, deltaSeconds: number, mouse: MouseDelta): PlayerInput {
  let turnX = stick(controller, KEYS.lookX) * STICK_DEGREES_PER_SECOND * deltaSeconds;
  let turnY = stick(controller, KEYS.lookY) * STICK_DEGREES_PER_SECOND * deltaSeconds;
  if (isMouseCaptured()) {
    controller.GetInputMouseDelta(mouse.x, mouse.y);
    turnX += $unref(mouse.x) * MOUSE_DEGREES_PER_UNIT;
    turnY += $unref(mouse.y) * MOUSE_DEGREES_PER_UNIT;
  }
  view.yaw = (view.yaw + turnX) % 360;
  view.pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], view.pitch + turnY));
  return {
    x: Math.max(-1, Math.min(1, pressed(controller, KEYS.forward) - pressed(controller, KEYS.back) + stick(controller, KEYS.moveY))),
    y: Math.max(-1, Math.min(1, pressed(controller, KEYS.right) - pressed(controller, KEYS.left) + stick(controller, KEYS.moveX))),
    run: controller.IsInputKeyDown(KEYS.run) || controller.IsInputKeyDown(KEYS.padRun),
    jumping: controller.IsInputKeyDown(KEYS.jump) || controller.IsInputKeyDown(KEYS.padJump),
  };
}

function useBodyOf(character: RefObject<UE.Character | null>): RefObject<UE.SkeletalMeshComponent | null> {
  return useMemo(() => ({ get current() { return character.current?.Mesh ?? null; } }), [character]);
}

function movementOf(motion: MotionMatchingRef | undefined, pace: PlayerPace | undefined) {
  if (motion) return { maxWalkSpeed: MOTION_MATCHING_JOG_SPEED, ...MOTION_MATCHING_DYNAMICS };
  if (!pace) return { maxWalkSpeed: BLEND_SPACE_RUN_SPEED };
  return { maxWalkSpeed: pace.walkSpeed, maxAcceleration: pace.maxAcceleration, brakingDecelerationWalking: pace.brakingDeceleration, rotationRate: [0, pace.turnDegreesPerSecond, 0] as Vector3 };
}

function finishPose(pose: ReactNode, posture: PostureSource | undefined, Secondary: ComponentType<SecondaryMotionProps> | undefined, body: RefObject<UE.SkeletalMeshComponent | null>) {
  const shaped = posture ? <LivePosture source={posture}>{pose}</LivePosture> : pose;
  return Secondary ? <Secondary body={body}>{shaped}</Secondary> : shaped;
}

function motionPose(motionClass: string, legs: boolean | GroundedSkeleton, jointNoise: readonly NoisyJoint[] | undefined, run: string | undefined) {
  const matched = <linkedGraph instanceClass={motionClass} />;
  const running = run ? (
    <blend alpha={param('runWeight')}>
      {matched}
      <clip sequence={run} />
    </blend>
  ) : matched;
  const alive = jointNoise?.length ? <JointNoise joints={jointNoise}>{running}</JointNoise> : running;
  return legs ? <GroundedLegs skeleton={legs === true ? undefined : legs}>{alive}</GroundedLegs> : alive;
}

function linkedGraphOf(animation: UE.VgeAnimInstance | null) {
  const id = animation && /linkedGraph#(\d+)/.exec(animation.DescribeGraph())?.[1];
  return id ? animation.GetLinkedInstance(id) : undefined;
}

export function Player({ at, variant = 'manny', look, motion, situations, legs = true, camera = ORBIT_CAMERA, pace, cameraRig, drive }: PlayerProps) {
  const character = useRef<UE.Character>(null);
  const body = useBodyOf(character);
  const Secondary = look?.secondary;
  const animation = useRef<UE.VgeAnimInstance>(null);
  const motionClass = useMotionMatchingClass(motion);
  const heading = useRef({ yaw: 0, pitch: CAMERA_START_PITCH });
  const posture = useMemo(() => aimPosture(look?.posture, { spine: look?.aimSpine ?? MANNY_SPINE, view: () => heading.current, pawn: () => character.current }), [look?.posture, look?.aimSpine]);
  useMotionSituation(character, () => linkedGraphOf(animation.current), motion ? situations : undefined);
  useEffect(() => {
    UE.GameplayStatics.GetPlayerController(world, 0).Possess(character.current!);
  }, []);

  useMouseCapture();
  const layers = useRef<LayerWeights>({ run: 0, aim: 0, ride: 0, climbing: false });
  const climbSource = useClimbClip(look, typeof legs === 'object' ? legs.pelvis : 'pelvis');
  const mouse = { x: $ref(0), y: $ref(0) };
  useFrame((deltaSeconds) => {
    const pawn = character.current;
    if (!pawn) return;
    const controller = UE.GameplayStatics.GetPlayerController(world, 0);
    if (!controller) return;
    if (isGameInputHeld()) {
      setLocomotion(animation.current, pawn.CharacterMovement);
      return;
    }

    const view = heading.current;
    const { x, y, run, jumping } = drive?.(view) ?? readInput(controller, view, deltaSeconds, mouse);
    const yaw = (view.yaw * Math.PI) / 180;
    const forward = new UE.Vector(Math.cos(yaw), Math.sin(yaw), 0);
    const right = new UE.Vector(-Math.sin(yaw), Math.cos(yaw), 0);
    const riding = stepGlider({ pawn, controller, throttle: x, strafe: y, viewYaw: view.yaw, deltaSeconds });
    const climbing = stepClimb(pawn, deltaSeconds) || (!riding && jumping && !!climbSource && tryStartClimb(pawn, climbSource));
    const busy = riding || climbing;
    if (x && !busy) pawn.AddMovementInput(forward, x, false);
    if (y && !busy) pawn.AddMovementInput(right, y, false);
    if (!busy && jumping) pawn.Jump();
    if (motion) setRunning(pawn, run);
    else if (pace) pawn.CharacterMovement.MaxWalkSpeed = run ? pace.runSpeed : pace.walkSpeed;
    layers.current = { run: approach(layers.current.run, run && !riding && (x || y) ? 1 : 0, deltaSeconds), aim: aimOf(pawn).blend, ride: approach(layers.current.ride, riding ? 1 : 0, deltaSeconds), climbing };

    stepAim({ pawn, controller, view, rest: camera, deltaSeconds });
    controller.SetControlRotation(new UE.Rotator(view.pitch, view.yaw, 0));

    setLocomotion(animation.current, pawn.CharacterMovement, layers.current);
  });

  return (
    <>
      <character
        ref={character}
        location={at}
        useControllerRotationYaw={false}
        mesh={{ skeletalMeshAsset: look?.mesh ?? MANNEQUIN_MESHES[variant], location: [0, 0, -CAPSULE_HALF_HEIGHT], rotation: [0, -90, 0] }}
        characterMovement={{ orientRotationToMovement: true, rotationRate: [0, 720, 0], jumpZVelocity: 520, ...movementOf(motion, pace) }}
      >
        <MannequinLocomotion
          graph={animation}
          clips={look?.clips && { ...look.clips, run: motionClass ? undefined : look.clips.run }}
          ground={motionClass && motionPose(motionClass, legs, look?.jointNoise, look?.clips.run)}
          finish={(pose) => finishPose(pose, posture, Secondary, body)}
          springDamping={look?.springDamping}
        />
        <springArmComponent
          location={[0, 0, camera.height]}
          targetArmLength={camera.distance}
          socketOffset={[0, camera.shoulder, 0]}
          enableCameraLag={camera.lagSpeed > 0}
          cameraLagSpeed={camera.lagSpeed}
          enableCameraRotationLag={camera.rotationLagSpeed > 0}
          cameraRotationLagSpeed={camera.rotationLagSpeed}
          usePawnControlRotation
          doCollisionTest={false}
        >
          <cameraComponent socket="SpringEndpoint" constrainAspectRatio={false} fieldOfView={camera.fieldOfView} />
          {cameraRig}
        </springArmComponent>
      </character>
    </>
  );
}
