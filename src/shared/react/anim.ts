import * as UE from 'ue';
import type { Key, ReactNode, Ref } from 'react';
import type { HostNode } from './renderer';


export interface AnimParam {
  readonly param: string;
}
export const param = (name: string): AnimParam => ({ param: name });

type AnimNumber = number | AnimParam;
type AnimBool = boolean | AnimParam;
type AnimVector = readonly [AnimNumber, AnimNumber, AnimNumber];
type Asset<T> = string | T;
type BlendType = 'Linear' | 'Cubic' | 'HermiteCubic' | 'Sinusoidal' | 'QuadraticInOut' | 'CubicInOut' | 'QuarticInOut' | 'QuinticInOut' | 'CircularIn' | 'CircularOut' | 'CircularInOut' | 'ExpIn' | 'ExpOut' | 'ExpInOut' | 'Custom';
type BoneSpace = 'world' | 'component' | 'parentBone' | 'bone';

interface AnimElement {
  key?: Key;
}
interface WithPoses extends AnimElement {
  children?: ReactNode;
}

export interface AnimGraphElement extends AnimElement {
  ref?: Ref<UE.VgeAnimInstance>;
  children?: ReactNode;
}
export interface ClipElement extends AnimElement {
  sequence: Asset<UE.AnimSequenceBase>;
  playRate?: AnimNumber;
  loop?: AnimBool;
  startPosition?: number;
}
export interface BlendSpaceElement extends AnimElement {
  blendSpace: Asset<UE.BlendSpace>;
  x?: AnimNumber;
  y?: AnimNumber;
  playRate?: AnimNumber;
  loop?: AnimBool;
}
export interface BlendElement extends WithPoses {
  alpha: AnimNumber;
}
interface BlendListSettings extends WithPoses {
  blendTime?: AnimNumber | readonly AnimNumber[];
  transition?: 'blend' | 'inertialization';
  blendType?: BlendType;
  blendProfile?: Asset<UE.BlendProfile>;
  customCurve?: Asset<UE.CurveFloat>;
  childUpdate?: 'default' | 'reset' | 'always';
}
export interface BlendListElement extends BlendListSettings {
  index: AnimNumber;
}
export interface BlendByBoolElement extends BlendListSettings {
  active: AnimBool;
}
export interface LinkedGraphElement extends WithPoses {
  instanceClass: Asset<UE.Class>;
}
export interface InertializeElement extends WithPoses {
  defaultBlendProfile?: Asset<UE.BlendProfile>;
  filteredCurves?: readonly string[];
  filteredBones?: readonly string[];
  resetOnBecomingRelevant?: boolean;
  tag?: string;
}
export interface StateMachineElement extends WithPoses {
  entry?: string;
  maxTransitionsPerFrame?: number;
}
export interface StateElement extends WithPoses {
  name: string;
  alwaysResetOnEntry?: boolean;
}
export interface TransitionElement extends AnimElement {
  from: string;
  to: string;
  when?: string;
  duration?: AnimNumber;
  blend?: 'crossfade' | 'inertialization';
  blendType?: BlendType;
  blendProfile?: Asset<UE.BlendProfile>;
}
export interface BranchFilter {
  bone: string;
  depth?: number;
}
export interface LayeredElement extends WithPoses {
  layers: readonly (BranchFilter | readonly BranchFilter[])[];
  weights?: readonly AnimNumber[];
  meshSpaceRotationBlend?: boolean;
  rootSpaceRotationBlend?: boolean;
  meshSpaceScaleBlend?: boolean;
  curveBlend?: 'Override' | 'DoNotOverride' | 'NormalizeByWeight' | 'BlendByWeight' | 'UseBasePose' | 'UseMaxValue' | 'UseMinValue';
}
export interface SlotElement extends WithPoses {
  name?: string;
  alwaysUpdateSource?: boolean;
}
export interface TwoBoneIKElement extends WithPoses {
  ikBone: string;
  effectorLocation?: AnimVector;
  effectorSpace?: BoneSpace;
  effectorBone?: string;
  jointTargetLocation?: AnimVector;
  jointTargetSpace?: BoneSpace;
  jointTargetBone?: string;
  alpha?: AnimNumber;
  allowStretching?: boolean;
  startStretchRatio?: number;
  maxStretchScale?: number;
  takeRotationFromEffectorSpace?: boolean;
  maintainEffectorRelRot?: boolean;
  allowTwist?: boolean;
}

