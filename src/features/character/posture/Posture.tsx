import { memo, useState, type ReactNode } from 'react';
import { useFrame } from '../../../shared/react';

const MODIFY_BONE = '/Script/AnimGraphRuntime.AnimNode_ModifyBone';
const VISIBLE_DEGREES = 0.5;

export interface BoneTurn {
  bone: string;
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export interface PostureProps {
  turns: readonly BoneTurn[];
  children: ReactNode;
}

export function Posture({ turns, children }: PostureProps) {
  return turns.reduceRight<ReactNode>(
    (pose, { bone, roll = 0, pitch = 0, yaw = 0 }) => (
      <control node={MODIFY_BONE} BoneToModify={{ BoneName: bone }} Rotation={{ Roll: roll, Pitch: pitch, Yaw: yaw }} RotationMode="BMM_Additive" RotationSpace="BCS_ComponentSpace">
        {pose}
      </control>
    ),
    children,
  );
}

export interface PostureSource {
  at(deltaSeconds: number): readonly BoneTurn[];
}

const visible = (degrees = 0) => Math.round(degrees / VISIBLE_DEGREES) * VISIBLE_DEGREES;
const visibleTurns = (turns: readonly BoneTurn[]) => turns.map(({ bone, roll, pitch, yaw }) => ({ bone, roll: visible(roll), pitch: visible(pitch), yaw: visible(yaw) }));
const sameTurns = (a: readonly BoneTurn[], b: readonly BoneTurn[]) => a.length === b.length && a.every((turn, index) => turn.bone === b[index].bone && turn.roll === b[index].roll && turn.pitch === b[index].pitch && turn.yaw === b[index].yaw);

export interface LivePostureProps {
  source: PostureSource;
  children: ReactNode;
}

export const LivePosture = memo(function LivePosture({ source, children }: LivePostureProps) {
  const [turns, setTurns] = useState(() => visibleTurns(source.at(0)));
  useFrame((deltaSeconds) => {
    const next = visibleTurns(source.at(deltaSeconds));
    if (!sameTurns(next, turns)) setTurns(next);
  });
  return <Posture turns={turns}>{children}</Posture>;
});

export const spreadApart = (left: string, right: string, degrees: number): BoneTurn[] => [
  { bone: left, pitch: degrees },
  { bone: right, pitch: -degrees },
];

export interface LimbSpread {
  arm: number;
  leg: number;
}

export interface ClipSpreadOptions {
  perClip: Readonly<Record<string, Partial<LimbSpread>>>;
  fallback: LimbSpread;
  currentClip: () => string | undefined;
  arms: readonly [string, string];
  legs: readonly [string, string];
}

const SPREAD_EASE_PER_SECOND = 8;

export function clipSpreadPosture({ perClip, fallback, currentClip, arms, legs }: ClipSpreadOptions): PostureSource {
  let shown = fallback;
  return {
    at(deltaSeconds) {
      const own = perClip[currentClip() ?? ''];
      const step = Math.min(1, deltaSeconds * SPREAD_EASE_PER_SECOND);
      const ease = (from: number, to: number) => from + (to - from) * step;
      shown = { arm: ease(shown.arm, own?.arm ?? fallback.arm), leg: ease(shown.leg, own?.leg ?? fallback.leg) };
      return [...spreadApart(arms[0], arms[1], shown.arm), ...spreadApart(legs[0], legs[1], shown.leg)];
    },
  };
}
