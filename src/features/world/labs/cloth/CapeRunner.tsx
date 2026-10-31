import * as UE from 'ue';
import { $ref } from 'puerts';
import { useEffect, useRef } from 'react';
import { useSkeletalMesh } from '../../../character/entities/ImportedCharacter';
import { MANNEQUIN_MESHES, mannequinClips } from '../../../character/entities/mannequin';
import { useFrame } from '../../../../shared/react';
import capeModel from '../../assets/cloth/cape.glb?cloth=./capeCloth.json';
import { capeFabric } from '../../assets/cloth/fabric';

const CENTRE: readonly [number, number] = [-350, 0];
const RADIUS_CM = 240;
const RUN_SPEED_CM_S = 380;
const CAPE_BACK_CM = 16;
const CAPE_UP_CM = 4;
const ignoredHit = $ref(new UE.HitResult());

function placeOnCircle(runner: UE.SkeletalMeshActor, seconds: number) {
  const angle = (seconds * RUN_SPEED_CM_S) / RADIUS_CM;
  const location = new UE.Vector(CENTRE[0] + Math.cos(angle) * RADIUS_CM, CENTRE[1] + Math.sin(angle) * RADIUS_CM, 0);
  const headingDegrees = (angle * 180) / Math.PI + 90;
  runner.K2_SetActorLocationAndRotation(location, new UE.Rotator(0, headingDegrees - 90, 0), false, ignoredHit, true);
}

function wearCape(body: UE.SkeletalMeshComponent, cape: UE.SkeletalMeshComponent) {
  const shoulders = body.GetSocketLocation('spine_05');
  const back = body.GetRightVector();
  const at = new UE.Vector(shoulders.X - back.X * CAPE_BACK_CM, shoulders.Y - back.Y * CAPE_BACK_CM, shoulders.Z + CAPE_UP_CM);
  cape.K2_SetWorldLocationAndRotation(at, body.K2_GetComponentRotation(), false, ignoredHit, true);
  cape.K2_AttachToComponent(body, 'spine_05', UE.EAttachmentRule.KeepWorld, UE.EAttachmentRule.KeepWorld, UE.EAttachmentRule.KeepWorld, false);
  const physics = (UE.Object.Load(MANNEQUIN_MESHES.manny) as UE.SkeletalMesh).GetPhysicsAsset();
  cape.AddClothCollisionSource(body, physics);
}

export function CapeRunner() {
  const runner = useRef<UE.SkeletalMeshActor | null>(null);
  const cape = useRef<UE.SkeletalMeshActor | null>(null);
  const seconds = useRef(0);
  const capeMesh = useSkeletalMesh(capeModel, undefined);

  useEffect(() => {
    const body = runner.current?.SkeletalMeshComponent;
    const cloth = cape.current?.SkeletalMeshComponent;
    if (!body || !cloth) return;
    const run = mannequinClips().get('running');
    if (run) body.PlayAnimation(run, true);
    placeOnCircle(runner.current!, 0);
    wearCape(body, cloth);
  }, [capeMesh]);

  useFrame((deltaSeconds) => {
    seconds.current += deltaSeconds;
    if (runner.current) placeOnCircle(runner.current, seconds.current);
  });

  return (
    <>
      <skeletalMeshActor ref={runner} location={[CENTRE[0] + RADIUS_CM, CENTRE[1], 0]} skeletalMeshComponent={{ mobility: UE.EComponentMobility.Movable, skeletalMeshAsset: MANNEQUIN_MESHES.manny }} />
      {capeMesh && <skeletalMeshActor ref={cape} skeletalMeshComponent={{ mobility: UE.EComponentMobility.Movable, skeletalMeshAsset: capeMesh, overrideMaterials: [capeFabric] }} />}
    </>
  );
}
