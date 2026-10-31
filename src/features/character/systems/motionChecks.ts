export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface BoneSample {
  local: Quat;
  body: Vec3;
  world: Vec3;
}

export interface MotionFrame {
  time: number;
  deltaSeconds: number;
  clip: string;
  clipTime: number;
  situation: string;
  speed: number;
  yaw: number;
  bones: Readonly<Record<string, BoneSample>>;
}

export interface LegNames {
  hip: string;
  knee: string;
  foot: string;
}

export interface CheckLimits {
  rotationJerkDegrees: number;
  positionJerkCm: number;
  plantDriftCm: number;
  plantSpeedCm: number;
  plantHeightCm: number;
  minKneeDegrees: number;
  maxKneeDegrees: number;
  hitchSeconds: number;
}

export const DEFAULT_LIMITS: CheckLimits = {
  rotationJerkDegrees: 12,
  positionJerkCm: 3,
  plantDriftCm: 2,
  plantSpeedCm: 25,
  plantHeightCm: 6,
  minKneeDegrees: 3,
  maxKneeDegrees: 178,
  hitchSeconds: 0.04,
};

export type FindingKind = 'rotation-pop' | 'position-pop' | 'foot-slide' | 'knee' | 'hitch';

export interface Finding {
  kind: FindingKind;
  time: number;
  bone: string;
  value: number;
  clip: string;
  situation: string;
  clipValue?: number;
}

const REFERENCE_DELTA = 1 / 60;

