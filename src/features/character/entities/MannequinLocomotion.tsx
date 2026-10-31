import type * as UE from 'ue';
import type { ReactNode, Ref } from 'react';
import { param } from '../../../shared/react';


const ANIMS = '/Game/Characters/Mannequins/Anims/Unarmed';
export interface LocomotionClips {
  idleWalkRun: string;
  jump: string;
  fall: string;
  land: string;
  run?: string;
  aim?: string;
  ride?: string;
  climb?: string;
  upperBody?: string;
}
export const MANNY_LOCOMOTION: LocomotionClips = {
  idleWalkRun: `${ANIMS}/BS_Idle_Walk_Run.BS_Idle_Walk_Run`,
  jump: `${ANIMS}/Jump/MM_Jump.MM_Jump`,
  fall: `${ANIMS}/Jump/MM_Fall_Loop.MM_Fall_Loop`,
  land: `${ANIMS}/Jump/MM_Land.MM_Land`,
};

export function locomotionClipsIn(objects: readonly { path: string }[]): LocomotionClips | undefined {
  const named = (path: string) => objects.find((object) => object.path.endsWith(path.slice(path.lastIndexOf('/'))))?.path;
  const clips = { idleWalkRun: named(MANNY_LOCOMOTION.idleWalkRun), jump: named(MANNY_LOCOMOTION.jump), fall: named(MANNY_LOCOMOTION.fall), land: named(MANNY_LOCOMOTION.land) };
  return clips.idleWalkRun && clips.jump && clips.fall && clips.land ? (clips as LocomotionClips) : undefined;
}

export function ualClipsIn(objects: readonly { path: string }[]): Pick<LocomotionClips, 'aim' | 'ride'> {
  const named = (name: string) => objects.find((object) => object.path.endsWith(name))?.path;
  return { aim: named('Pistol_Idle_Loop'), ride: named('Driving_Loop') };
}

const MOVING_SPEED = 50;
const JUMP_VELOCITY = 100;
const LAND_SETTLE_SECONDS = 0.6;

export interface LayerWeights {
  run: number;
  aim: number;
  ride: number;
  climbing: boolean;
}

const NO_LAYERS: LayerWeights = { run: 0, aim: 0, ride: 0, climbing: false };

export function setLocomotion(graph: UE.VgeAnimInstance | null, movement: UE.CharacterMovementComponent, layers: LayerWeights = NO_LAYERS) {
  if (!graph) return;
  const velocity = movement.Velocity;
  graph.SetFloat('speed', Math.hypot(velocity.X, velocity.Y));
  graph.SetFloat('velocityZ', velocity.Z);
  graph.SetBool('falling', movement.IsFalling());
  graph.SetFloat('runWeight', layers.run);
  graph.SetFloat('aimWeight', layers.aim);
  graph.SetFloat('rideWeight', layers.ride);
  graph.SetBool('climbing', layers.climbing);
}

function blendedWith(pose: ReactNode, clip: string | undefined, weight: string) {
  return clip ? (
    <blend alpha={param(weight)}>
      {pose}
      <clip sequence={clip} />
    </blend>
  ) : pose;
}

function withLayers(ground: ReactNode, clips: LocomotionClips) {
  const running = blendedWith(blendedWith(ground, clips.run, 'runWeight'), clips.ride, 'rideWeight');
  if (!clips.aim || !clips.upperBody) return running;
  return (
    <layered layers={[{ bone: clips.upperBody }]} weights={[param('aimWeight')]}>
      {running}
      <clip sequence={clips.aim} />
    </layered>
  );
}

export interface MannequinLocomotionProps {
  graph: Ref<UE.VgeAnimInstance>;
  clips?: LocomotionClips;
  ground?: ReactNode;
  finish?: (pose: ReactNode) => ReactNode;
  springDamping?: number;
}

const asIs = (pose: ReactNode) => pose;

export function MannequinLocomotion({ graph, clips = MANNY_LOCOMOTION, ground, finish = asIs, springDamping }: MannequinLocomotionProps) {
  return <animGraph ref={graph}>{finish(<Locomotion clips={clips} ground={ground} springDamping={springDamping} />)}</animGraph>;
}

function Locomotion({ clips, ground, springDamping }: { clips: LocomotionClips; ground?: ReactNode; springDamping?: number }) {
  return (
    <inertialize springDamping={springDamping}>
      <slot name="DefaultSlot">
        <stateMachine entry="locomotion">
          <state name="locomotion">{withLayers(ground ?? <blendSpace blendSpace={clips.idleWalkRun} x={0} y={param('speed')} />, clips)}</state>
          <state name="jump">
            <clip sequence={clips.jump} loop={false} />
          </state>
          <state name="fall">
            <clip sequence={clips.fall} />
          </state>
          <state name="land">
            <clip sequence={clips.land} loop={false} />
          </state>
          <transition from="locomotion" to="jump" when={`falling && velocityZ > ${JUMP_VELOCITY}`} duration={0.15} blend="inertialization" />
          <transition from="locomotion" to="fall" when="falling" duration={0.3} blend="inertialization" />
          <transition from="jump" to="land" when="!falling" duration={0.1} blend="inertialization" />
          <transition from="jump" to="fall" when="timeRemaining < 0.2" duration={0.2} blend="inertialization" />
          <transition from="fall" to="land" when="!falling" duration={0.1} blend="inertialization" />
          <transition from="land" to="locomotion" when={`speed > ${MOVING_SPEED} || timeRemaining < ${LAND_SETTLE_SECONDS}`} duration={LAND_SETTLE_SECONDS} blend="inertialization" />
          {clips.climb && (
            <state name="climb">
              <clip sequence={clips.climb} loop={false} />
            </state>
          )}
          {clips.climb && <transition from="locomotion" to="climb" when="climbing" duration={0.15} blend="inertialization" />}
          {clips.climb && <transition from="climb" to="locomotion" when="!climbing" duration={0.3} blend="inertialization" />}
        </stateMachine>
      </slot>
    </inertialize>
  );
}
