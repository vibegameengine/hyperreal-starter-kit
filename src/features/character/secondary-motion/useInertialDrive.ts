import * as UE from 'ue';
import { useMemo, type RefObject } from 'react';
import { param, type AnimParam } from '../../../shared/react/anim';
import { useFrame } from '../../../shared/react';

export type Vector3 = [number, number, number];

export interface DrivenNode {
  key: string;
  pointBone: string;
  spaceBone: string;
  responseOnBoneAxes: Vector3;
  gravityScale: number;
  maxPush?: number;
}

function softLimited(push: UE.Vector, maxPush: number | undefined) {
  const size = Math.hypot(push.X, push.Y, push.Z);
  if (!maxPush || size < 1e-6) return push;
  const scale = (maxPush * Math.tanh(size / maxPush)) / size;
  return new UE.Vector(push.X * scale, push.Y * scale, push.Z * scale);
}

interface PointMotion {
  position?: Vector3;
  velocity?: Vector3;
  acceleration: Vector3;
}

interface RestInSpace {
  location: Vector3;
  rotation: Vector3;
}

const GRAVITY = 980;
const AXIS_LETTERS = 'xyz';
const math = UE.KismetMathLibrary;
const toVector = (value: readonly number[]) => new UE.Vector(value[0], value[1], value[2]);
const fromVector = (value: UE.Vector): Vector3 => [value.X, value.Y, value.Z];

export const forceParam = (key: string, axis: number) => `inertia.force.${key}.${AXIS_LETTERS[axis]}`;
export const gravityParam = (key: string, axis: number) => `inertia.gravity.${key}.${AXIS_LETTERS[axis]}`;
type ParamVector = readonly [AnimParam, AnimParam, AnimParam];
const paramVector = (name: (axis: number) => string) => [0, 1, 2].map((axis) => param(name(axis))) as unknown as ParamVector;
export const forceOf = (key: string) => paramVector((axis) => forceParam(key, axis));
export const gravityOf = (key: string) => paramVector((axis) => gravityParam(key, axis));

function restInSpace(component: UE.SkeletalMeshComponent, bone: string, spaceBone: string): RestInSpace {
  let offset = component.GetRefPoseTransform(component.GetBoneIndex(bone));
  for (let parent = component.GetParentBone(bone); parent !== spaceBone && parent !== 'None'; parent = component.GetParentBone(parent)) {
    offset = math.ComposeTransforms(offset, component.GetRefPoseTransform(component.GetBoneIndex(parent)));
  }
  const rotation = math.Quat_Rotator(offset.Rotation);
  return { location: fromVector(offset.Translation), rotation: [rotation.Pitch, rotation.Yaw, rotation.Roll] };
}

const SMOOTHING_SECONDS = 0.03;

function advance(motion: PointMotion, position: Vector3, deltaSeconds: number) {
  if (motion.position && deltaSeconds > 0) {
    const blend = 1 - Math.exp(-deltaSeconds / SMOOTHING_SECONDS);
    const measured = position.map((value, axis) => (value - motion.position![axis]) / deltaSeconds) as Vector3;
    const previousVelocity = motion.velocity ?? measured;
    const velocity = previousVelocity.map((previous, axis) => previous + blend * (measured[axis] - previous)) as Vector3;
    motion.acceleration = motion.acceleration.map((previous, axis) => previous + blend * ((velocity[axis] - previousVelocity[axis]) / deltaSeconds - previous)) as Vector3;
    motion.velocity = velocity;
  }
  motion.position = position;
}

function spaceFrames(component: UE.SkeletalMeshComponent, spaceBone: string) {
  const inComponent = component.GetSocketTransform(spaceBone, UE.ERelativeTransformSpace.RTS_Component);
  const componentToWorld = component.K2_GetComponentToWorld();
  return { world: math.ComposeTransforms(inComponent, componentToWorld), asTheEngineComposesIt: math.ComposeTransforms(componentToWorld, inComponent) };
}

function weighOnBoneAxes(inSpace: UE.Vector, rest: RestInSpace, weights: Vector3) {
  const boneRotation = new UE.Rotator(rest.rotation[0], rest.rotation[1], rest.rotation[2]);
  const onBone = fromVector(math.LessLess_VectorRotator(inSpace, boneRotation)).map((value, axis) => value * weights[axis]);
  return math.GreaterGreater_VectorRotator(toVector(onBone), boneRotation);
}

function setVector(graph: UE.VgeAnimInstance, name: (axis: number) => string, value: UE.Vector) {
  fromVector(value).forEach((component, axis) => graph.SetFloat(name(axis), component));
}

export interface InertialDriveSettings {
  response: number;
  accelerationClamp: number;
}

export function useInertialDrive(body: RefObject<UE.SkeletalMeshComponent | null>, nodes: readonly DrivenNode[], settings: InertialDriveSettings) {
  const motions = useMemo(() => new Map(nodes.map((node) => [node.key, { acceleration: [0, 0, 0] } as PointMotion])), [nodes]);
  const rests = useMemo(() => new Map<string, RestInSpace>(), [nodes]);
  useFrame((deltaSeconds) => {
    const component = body.current;
    const graph = component?.GetAnimInstance() as UE.VgeAnimInstance | undefined;
    if (!component || !graph?.SetFloat) return;
    const clamp = (value: number) => Math.max(-settings.accelerationClamp, Math.min(settings.accelerationClamp, value));
    const framesBySpace = new Map<string, ReturnType<typeof spaceFrames>>();
    for (const node of nodes) {
      if (!framesBySpace.has(node.spaceBone)) framesBySpace.set(node.spaceBone, spaceFrames(component, node.spaceBone));
      const frames = framesBySpace.get(node.spaceBone)!;
      if (!rests.has(node.key)) rests.set(node.key, restInSpace(component, node.pointBone, node.spaceBone));
      const rest = rests.get(node.key)!;
      const motion = motions.get(node.key)!;
      setVector(graph, (axis) => gravityParam(node.key, axis), math.InverseTransformDirection(frames.world, new UE.Vector(0, 0, -GRAVITY * node.gravityScale)));
      advance(motion, fromVector(math.TransformLocation(frames.world, toVector(rest.location))), deltaSeconds);
      const inertia = toVector(motion.acceleration.map((value) => clamp(-value * settings.response)));
      const weighted = softLimited(weighOnBoneAxes(math.InverseTransformDirection(frames.world, inertia), rest, node.responseOnBoneAxes), node.maxPush);
      setVector(graph, (axis) => forceParam(node.key, axis), math.TransformDirection(frames.asTheEngineComposesIt, weighted));
    }
  });
  return motions;
}
