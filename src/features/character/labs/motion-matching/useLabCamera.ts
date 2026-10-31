import * as UE from 'ue';
import type { RefObject } from 'react';
import { $ref } from 'puerts';
import { world } from '../../../../shared/engine/world';
import { useFrame } from '../../../../shared/react';
import { CAMERA_DISTANCE, pawnOf, type View } from './lab';

type Vector = [number, number, number];

const VIEWS: Record<Exclude<View, 'player'>, { offset: Vector; rotation: Vector }> = {
  side: { offset: [0, -CAMERA_DISTANCE, 0], rotation: [-4, 90, 0] },
  front: { offset: [CAMERA_DISTANCE, 0, 0], rotation: [-4, 180, 0] },
  behind: { offset: [-CAMERA_DISTANCE, 0, 20], rotation: [-6, 0, 0] },
  top: { offset: [0, 0, CAMERA_DISTANCE * 1.6], rotation: [-89, 0, 0] },
};

export function useLabCamera(camera: RefObject<UE.CameraActor | null>, view: View, target: () => UE.Vector | undefined) {
  useFrame(
    () => {
      const controller = UE.GameplayStatics.GetPlayerController(world, 0);
      const pawn = pawnOf();
      if (!camera.current || !controller || !pawn) return;
      if (view === 'player') {
        if (controller.GetViewTarget() !== pawn) controller.SetViewTargetWithBlend(pawn, 0);
        return;
      }
      const at = target();
      if (!at) return;
      const { offset, rotation } = VIEWS[view];
      camera.current.K2_SetActorLocationAndRotation(new UE.Vector(at.X + offset[0], at.Y + offset[1], at.Z + offset[2]), new UE.Rotator(...rotation), false, $ref(new UE.HitResult()), true);
      if (controller.GetViewTarget() !== camera.current) controller.SetViewTargetWithBlend(camera.current, 0);
    },
    { tickEvenWhenPaused: true },
  );
}
