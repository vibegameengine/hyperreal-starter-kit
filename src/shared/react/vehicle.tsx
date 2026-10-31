import * as UE from 'ue';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { loadContent, onVehicle } from '../engine/content';
import { world } from '../engine/world';
import type { VehicleRef } from '../vehicle';
import { ChaseCamera } from './chaseCamera';
import { useContentAsset } from './content';
import { useFrame } from './hooks';
import type { Vector3 } from './props';

export interface VehicleState {
  speedKmh: number;
  gear: number;
  rpm: number;
  suspension: number[];
}

export interface VehicleProps {
  vehicle: VehicleRef;
  at: Vector3;
  rotation?: Vector3;
  driven?: boolean;
  cruise?: number;
  steer?: number;
  camera?: { distance: number; height: number };
  onState?: (state: VehicleState) => void;
}

const MODIFY_BONE = '/Script/AnimGraphRuntime.AnimNode_ModifyBone';
const KEYS = { throttle: new UE.Key('W'), brake: new UE.Key('S'), left: new UE.Key('A'), right: new UE.Key('D'), handbrake: new UE.Key('SpaceBar') };
const CM_PER_SECOND_TO_KMH = 0.036;

function numbers(values: readonly number[]) {
  const array = UE.NewArray(UE.BuiltinFloat);
  for (const value of values) array.Add(value);
  return array;
}

function torqueCurve(points: VehicleRef['description']['engine']['torqueCurve']) {
  const curve = new UE.RuntimeFloatCurve();
  const keys = UE.NewArray(UE.RichCurveKey);
  for (const [rpm, torque] of points) {
    const key = new UE.RichCurveKey();
    key.Time = rpm;
    key.Value = torque;
    key.InterpMode = UE.ERichCurveInterpMode.RCIM_Linear;
    keys.Add(key);
  }
  curve.EditorCurveData.Keys = keys;
  return curve;
}

function differentialOf(vehicle: VehicleRef['description']) {
  const driven = vehicle.wheels.filter((wheel) => wheel.drive);
  const front = driven.filter((wheel) => wheel.steerAngle).length;
  if (front === driven.length) return UE.EVehicleDifferential.FrontWheelDrive;
  if (front === 0) return UE.EVehicleDifferential.RearWheelDrive;
  return UE.EVehicleDifferential.AllWheelDrive;
}

function movementProps(vehicle: VehicleRef['description'], wheelClasses: UE.Class[]) {
  const wheelSetups = vehicle.wheels.map((wheel, index) => {
    const setup = new UE.ChaosWheelSetup();
    setup.WheelClass = wheelClasses[index];
    setup.BoneName = wheel.bone;
    return setup;
  });
  const engine = new UE.VehicleEngineConfig();
  engine.TorqueCurve = torqueCurve(vehicle.engine.torqueCurve);
  engine.MaxTorque = Math.max(...vehicle.engine.torqueCurve.map(([, torque]) => torque));
  engine.MaxRPM = vehicle.engine.maxRPM;
  engine.EngineIdleRPM = vehicle.engine.idleRPM;
  engine.EngineBrakeEffect = vehicle.engine.brakeEffect ?? 0.2;
  engine.EngineRevUpMOI = 5;
  engine.EngineRevDownRate = 600;
  const gears = new UE.VehicleTransmissionConfig();
  gears.bUseAutomaticGears = vehicle.gears.automatic ?? true;
  gears.bUseAutoReverse = true;
  gears.FinalRatio = vehicle.gears.finalRatio;
  gears.ForwardGearRatios = numbers(vehicle.gears.forward);
  gears.ReverseGearRatios = numbers([vehicle.gears.reverse]);
  gears.ChangeUpRPM = vehicle.gears.changeUpRPM;
  gears.ChangeDownRPM = vehicle.gears.changeDownRPM;
  gears.GearChangeTime = vehicle.gears.changeSeconds ?? 0.2;
  gears.TransmissionEfficiency = 0.9;
  const differential = new UE.VehicleDifferentialConfig();
  differential.DifferentialType = differentialOf(vehicle);
  differential.FrontRearSplit = 0.5;
  const steering = new UE.VehicleSteeringConfig();
  steering.SteeringType = UE.ESteeringType.Ackermann;
  steering.AngleRatio = 0.7;
  const [comX, comY, comZ] = vehicle.centerOfMass;
  return { mass: vehicle.massKg, enableCenterOfMassOverride: true, centerOfMassOverride: new UE.Vector(comX, comY, comZ), chassisHeight: vehicle.chassisHeight, dragCoefficient: vehicle.dragCoefficient ?? 0.31, wheelSetups, engineSetup: engine, transmissionSetup: gears, differentialSetup: differential, steeringSetup: steering };
}

interface WheelPose {
  spin: number;
  steer: number;
  lift: number;
}