export interface ControlElement extends WithPoses {
  node: string;
  [field: string]: unknown;
}

type Vector = readonly [number, number, number];
type Axis = 'AxisX' | 'AxisY' | 'AxisZ';

export interface AnimPhysConstraintSetup {
  linearXLimitType?: 'Free' | 'Limited';
  linearYLimitType?: 'Free' | 'Limited';
  linearZLimitType?: 'Free' | 'Limited';
  linearAxesMin?: Vector;
  linearAxesMax?: Vector;
  angularConstraintType?: 'Angular' | 'Cone';
  twistAxis?: Axis;
  angularTargetAxis?: Axis;
  coneAngle?: number;
  angularLimitsMin?: Vector;
  angularLimitsMax?: Vector;
  angularTarget?: Vector;
}
export interface AnimPhysBodyDefinition {
  boundBone?: string;
  boxExtents?: Vector;
  localJointOffset?: Vector;
  collisionType?: 'CoM' | 'CustomSphere' | 'InnerSphere' | 'OuterSphere';
  sphereCollisionRadius?: number;
  constraintSetup?: AnimPhysConstraintSetup;
}
export interface AnimPhysSphericalLimit {
  drivingBone?: string;
  sphereLocalOffset?: Vector;
  limitRadius: number;
  limitType?: 'Inner' | 'Outer';
}
export interface AnimPhysPlanarLimit {
  drivingBone?: string;
  planeTransform?: { translation?: Vector; rotation?: Vector };
}
export interface AnimPhysSimSpaceSettings {
  simSpaceAngularAlpha?: number;
  maxAngularVelocity?: number;
  maxAngularAcceleration?: number;
  externalAngularVelocity?: Vector;
}
export interface AnimDynamicsElement extends WithPoses {
  boundBone: string;
  chain?: boolean;
  chainEnd?: string;
  physicsBodyDefinitions?: readonly AnimPhysBodyDefinition[];
  simulationSpace?: 'Component' | 'Actor' | 'World' | 'RootRelative' | 'BoneRelative';
  relativeSpaceBone?: string;
  alpha?: AnimNumber;
  gravityScale?: AnimNumber;
  useGravityOverride?: boolean;
  gravityOverride?: AnimVector;
  gravityOverrideInSimSpace?: boolean;
  linearSpring?: AnimBool;
  linearSpringConstant?: AnimNumber;
  angularSpring?: AnimBool;
  angularSpringConstant?: AnimNumber;
  overrideLinearDamping?: boolean;
  linearDampingOverride?: number;
  overrideAngularDamping?: boolean;
  angularDampingOverride?: number;
  overrideAngularBias?: AnimBool;
  angularBiasOverride?: AnimNumber;
  worldSpaceMinimumScale?: AnimNumber;
  windScale?: AnimNumber;
  enableWind?: AnimBool;
  componentLinearAccScale?: AnimVector;
  componentLinearVelScale?: AnimVector;
  componentAppliedLinearAccClamp?: AnimVector;
  simSpaceSettings?: AnimPhysSimSpaceSettings;
  numSolverIterationsPreUpdate?: AnimNumber;
  numSolverIterationsPostUpdate?: AnimNumber;
  useSphericalLimits?: AnimBool;
  sphericalLimits?: readonly AnimPhysSphericalLimit[];
  usePlanarLimit?: AnimBool;
  planarLimits?: readonly AnimPhysPlanarLimit[];
  externalForce?: AnimVector;
  doUpdate?: AnimBool;
  doEval?: AnimBool;
}

export interface AnimIntrinsicElements {
  animGraph: AnimGraphElement;
  clip: ClipElement;
  blendSpace: BlendSpaceElement;
  blend: BlendElement;
  blendList: BlendListElement;
  blendByBool: BlendByBoolElement;
  blendByInt: BlendListElement;
  blendByEnum: BlendListElement;
  linkedGraph: LinkedGraphElement;
  inertialize: InertializeElement;
  stateMachine: StateMachineElement;
  state: StateElement;
  transition: TransitionElement;
  layered: LayeredElement;
  slot: SlotElement;
  twoBoneIK: TwoBoneIKElement;
  animDynamics: AnimDynamicsElement;
  control: ControlElement;
}

