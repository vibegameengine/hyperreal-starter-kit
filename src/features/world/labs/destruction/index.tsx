import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { loadContent, onNiagara } from '../../../../shared/engine/content';
import { colored, world } from '../../../../shared/engine/world';
import { Destructible, useHudMessages, useHudState, useSmoothedFps } from '../../../../shared/react';
import type { Vector3 } from '../../../../shared/react/props';
import { breakDust } from '../../assets/destruction.niagara';
import { brickWall, stoneColumn } from '../../assets/destruction.fracture';

const SPHERE = '/Engine/BasicShapes/Sphere.Sphere';
const WALL_AT: Vector3 = [400, 0, 0];
const COLUMNS: Vector3[] = [
  [350, -420, 0],
  [350, 420, 0],
  [750, -260, 0],
  [750, 260, 0],
];
const TRACE_CM = 20000;
const BALL_SPEED = 3200;
const BALL_MASS_KG = 120;
const EXPLOSION_RADIUS = 450;
const EXPLOSION_SPEED = 900;
const DUST_EVERY_MS = 60;

interface Ball {
  id: number;
  at: Vector3;
  velocity: Vector3;
}

function cameraRay() {
  const camera = UE.GameplayStatics.GetPlayerCameraManager(world, 0);
  const start = camera.GetCameraLocation();
  const forward = UE.KismetMathLibrary.GetForwardVector(camera.GetCameraRotation());
  return { start, forward, end: new UE.Vector(start.X + forward.X * TRACE_CM, start.Y + forward.Y * TRACE_CM, start.Z + forward.Z * TRACE_CM) };
}

function traceFromCamera() {
  const { start, end } = cameraRay();
  const hit = $ref(new UE.HitResult());
  const found = UE.KismetSystemLibrary.LineTraceSingle(world, start, end, UE.ETraceTypeQuery.TraceTypeQuery1, true, UE.NewArray(UE.Actor), UE.EDrawDebugTrace.None, hit, true, UE.LinearColor.Red, UE.LinearColor.Green, 0);
  return found ? $unref(hit) : null;
}

export function Scene() {
  const [round, setRound] = useState(0);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [shotStrain, setShotStrain] = useState(500000);
  const [breaks, setBreaks] = useState(0);
  const components = useRef(new Set<UE.GeometryCollectionComponent>());
  const dustAsset = useRef<UE.NiagaraSystem | null>(null);
  const lastDust = useRef(0);
  const lastBall = useRef(0);
  const fps = useSmoothedFps();

  useEffect(() => onNiagara(breakDust, (built) => (dustAsset.current = loadContent<UE.NiagaraSystem>(built.path) ?? null)), []);

  const dustAt = (location: UE.Vector) => {
    const now = Date.now();
    if (!dustAsset.current || now - lastDust.current < DUST_EVERY_MS) return;
    lastDust.current = now;
    UE.NiagaraFunctionLibrary.SpawnSystemAtLocation(world, dustAsset.current, location, new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1), true, true, UE.ENCPoolMethod.AutoRelease, true);
  };

  const onBreak = (event: UE.ChaosBreakEvent) => {
    setBreaks((count) => count + 1);
    dustAt(event.Location);
  };

  const shoot = () => {
    const hit = traceFromCamera();
    const target = hit?.Component as unknown as UE.GeometryCollectionComponent | undefined;
    if (!hit || !target || !components.current.has(target)) return;
    target.ApplyExternalStrain(hit.Item, hit.ImpactPoint, 30, 1, 0.5, shotStrain);
    dustAt(hit.ImpactPoint);
  };

  const throwBall = () => {
    const { start, forward } = cameraRay();
    const id = ++lastBall.current;
    setBalls((current) => [...current, { id, at: [start.X + forward.X * 150, start.Y + forward.Y * 150, start.Z + forward.Z * 150] as Vector3, velocity: [forward.X * BALL_SPEED, forward.Y * BALL_SPEED, forward.Z * BALL_SPEED] as Vector3 }].slice(-6));
  };

  const explode = () => {
    const hit = traceFromCamera();
    const centre = hit ? hit.ImpactPoint : new UE.Vector(WALL_AT[0], WALL_AT[1], 120);
    const strain = UE.NewObject(UE.RadialFalloff.StaticClass()) as UE.RadialFalloff;
    strain.SetRadialFalloff(2000000, 0, 1, 0, EXPLOSION_RADIUS, centre, UE.EFieldFalloffType.Field_FallOff_None);
    const push = UE.NewObject(UE.RadialVector.StaticClass()) as UE.RadialVector;
    push.SetRadialVector(EXPLOSION_SPEED, centre);
    for (const component of components.current) {
      component.ApplyPhysicsField(true, UE.EGeometryCollectionPhysicsTypeEnum.Chaos_ExternalClusterStrain, null, strain);
      component.ApplyPhysicsField(true, UE.EGeometryCollectionPhysicsTypeEnum.Chaos_LinearVelocity, null, push);
    }
    dustAt(centre);
  };

  const reset = () => {
    components.current.clear();
    setBalls([]);
    setBreaks(0);
    setRound((value) => value + 1);
  };

  useHudMessages((message) => {
    if (message.type === 'destruction/shoot') shoot();
    if (message.type === 'destruction/ball') throwBall();
    if (message.type === 'destruction/explode') explode();
    if (message.type === 'destruction/reset') reset();
    if (message.type === 'destruction/strain') setShotStrain(Number(message.value));
  });
  useHudState('destruction/state', () => ({ shotStrain, breaks, fps: Math.round(fps.current ?? 0) }));

  const ready = (component: UE.GeometryCollectionComponent) => {
    components.current.add(component);
    console.log(`[destruction-lab] ${component.RestCollection?.GetName()} ready`);
  };

  return (
    <>
      <LabStage camera={{ location: [-700, 0, 260], rotation: [-8, 0, 0] }} />
      <Fragment key={round}>
        <Destructible collection={brickWall} at={WALL_AT} rotation={[0, 90, 0]} onReady={ready} onBreak={onBreak} />
        {COLUMNS.map((at, index) => (
          <Destructible key={index} collection={stoneColumn} at={at} onReady={ready} onBreak={onBreak} />
        ))}
      </Fragment>
      {balls.map((ball) => (
        <staticMeshComponent
          key={ball.id}
          location={ball.at}
          scale={0.4}
          staticMesh={SPHERE}
          overrideMaterials={[colored([0.08, 0.08, 0.09])]}
          mobility={UE.EComponentMobility.Movable}
          simulatePhysics
          ref={(mesh: UE.StaticMeshComponent | null) => {
            if (!mesh || mesh.GetPhysicsLinearVelocity('None').Size() > 1) return;
            mesh.SetMassOverrideInKg('None', BALL_MASS_KG, true);
            mesh.SetPhysicsLinearVelocity(new UE.Vector(...ball.velocity), false, 'None');
          }}
        />
      ))}
    </>
  );
}
