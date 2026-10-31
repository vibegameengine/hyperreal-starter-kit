import type * as UE from 'ue';
import type { ReactNode, Ref } from 'react';
import { param } from '../../../shared/react';


const ANIMS = '/Game/Characters/Mannequins/Anims/Unarmed';
export interface LocomotionClips {
  idleWalkRun: string;
  jump: string;
  fall: string;
  land: string;
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

const MOVING_SPEED = 50;
const JUMP_VELOCITY = 100;

export function setLocomotion(graph: UE.VgeAnimInstance | null, movement: UE.CharacterMovementComponent) {
  if (!graph) return;
  const velocity = movement.Velocity;
  graph.SetFloat('speed', Math.hypot(velocity.X, velocity.Y));
  graph.SetFloat('velocityZ', velocity.Z);
  graph.SetBool('falling', movement.IsFalling());
}

export interface MannequinLocomotionProps {
  graph: Ref<UE.VgeAnimInstance>;
  clips?: LocomotionClips;
  ground?: ReactNode;
  finish?: (pose: ReactNode) => ReactNode;
}

const asIs = (pose: ReactNode) => pose;

export function MannequinLocomotion({ graph, clips = MANNY_LOCOMOTION, ground, finish = asIs }: MannequinLocomotionProps) {
  return <animGraph ref={graph}>{finish(<Locomotion clips={clips} ground={ground} />)}</animGraph>;
}

function Locomotion({ clips, ground }: { clips: LocomotionClips; ground?: ReactNode }) {
  return (
    <>
      <inertialize>
        <slot name="DefaultSlot">
          <stateMachine entry="locomotion">
            <state name="locomotion">{ground ?? <blendSpace blendSpace={clips.idleWalkRun} x={0} y={param('speed')} />}</state>
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
            <transition from="land" to="locomotion" when={`speed > ${MOVING_SPEED} || timeRemaining < 0.25`} duration={0.25} blend="inertialization" />
          </stateMachine>
        </slot>
      </inertialize>
    </>
  );
}