function wheelPose(bones: readonly string[], poses: readonly WheelPose[], index = 0): ReactNode {
  if (index === bones.length) return <blendList index={0} />;
  const { spin, steer, lift } = poses[index];
  return (
    <control
      node={MODIFY_BONE}
      BoneToModify={{ BoneName: bones[index] }}
      Rotation={{ Pitch: spin, Yaw: steer, Roll: 0 }}
      RotationMode="BMM_Replace"
      RotationSpace="BCS_BoneSpace"
      Translation={{ X: 0, Y: 0, Z: lift }}
      TranslationMode="BMM_Additive"
      TranslationSpace="BCS_ComponentSpace"
    >
      {wheelPose(bones, poses, index + 1)}
    </control>
  );
}

function WheelPoses({ bones, motion }: { bones: readonly string[]; motion: RefObject<UE.ChaosWheeledVehicleMovementComponent | null> }) {
  const [poses, setPoses] = useState<WheelPose[]>(() => bones.map(() => ({ spin: 0, steer: 0, lift: 0 })));
  useFrame(() => {
    const wheels = motion.current?.Wheels;
    if (!wheels || wheels.Num() !== bones.length) return;
    setPoses(bones.map((_, index) => {
      const wheel = wheels.Get(index);
      return { spin: wheel.GetRotationAngle(), steer: wheel.GetSteerAngle(), lift: wheel.GetSuspensionOffset() };
    }));
  });
  return wheelPose(bones, poses);
}

function useWheelClasses(vehicle: VehicleRef) {
  const [wheelClasses, setWheelClasses] = useState<UE.Class[]>();
  useEffect(
    () =>
      onVehicle(vehicle, (built) => {
        const folder = built.path.slice(0, built.path.lastIndexOf('/'));
        setWheelClasses(vehicle.wheelClasses.map((path) => UE.Class.Load(`${folder}${path.slice(path.lastIndexOf('/'))}`)));
      }),
    [vehicle.key],
  );
  return wheelClasses;
}

export function Vehicle({ vehicle, at, rotation, driven = false, cruise = 0, steer = 0, camera = { distance: 650, height: 140 }, onState }: VehicleProps) {
  const pawn = useRef<UE.Pawn>(null);
  const body = useRef<UE.SkeletalMeshComponent>(null);
  const motion = useRef<UE.ChaosWheeledVehicleMovementComponent>(null);
  const asset = useContentAsset(vehicle.model);
  const meshPath = asset?.skeletalMeshes[0];
  const wheelClasses = useWheelClasses(vehicle);
  const ready = !!meshPath && !!wheelClasses?.every(Boolean);
  const setup = useMemo(() => (wheelClasses ? movementProps(vehicle.description, wheelClasses) : undefined), [vehicle.key, wheelClasses]);
  const latest = useRef(onState);
  latest.current = onState;

  useEffect(() => {
    const actor = pawn.current;
    const movement = motion.current;
    if (!actor || !movement || !body.current || !ready) return;
    body.current.SetCollisionProfileName('Vehicle', true);
    for (const wheel of vehicle.description.wheels) body.current.TermBodiesBelow(wheel.bone);
    if (driven) UE.GameplayStatics.GetPlayerController(world, 0).Possess(actor);
  }, [ready]);

  useFrame(() => {
    const movement = motion.current;
    if (!movement || !ready) return;
    if (driven) {
      const controller = UE.GameplayStatics.GetPlayerController(world, 0);
      const down = (key: UE.Key) => (controller.IsInputKeyDown(key) ? 1 : 0);
      movement.SetThrottleInput(Math.max(cruise, down(KEYS.throttle)));
      movement.SetBrakeInput(down(KEYS.brake));
      movement.SetSteeringInput(Math.max(-1, Math.min(1, steer + down(KEYS.right) - down(KEYS.left))));
      movement.SetHandbrakeInput(!!down(KEYS.handbrake));
    }
    const suspension = vehicle.description.wheels.map((_, index) => movement.GetWheelState(index).NormalizedSuspensionLength);
    latest.current?.({ speedKmh: movement.GetForwardSpeed() * CM_PER_SECOND_TO_KMH, gear: movement.GetCurrentGear(), rpm: movement.GetEngineRotationSpeed(), suspension });
  });

  if (!ready) return null;
  return (
    <pawn ref={pawn} location={at} rotation={rotation}>
      <skeletalMeshComponent ref={body} skeletalMeshAsset={loadContent<UE.SkeletalMesh>(meshPath)} simulatePhysics>
        <animGraph>
          <WheelPoses bones={vehicle.description.wheels.map((wheel) => wheel.bone)} motion={motion} />
        </animGraph>
      </skeletalMeshComponent>
      <chaosWheeledVehicleMovementComponent ref={motion} {...setup} />
      <ChaseCamera target={body} distance={camera.distance} height={camera.height} />
    </pawn>
  );
}
