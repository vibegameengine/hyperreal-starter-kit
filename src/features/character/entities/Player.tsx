import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useMemo, useRef, type ComponentType, type ReactNode, type RefObject } from 'react';
import { world } from '../../../shared/engine/world';
import { isGameInputHeld } from '../../../shared/engine/gameInput';
import { isMouseCaptured } from '../../../shared/engine/mouse';
import { useFrame, useMotionMatchingClass, useMouseCapture } from '../../../shared/react';
import type { MotionMatchingRef } from '../../../shared/motion';
import type { Vector3 } from '../../../shared/react/props';
import { MANNEQUIN_MESHES, type MannequinVariant } from './mannequin';
import { GroundedLegs, type GroundedSkeleton } from './GroundedLegs';
import { useMotionSituation, type MotionSituations } from './motionSituation';
import { MannequinLocomotion, setLocomotion, type LocomotionClips } from './MannequinLocomotion';
import { LivePosture, type PostureSource } from '../posture/Posture';

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
}

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

function linkedGraphOf(animation: UE.VgeAnimInstance | null) {
  const id = animation && /linkedGraph#(\d+)/.exec(animation.DescribeGraph())?.[1];
  return id ? animation.GetLinkedInstance(id) : undefined;
}

export function Player({ at, variant = 'manny', look, motion, situations, legs = true, camera = ORBIT_CAMERA, pace, cameraRig }: PlayerProps) {
  const character = useRef<UE.Character>(null);
  const body = useBodyOf(character);
  const Secondary = look?.secondary;
  const animation = useRef<UE.VgeAnimInstance>(null);
  const motionClass = useMotionMatchingClass(motion);
  useMotionSituation(character, () => linkedGraphOf(animation.current), motion ? situations : undefined);
  useEffect(() => {
    UE.GameplayStatics.GetPlayerController(world, 0).Possess(character.current!);
  }, []);

  useMouseCapture();
  const heading = useRef({ yaw: 0, pitch: CAMERA_START_PITCH });
  const mouseX = $ref(0);
  const mouseY = $ref(0);
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
    let turnX = stick(controller, KEYS.lookX) * STICK_DEGREES_PER_SECOND * deltaSeconds;
    let turnY = stick(controller, KEYS.lookY) * STICK_DEGREES_PER_SECOND * deltaSeconds;
    if (isMouseCaptured()) {
      controller.GetInputMouseDelta(mouseX, mouseY);
      turnX += $unref(mouseX) * MOUSE_DEGREES_PER_UNIT;
      turnY += $unref(mouseY) * MOUSE_DEGREES_PER_UNIT;
    }
    view.yaw = (view.yaw + turnX) % 360;
    view.pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], view.pitch + turnY));

    const yaw = (view.yaw * Math.PI) / 180;
    const forward = new UE.Vector(Math.cos(yaw), Math.sin(yaw), 0);
    const right = new UE.Vector(-Math.sin(yaw), Math.cos(yaw), 0);
    const x = Math.max(-1, Math.min(1, pressed(controller, KEYS.forward) - pressed(controller, KEYS.back) + stick(controller, KEYS.moveY)));
    const y = Math.max(-1, Math.min(1, pressed(controller, KEYS.right) - pressed(controller, KEYS.left) + stick(controller, KEYS.moveX)));
    if (x) pawn.AddMovementInput(forward, x, false);
    if (y) pawn.AddMovementInput(right, y, false);
    if (controller.IsInputKeyDown(KEYS.jump) || controller.IsInputKeyDown(KEYS.padJump)) pawn.Jump();
    if (pace && !motion) pawn.CharacterMovement.MaxWalkSpeed = controller.IsInputKeyDown(KEYS.run) || controller.IsInputKeyDown(KEYS.padRun) ? pace.runSpeed : pace.walkSpeed;

    controller.SetControlRotation(new UE.Rotator(view.pitch, view.yaw, 0));

    setLocomotion(animation.current, pawn.CharacterMovement);
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
          clips={look?.clips}
          ground={motionClass && (legs ? <GroundedLegs skeleton={legs === true ? undefined : legs}><linkedGraph instanceClass={motionClass} /></GroundedLegs> : <linkedGraph instanceClass={motionClass} />)}
          finish={(Secondary || look?.posture) && ((pose) => finishPose(pose, look?.posture, Secondary, body))}
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
