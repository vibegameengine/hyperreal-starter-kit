export interface LandingTimings {
  touchdown: number;
  absorb: number;
  settle: number;
}

export interface ClipFrame {
  time: number;
  pelvis: number;
  lift: readonly number[];
}

const LIFT_CM = 2;
const SETTLE_CM = 2;

export function landingTimingsOf(frames: readonly ClipFrame[]): LandingTimings | undefined {
  if (!frames.length) return undefined;
  const lifted = (frame: ClipFrame) => frame.lift.some((lift) => lift > LIFT_CM);
  const grounded = (frame: ClipFrame) => frame.lift.every((lift) => lift <= LIFT_CM);
  const airborne = frames.findIndex((frame) => frame.lift.every((lift) => lift > LIFT_CM));
  const touchdown = grounded(frames[0]) && !frames.some(lifted) ? 0 : frames.findIndex((frame, index) => airborne >= 0 && index > airborne && grounded(frame));
  const lowest = frames.reduce((best, frame, index) => (frame.pelvis < frames[best].pelvis ? index : best), 0);
  const final = frames[frames.length - 1].pelvis;
  const settle = frames.findIndex((frame, index) => index >= lowest && Math.abs(frame.pelvis - final) <= SETTLE_CM);
  const at = (index: number, fallback: number) => (index >= 0 ? frames[index].time : fallback);
  return { touchdown: at(touchdown, 0), absorb: at(lowest, 0), settle: at(settle, frames[frames.length - 1].time) };
}

export const REACH_SECONDS = 0.25;
const GRAVITY = 980;
export const MIN_FALL_SECONDS = Math.sqrt((2 * 20) / GRAVITY);
export const LIGHT_LAND_SPEED = GRAVITY * MIN_FALL_SECONDS;
const RUNNING_LANDING_FROM = 100;
const RUNNING_LANDING_TO = 350;
const UNFELT_LANDING_WEIGHT = 0.05;
const SHORTEST_LANDING_PHASE_SECONDS = 0.1;

export const smoothStep = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / Math.max(1e-6, to - from)));
  return t * t * (3 - 2 * t);
};

export function timeToLand(distance: number | undefined, verticalSpeed: number, gravity: number) {
  if (distance === undefined || gravity <= 0) return undefined;
  return (verticalSpeed + Math.sqrt(verticalSpeed * verticalSpeed + 2 * gravity * Math.max(0, distance))) / gravity;
}

export function landWeightFor(impactSpeed: number, groundSpeed: number, jumpSpeed: number) {
  const span = Math.max(1e-6, jumpSpeed - LIGHT_LAND_SPEED);
  const impact = Math.min(1, Math.max(0, (impactSpeed - LIGHT_LAND_SPEED) / span));
  return impact * (1 - smoothStep(RUNNING_LANDING_FROM, RUNNING_LANDING_TO, groundSpeed));
}

function landingWindow(moving: boolean, timings: LandingTimings): readonly [number, number] {
  const end = Math.max(timings.settle, timings.absorb + SHORTEST_LANDING_PHASE_SECONDS);
  return moving ? [timings.absorb, end] : [(timings.absorb + end) / 2, end];
}

export function landingEnd(landWeight: number, moving: boolean, timings: LandingTimings) {
  if (landWeight < UNFELT_LANDING_WEIGHT) return Math.max(timings.absorb, timings.touchdown + SHORTEST_LANDING_PHASE_SECONDS);
  return landingWindow(moving, timings)[1];
}

export function landingLayerWeight(clipTime: number, landWeight: number, moving: boolean, timings: LandingTimings) {
  const [start, end] = landingWindow(moving, timings);
  const absorbed = smoothStep(timings.touchdown, Math.max(timings.absorb, timings.touchdown + SHORTEST_LANDING_PHASE_SECONDS), clipTime);
  return (1 + (landWeight - 1) * absorbed) * (1 - smoothStep(start, end, clipTime));
}
