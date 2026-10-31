import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useRef } from 'react';
import { world } from '../../../shared/engine/world';
import { isMouseCaptured } from '../../../shared/engine/mouse';
import { useFrame, useMotionMatchingClass, useMouseCapture } from '../../../shared/react';
import type { MotionMatchingRef } from '../../../shared/motion';
import type { Vector3 } from '../../../shared/react/props';
import { MANNEQUIN_MESHES, type MannequinVariant } from './mannequin';
import { GroundedLegs } from './GroundedLegs';
import { MannequinLocomotion, setLocomotion, type LocomotionClips } from './MannequinLocomotion';

const CAPSULE_HALF_HEIGHT = 88;
const CAMERA_DISTANCE = 560;
const CAMERA_TARGET_HEIGHT = 90;
const CAMERA_START_PITCH = -18;
const PITCH_RANGE = [-70, 20] as const;
const MOUSE_DEGREES_PER_UNIT = 0.4;
const STICK_DEGREES_PER_SECOND = 140;
const STICK_DEADZONE = 0.15;
const KEYS = {
  forward: new UE.Key('W'), back: new UE.Key('S'), left: new UE.Key('A'), right: new UE.Key('D'), jump: new UE.Key('SpaceBar'),
  padJump: new UE.Key('Gamepad_FaceButton_Bottom'),
  moveX: new UE.Key('Gamepad_LeftX'), moveY: new UE.Key('Gamepad_LeftY'), lookX: new UE.Key('Gamepad_RightX'), lookY: new UE.Key('Gamepad_RightY'),
};

const stick = (controller: UE.PlayerController, key: UE.Key) => {
  const value = controller.GetInputAnalogKeyState(key);
  return Math.abs(value) < STICK_DEADZONE ? 0 : value;
};
const pressed = (controller: UE.PlayerController, key: UE.Key) => (controller.IsInputKeyDown(key) ? 1 : 0);

const BLEND_SPACE_RUN_SPEED = 450;
const MOTION_MATCHING_JOG_SPEED = 570;

export interface PlayerLook {
  mesh: string | UE.SkeletalMesh;
  clips: LocomotionClips;
}

export interface PlayerProps {
  at: Vector3;
  variant?: MannequinVariant;
  look?: PlayerLook;
  motion?: MotionMatchingRef;
}

export function Player({ at, variant = 'manny', look, motion }: PlayerProps) {
  const character = useRef<UE.Character>(null);
  const animation = useRef<UE.VgeAnimInstance>(null);
  const motionClass = useMotionMatchingClass(motion);
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
        characterMovement={{ orientRotationToMovement: true, rotationRate: [0, 720, 0], jumpZVelocity: 520, maxWalkSpeed: motion ? MOTION_MATCHING_JOG_SPEED : BLEND_SPACE_RUN_SPEED }}
      >
        <MannequinLocomotion graph={animation} clips={look?.clips} ground={motionClass && (
            <GroundedLegs>
              <linkedGraph instanceClass={motionClass} />
            </GroundedLegs>
          )} />
        <springArmComponent location={[0, 0, CAMERA_TARGET_HEIGHT]} targetArmLength={CAMERA_DISTANCE} usePawnControlRotation doCollisionTest={false}>
          <cameraComponent socket="SpringEndpoint" constrainAspectRatio={false} />
        </springArmComponent>
      </character>
    </>
  );
}
