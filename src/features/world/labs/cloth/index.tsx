import * as UE from 'ue';
import { $ref } from 'puerts';
import { useEffect, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { useSkeletalMesh } from '../../../character/entities/ImportedCharacter';
import { MANNEQUIN_MESHES, mannequinClips } from '../../../character/entities/mannequin';
import { useClothBehaviour, useFrame, useHudMessages, useHudState } from '../../../../shared/react';
import curtainModel from '../../assets/cloth/curtain.glb?cloth=Cloth&pinAbove=z:253&ramp=10&reach=260&density=0.45';
import flagModel from '../../assets/cloth/flag.glb?cloth=Cloth&pinBelow=x:5&ramp=12&reach=220&density=0.2';
import { curtainFabric, flagFabric } from '../../assets/cloth/fabric';
import metal, { brass } from '../../assets/cloth/metal';
import { blowWind, CLOTH_ASSET, clothStats, CURTAIN_CLOTH, FABRICS, FLAG_CLOTH, woven, type Fabric } from './clothing';
import { CapeRunner } from './CapeRunner';

const CURTAIN_Y = 450;
const WALK_REACH_CM = 220;
const WALK_SPEED_CM_S = 150;
const ignoredHit = $ref(new UE.HitResult());

function gust(seconds: number) {
  return 0.65 + 0.25 * Math.sin(seconds * 0.9) + 0.1 * Math.sin(seconds * 3.7 + 1.3);
}

function windVelocity(strength: number, headingDegrees: number, seconds: number) {
  const speed = strength * gust(seconds);
  const heading = (headingDegrees * Math.PI) / 180;
  return new UE.Vector(Math.cos(heading) * speed, Math.sin(heading) * speed, 0);
}

function walkerPlace(seconds: number) {
  const lap = (4 * WALK_REACH_CM) / WALK_SPEED_CM_S;
  const phase = (seconds % lap) / lap;
  const forward = phase < 0.5;
  const along = forward ? phase * 4 - 1 : 3 - phase * 4;
  return { x: along * WALK_REACH_CM, yaw: forward ? -90 : 90 };
}

function useWalker(walker: React.RefObject<UE.SkeletalMeshActor | null>, curtain: React.RefObject<UE.SkeletalMeshActor | null>, curtainMesh: UE.SkeletalMesh | undefined) {
  useEffect(() => {
    const body = walker.current?.SkeletalMeshComponent;
    const cloth = curtain.current?.SkeletalMeshComponent;
    if (!body || !cloth) return;
    const walk = mannequinClips().get('walking');
    if (walk) body.PlayAnimation(walk, true);
    const mesh = UE.Object.Load(MANNEQUIN_MESHES.manny) as UE.SkeletalMesh;
    cloth.AddClothCollisionSource(body, mesh.GetPhysicsAsset());
    return () => cloth.RemoveClothCollisionSources(body);
  }, [curtainMesh]);
}

export function Scene() {
  const flag = useRef<UE.SkeletalMeshActor | null>(null);
  const curtain = useRef<UE.SkeletalMeshActor | null>(null);
  const walker = useRef<UE.SkeletalMeshActor | null>(null);
  const seconds = useRef(0);
  const walkSeconds = useRef(0);
  const [wind, setWind] = useState(900);
  const [heading, setHeading] = useState(-90);
  const [fabric, setFabric] = useState<Fabric>('cotton');
  const [walking, setWalking] = useState(true);
  const flagMesh = useSkeletalMesh(flagModel, undefined);
  const curtainMesh = useSkeletalMesh(curtainModel, undefined);
  useWalker(walker, curtain, curtainMesh);

  useClothBehaviour(() => flag.current?.SkeletalMeshComponent, CLOTH_ASSET, woven(FLAG_CLOTH, fabric));
  useClothBehaviour(() => curtain.current?.SkeletalMeshComponent, CLOTH_ASSET, woven(CURTAIN_CLOTH, fabric));

  useFrame((deltaSeconds) => {
    seconds.current += deltaSeconds;
    blowWind(flag.current?.SkeletalMeshComponent, windVelocity(wind, heading, seconds.current));
    if (!walking) return;
    walkSeconds.current += deltaSeconds;
    const { x, yaw } = walkerPlace(walkSeconds.current);
    walker.current?.K2_SetActorLocationAndRotation(new UE.Vector(x, CURTAIN_Y, 0), new UE.Rotator(0, yaw, 0), false, ignoredHit, false);
  });
  useHudMessages((message) => {
    if (message.type === 'cloth/wind') setWind(Number(message.strength));
    if (message.type === 'cloth/heading') setHeading(Number(message.degrees));
    if (message.type === 'cloth/fabric' && String(message.fabric) in FABRICS) setFabric(message.fabric as Fabric);
    if (message.type === 'cloth/walker') setWalking(Boolean(message.walking));
  });
  useHudState('cloth/state', () => ({
    wind, heading, fabric, fabrics: Object.keys(FABRICS), walking,
    flag: clothStats(flag.current?.SkeletalMeshComponent) ?? null,
    curtain: clothStats(curtain.current?.SkeletalMeshComponent) ?? null,
  }));

  return (
    <>
      <LabStage sunPitch={-32} sunYaw={20} camera={{ location: [-950, 250, 330], rotation: [-10, -12, 0] }} />
      {flagMesh && <skeletalMeshActor ref={flag} location={[0, -250, 0]} skeletalMeshComponent={{ mobility: UE.EComponentMobility.Movable, skeletalMeshAsset: flagMesh, overrideMaterials: [metal, flagFabric] }} />}
      {curtainMesh && <skeletalMeshActor ref={curtain} location={[0, CURTAIN_Y, 0]} rotation={[0, 90, 0]} skeletalMeshComponent={{ mobility: UE.EComponentMobility.Movable, skeletalMeshAsset: curtainMesh, overrideMaterials: [brass, curtainFabric] }} />}
      <skeletalMeshActor ref={walker} location={[-WALK_REACH_CM, CURTAIN_Y, 0]} skeletalMeshComponent={{ mobility: UE.EComponentMobility.Movable, skeletalMeshAsset: MANNEQUIN_MESHES.manny }} />
      <CapeRunner />
    </>
  );
}