const angleBetween = (a: Quat, b: Quat) => (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const perReferenceFrame = (value: number, deltaSeconds: number) => (value * REFERENCE_DELTA) / Math.max(1e-4, deltaSeconds);

function finding(kind: FindingKind, frame: MotionFrame, bone: string, value: number): Finding {
  return { kind, time: frame.time, bone, value, clip: frame.clip, situation: frame.situation };
}

function pops(frames: readonly MotionFrame[], limits: CheckLimits): Finding[] {
  const found: Finding[] = [];
  for (let index = 2; index < frames.length; index++) {
    const [before, middle, now] = [frames[index - 2], frames[index - 1], frames[index]];
    if (middle.deltaSeconds > limits.hitchSeconds || now.deltaSeconds > limits.hitchSeconds) continue;
    for (const bone of Object.keys(now.bones)) {
      const [a, b, c] = [before.bones[bone], middle.bones[bone], now.bones[bone]];
      if (!a || !b || !c) continue;
      const turn = Math.abs(perReferenceFrame(angleBetween(b.local, c.local), now.deltaSeconds) - perReferenceFrame(angleBetween(a.local, b.local), middle.deltaSeconds));
      if (turn > limits.rotationJerkDegrees) found.push(finding('rotation-pop', now, bone, turn));
      const move = Math.abs(perReferenceFrame(distance(b.body, c.body), now.deltaSeconds) - perReferenceFrame(distance(a.body, b.body), middle.deltaSeconds));
      if (move > limits.positionJerkCm) found.push(finding('position-pop', now, bone, move));
    }
  }
  return found;
}

function footSlides(frames: readonly MotionFrame[], foot: string, limits: CheckLimits): Finding[] {
  const found: Finding[] = [];
  const groundZ = Math.min(...frames.map((frame) => frame.bones[foot]?.world[2] ?? Infinity));
  let anchor: { frame: MotionFrame; at: Vec3 } | undefined;
  for (let index = 1; index < frames.length; index++) {
    const now = frames[index].bones[foot];
    const before = frames[index - 1].bones[foot];
    if (!now || !before) continue;
    const speed = Math.hypot(now.world[0] - before.world[0], now.world[1] - before.world[1]) / Math.max(1e-4, frames[index].deltaSeconds);
    const planted = speed < limits.plantSpeedCm && now.world[2] - groundZ < limits.plantHeightCm;
    if (!planted) {
      anchor = undefined;
      continue;
    }
    anchor ??= { frame: frames[index], at: now.world };
    const drift = Math.hypot(now.world[0] - anchor.at[0], now.world[1] - anchor.at[1]);
    if (drift > limits.plantDriftCm) {
      found.push(finding('foot-slide', frames[index], foot, drift));
      anchor = { frame: frames[index], at: now.world };
    }
  }
  return found;
}

function kneeDegrees(frame: MotionFrame, leg: LegNames) {
  const [hip, knee, foot] = [frame.bones[leg.hip]?.body, frame.bones[leg.knee]?.body, frame.bones[leg.foot]?.body];
  if (!hip || !knee || !foot) return undefined;
  const thigh = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
  const shin = [foot[0] - knee[0], foot[1] - knee[1], foot[2] - knee[2]];
  const cos = (thigh[0] * shin[0] + thigh[1] * shin[1] + thigh[2] * shin[2]) / Math.max(1e-6, Math.hypot(...thigh) * Math.hypot(...shin));
  return 180 - (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function knees(frames: readonly MotionFrame[], legs: readonly LegNames[], limits: CheckLimits): Finding[] {
  return frames.flatMap((frame) =>
    legs.flatMap((leg) => {
      const angle = kneeDegrees(frame, leg);
      return angle !== undefined && (angle < limits.minKneeDegrees || angle > limits.maxKneeDegrees) ? [finding('knee', frame, leg.knee, angle)] : [];
    }),
  );
}

export type ClipBonePosition = (clip: string, bone: string, clipTime: number) => Vec3 | undefined;

function clipPop(frames: readonly MotionFrame[], index: number, bone: string, positionOf: ClipBonePosition) {
  const [before, middle, now] = [frames[index - 2], frames[index - 1], frames[index]];
  if (!before || before.clip !== now.clip || middle.clip !== now.clip) return undefined;
  const [a, b, c] = [before, middle, now].map((frame) => positionOf(frame.clip, bone, frame.clipTime));
  if (!a || !b || !c) return undefined;
  return Math.abs(perReferenceFrame(distance(b, c), now.deltaSeconds) - perReferenceFrame(distance(a, b), middle.deltaSeconds));
}

export function withClipValues(findings: readonly Finding[], frames: readonly MotionFrame[], positionOf: ClipBonePosition): Finding[] {
  const indexAt = new Map(frames.map((frame, index) => [frame.time, index]));
  return findings.map((item) => {
    const index = indexAt.get(item.time);
    return item.kind === 'position-pop' && index !== undefined ? { ...item, clipValue: clipPop(frames, index, item.bone, positionOf) } : item;
  });
}

const hitches =(frames: readonly MotionFrame[], limits: CheckLimits) => frames.filter((frame) => frame.deltaSeconds > limits.hitchSeconds).map((frame) => finding('hitch', frame, '', frame.deltaSeconds * 1000));

export interface ClipChange {
  time: number;
  clip: string;
  clipTime: number;
  situation: string;
  speed: number;
  yaw: number;
}

export interface MotionReport {
  frames: number;
  seconds: number;
  counts: Readonly<Record<FindingKind, number>>;
  worst: readonly Finding[];
  byClip: Readonly<Record<string, number>>;
  timeline: readonly ClipChange[];
}

export interface MotionCheck {
  legs: readonly LegNames[];
  limits?: CheckLimits;
  keep?: number;
  clipPosition?: ClipBonePosition;
}

function timelineOf(frames: readonly MotionFrame[]): ClipChange[] {
  return frames.filter((frame, index) => index === 0 || frame.clip !== frames[index - 1].clip || frame.situation !== frames[index - 1].situation).map(({ time, clip, clipTime, situation, speed, yaw }) => ({ time, clip, clipTime, situation, speed, yaw }));
}

export function checkMotion(frames: readonly MotionFrame[], { legs, limits = DEFAULT_LIMITS, keep = 25, clipPosition }: MotionCheck): MotionReport {
  const all = [...pops(frames, limits), ...legs.flatMap((leg) => footSlides(frames, leg.foot, limits)), ...knees(frames, legs, limits), ...hitches(frames, limits)];
  const counts = { 'rotation-pop': 0, 'position-pop': 0, 'foot-slide': 0, knee: 0, hitch: 0 } as Record<FindingKind, number>;
  const byClip: Record<string, number> = {};
  for (const item of all) {
    counts[item.kind] += 1;
    if (item.kind !== 'hitch') byClip[item.clip] = (byClip[item.clip] ?? 0) + 1;
  }
  const ranked = [...all].filter((item) => item.kind !== 'hitch').sort((a, b) => b.value - a.value).slice(0, keep);
  const worst = clipPosition ? withClipValues(ranked, frames, clipPosition) : ranked;
  const seconds = frames.length ? frames[frames.length - 1].time - frames[0].time : 0;
  return { frames: frames.length, seconds, counts, worst, byClip, timeline: timelineOf(frames) };
}
