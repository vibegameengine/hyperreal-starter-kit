import * as UE from 'ue';
import { $ref } from 'puerts';
import { useEffect, useRef } from 'react';
import { useFrame } from '../../../../shared/react';
import { MANNEQUIN_MESHES } from '../../entities/mannequin';
import { MannequinLocomotion, setLocomotion } from '../../entities/MannequinLocomotion';
import { CAPSULE_HALF_HEIGHT, START, pawnOf } from './lab';

const OFFSET = new UE.Vector(0, 250, 0);
const RESYNC_DISTANCE = 300;

export function BlendMirror() {
  const character = useRef<UE.Character>(null);
  const animation = useRef<UE.VgeAnimInstance>(null);
  useEffect(() => {
    character.current?.SpawnDefaultController();
  }, []);

  useFrame(() => {
    const mirror = character.current;
    const player = pawnOf();
    if (!mirror || !player) return;
    const source = player.CharacterMovement;
    const movement = mirror.CharacterMovement;
    movement.MaxWalkSpeed = source.MaxWalkSpeed;
    movement.MaxAcceleration = source.MaxAcceleration;
    movement.BrakingDecelerationWalking = source.BrakingDecelerationWalking;
    movement.GroundFriction = source.GroundFriction;
    movement.bUseSeparateBrakingFriction = source.bUseSeparateBrakingFriction;
    movement.BrakingFriction = source.BrakingFriction;
    const at = player.K2_GetActorLocation();
    const target = new UE.Vector(at.X + OFFSET.X, at.Y + OFFSET.Y, at.Z);
    const here = mirror.K2_GetActorLocation();
    if (Math.hypot(here.X - target.X, here.Y - target.Y) > RESYNC_DISTANCE) mirror.K2_SetActorLocation(target, false, $ref(new UE.HitResult()), true);
    const input = source.GetLastInputVector();
    if (Math.hypot(input.X, input.Y) > 0) mirror.AddMovementInput(input, 1, false);
    setLocomotion(animation.current, movement);
  });

  return (
    <character
      ref={character}
      location={[START[0] + OFFSET.X, START[1] + OFFSET.Y, START[2]]}
      useControllerRotationYaw={false}
      mesh={{ skeletalMeshAsset: MANNEQUIN_MESHES.manny, location: [0, 0, -CAPSULE_HALF_HEIGHT], rotation: [0, -90, 0] }}
      characterMovement={{ orientRotationToMovement: true, rotationRate: [0, 720, 0] }}
    >
      <MannequinLocomotion graph={animation} />
    </character>
  );
}