const NODE_TYPES: Record<string, string> = {
  clip: 'clip',
  blendSpace: 'blendSpace',
  blend: 'blend',
  blendList: 'blendList',
  blendByBool: 'blendList',
  blendByInt: 'blendList',
  blendByEnum: 'blendList',
  linkedGraph: 'linkedGraph',
  inertialize: 'inertialize',
  stateMachine: 'stateMachine',
  state: 'state',
  transition: 'transition',
  layered: 'layered',
  slot: 'slot',
  twoBoneIK: 'twoBoneIK',
  animDynamics: 'animDynamics',
  control: 'control',
};
export const isAnimElement = (type: string) => type === 'animGraph' || type in NODE_TYPES;

const NOT_PROPS = new Set(['children', 'key', 'ref']);

const encode = (value: any): any => (value instanceof UE.Object ? UE.KismetSystemLibrary.GetPathName(value) : Array.isArray(value) ? value.map(encode) : value);

function describe(node: HostNode): object {
  const props = Object.fromEntries(Object.entries(node.props).filter(([prop]) => !NOT_PROPS.has(prop)).map(([prop, value]) => [prop, encode(value)]));
  return { id: String(node.animId), type: NODE_TYPES[node.type], props, children: node.children.map(describe) };
}

function meshOf(graph: HostNode): UE.SkeletalMeshComponent {
  const parent = graph.parent;
  const target = parent?.object;
  if (target instanceof UE.SkeletalMeshComponent) return target;
  if (target instanceof UE.Character) return target.Mesh;
  if (target instanceof UE.Actor) {
    const mesh = target.GetComponentByClass(UE.SkeletalMeshComponent.StaticClass());
    if (mesh) return mesh as UE.SkeletalMeshComponent;
  }
  throw new Error('<animGraph> belongs inside a character, an actor with a skeletal mesh, or a <skeletalMeshComponent>');
}

export const graphOf = (node: HostNode | null): HostNode | undefined =>
  !node || node.kind !== 'anim' ? undefined : node.type === 'animGraph' ? node : graphOf(node.parent);

function submit(graph: HostNode) {
  const root = graph.children[0];
  if (graph.children.length > 1) console.error('[react] <animGraph> takes one root node; the rest are ignored');
  (graph.object as UE.VgeAnimInstance).SetGraph(root ? JSON.stringify(describe(root)) : '');
}

export function mountGraph(graph: HostNode) {
  const mesh = meshOf(graph);
  mesh.SetAnimInstanceClass(UE.VgeAnimInstance.StaticClass());
  graph.object = mesh.GetAnimInstance();
  graph.mesh = mesh;
  submit(graph);
}

export function readoptGraphs(owner: HostNode) {
  for (const child of owner.children) {
    if (child.kind !== 'anim' || child.type !== 'animGraph' || !child.mounted || !child.mesh) continue;
    const running = child.mesh.GetAnimInstance();
    if (running === child.object) continue;
    if (!(running instanceof UE.VgeAnimInstance)) child.mesh.SetAnimInstanceClass(UE.VgeAnimInstance.StaticClass());
    child.object = child.mesh.GetAnimInstance();
    submit(child);
  }
}

export function unmountGraph(graph: HostNode) {
  if (graph.mesh && UE.KismetSystemLibrary.IsValid(graph.mesh)) graph.mesh.SetAnimInstanceClass(null);
  graph.object = graph.mesh = undefined;
}

const reshaped = new Set<HostNode>();
export function reshape(node: HostNode | null) {
  const graph = graphOf(node);
  if (graph) reshaped.add(graph);
}
export function submitReshaped() {
  for (const graph of reshaped) if (graph.mounted && graph.object) submit(graph);
  reshaped.clear();
}

export function updateAnimNode(node: HostNode, oldProps: Record<string, any>, newProps: Record<string, any>) {
  node.props = newProps;
  const graph = graphOf(node);
  if (!graph?.mounted || !graph.object || node === graph) return;
  const changed = [...new Set([...Object.keys(oldProps), ...Object.keys(newProps)])].filter(
    (prop) => !NOT_PROPS.has(prop) && JSON.stringify(encode(oldProps[prop])) !== JSON.stringify(encode(newProps[prop])),
  );
  if (changed.some((prop) => newProps[prop] === undefined)) {
    node.animId = newAnimId();
    reshape(node);
    return;
  }
  for (const prop of changed) (graph.object as UE.VgeAnimInstance).SetNodeParam(String(node.animId), prop, JSON.stringify(encode(newProps[prop])));
}

let nextAnimId = 1;
export const newAnimId = () => nextAnimId++;
