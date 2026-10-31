import * as UE from 'ue';
import { world } from '../../../../shared/engine/world';

export const LIMITS = {
  groundedBall: 6,
  groundedHeel: 13,
  plantedBall: 3.5,
  touchdownBall: 5,
  swingBall: 12,
  moving: 50,
  swingForward: 15,
  slide: 30,
  stanceSlide: 2,
  airborne: 0.15,
  sink: -2,
  pelvis: [78, 102] as const,
  drift: 15,
};

const SIDES = [
  { heel: 'foot_l', ball: 'ball_l' },
  { heel: 'foot_r', ball: 'ball_r' },
];

export interface Foot {
  heel: number;
  ball: number;
  slide: number;
  low: boolean;
  planted: boolean;
}

export interface Body {
  ground: number;
  velocity?: UE.Vector;
  anchor?: UE.Vector;
}

export interface Pose {
  feet: Foot[];
  pelvis: number;
  drift: number;
  points: UE.Vector[];
}

export interface Motion {
  clip: string;
  clipTime: number;
  cost: number;
  continuing: boolean;
  playRate: number;
}

export interface Sample extends Motion {
  t: number;
  step: string;
  situation?: string;
  speed: number;
  pose: Pose;
}

export type ViolationKind = 'float' | 'hover' | 'sink' | 'slide' | 'pelvis' | 'drift';

export interface Violation {
  kind: ViolationKind;
  from: number;
  to: number;
  clip: string;
  clipTime: number;
  worst: number;
  detail: string;
}

const velocityOf = (from: UE.Vector, to: UE.Vector, dt: number): [number, number] => [(to.X - from.X) / Math.max(dt, 1e-4), (to.Y - from.Y) / Math.max(dt, 1e-4)];

function forwardOfBody([x, y]: [number, number], body: UE.Vector) {
  const speed = Math.hypot(body.X, body.Y);
  return speed < 1 ? 0 : ((x - body.X) * body.X + (y - body.Y) * body.Y) / speed;
}

export function measurePose(mesh: UE.SkeletalMeshComponent, { ground, velocity, anchor }: Body, previous: Pose | undefined, dt: number): Pose {
  const points = SIDES.flatMap((side) => [mesh.GetSocketLocation(side.heel), mesh.GetSocketLocation(side.ball)]);
  const feet = SIDES.map((_, index) => {
    const heelHeight = points[index * 2].Z - ground;
    const ballHeight = points[index * 2 + 1].Z - ground;
    const contact = ballHeight < LIMITS.plantedBall ? index * 2 + 1 : index * 2;
    const low = ballHeight < LIMITS.groundedBall || heelHeight < LIMITS.groundedHeel;
    const down = ballHeight < LIMITS.plantedBall;
    const before = previous?.points[contact];
    const moved = before ? velocityOf(before, points[contact], dt) : ([0, 0] as [number, number]);
    const swinging = velocity ? forwardOfBody(moved, velocity) > LIMITS.swingForward : false;
    return { heel: heelHeight, ball: ballHeight, slide: Math.hypot(...moved), low, planted: down && !swinging };
  });
  const pelvis = mesh.GetSocketLocation('pelvis');
  const drift = anchor ? Math.hypot(pelvis.X - anchor.X, pelvis.Y - anchor.Y) : 0;
  return { feet, pelvis: pelvis.Z - ground, drift, points };
}

export function parseMotion(description: string): Motion {
  const [clip = '', clipTime = '0', cost = '0', continuing = '0', playRate = '1'] = description.split('|');
  return { clip, clipTime: +clipTime, cost: +cost, continuing: continuing === '1', playRate: +playRate };
}

interface Mark {
  key: string;
  active: boolean;
  value: number;
  describe: (worst: number) => string;
  worse: (a: number, b: number) => number;
}

export class ViolationLog {
  readonly closed: Violation[] = [];
  private open = new Map<string, Violation>();
  private airborneSince: number | undefined;
  private lowest = [Infinity, Infinity];
  private stance: ({ from: number; clip: string; clipTime: number; start: [number, number]; end?: [number, number] } | undefined)[] = [undefined, undefined];

  constructor(private readonly slides = true) {}

  clear() {
    this.closed.length = 0;
    this.open.clear();
    this.airborneSince = undefined;
    this.lowest = [Infinity, Infinity];
    this.stance = [undefined, undefined];
  }

  all() {
    return [...this.closed, ...[...this.open.values()]].sort((a, b) => a.from - b.from);
  }

  add(sample: Sample) {
    const { pose } = sample;
    const lowest = Math.min(...pose.feet.map((foot) => Math.min(foot.heel, foot.ball)));
    if (pose.feet.some((foot) => foot.low)) this.airborneSince = undefined;
    else this.airborneSince ??= sample.t;
    const airborne = this.airborneSince === undefined ? 0 : sample.t - this.airborneSince;
    const marks: Mark[] = [
      {
        key: 'float',
        active: airborne > LIMITS.airborne,
        value: Math.min(...pose.feet.map((foot) => foot.ball)),
        describe: (worst) => `no foot on the ground, lowest ball ${worst.toFixed(0)} cm up`,
        worse: Math.max,
      },
      { key: 'sink', active: lowest < LIMITS.sink, value: lowest, describe: (worst) => `foot ${(-worst).toFixed(0)} cm under the ground`, worse: Math.min },
      { key: 'drift', active: pose.drift > LIMITS.drift, value: pose.drift, describe: (worst) => `body ${worst.toFixed(0)} cm off the capsule`, worse: Math.max },
      {
        key: 'pelvis',
        active: pose.pelvis < LIMITS.pelvis[0] || pose.pelvis > LIMITS.pelvis[1],
        value: pose.pelvis,
        describe: (worst) => `pelvis ${worst.toFixed(0)} cm above the ground`,
        worse: (a, b) => (Math.abs(a - (LIMITS.pelvis[0] + LIMITS.pelvis[1]) / 2) >= Math.abs(b - (LIMITS.pelvis[0] + LIMITS.pelvis[1]) / 2) ? a : b),
      },
    ];
    for (const mark of marks) this.mark(mark, sample);
    pose.feet.forEach((foot, index) => {
      this.touchdown(foot, index, sample);
      this.stanceSlide(foot, index, sample);
    });
  }

  private stanceSlide(foot: Foot, index: number, sample: Sample) {
    if (!this.slides) return;
    const ball = sample.pose.points[index * 2 + 1];
    const open = this.stance[index];
    if (foot.planted) {
      this.stance[index] = open ?? { from: sample.t, clip: sample.clip, clipTime: sample.clipTime, start: [ball.X, ball.Y] };
      if (open) open.end = [ball.X, ball.Y];
      return;
    }
    this.stance[index] = undefined;
    if (!open?.end) return;
    const travel = Math.hypot(open.end[0] - open.start[0], open.end[1] - open.start[1]);
    if (travel <= LIMITS.stanceSlide) return;
    const side = index ? 'right' : 'left';
    this.closed.push({ kind: 'slide', from: open.from, to: sample.t, clip: open.clip, clipTime: open.clipTime, worst: travel, detail: `${side} foot slid ${travel.toFixed(1)} cm over one stance` });
  }

  private touchdown(foot: Foot, index: number, sample: Sample) {
    if (foot.ball < LIMITS.swingBall) {
      this.lowest[index] = sample.speed >= LIMITS.moving ? Math.min(this.lowest[index], foot.ball) : Infinity;
      return;
    }
    const lowest = this.lowest[index];
    this.lowest[index] = Infinity;
    if (!Number.isFinite(lowest) || lowest <= LIMITS.touchdownBall) return;
    const side = index ? 'right' : 'left';
    this.closed.push({ kind: 'hover', from: sample.t, to: sample.t, clip: sample.clip, clipTime: sample.clipTime, worst: lowest, detail: `${side} foot step bottoms out ${lowest.toFixed(0)} cm above the ground` });
  }

  private mark({ key, active, value, describe, worse }: Mark, sample: Sample) {
    const violation = this.open.get(key);
    if (!active) {
      if (violation) {
        this.closed.push(violation);
        this.open.delete(key);
      }
      return;
    }
    if (!violation) {
      this.open.set(key, { kind: key.split(':')[0] as ViolationKind, from: sample.t, to: sample.t, clip: sample.clip, clipTime: sample.clipTime, worst: value, detail: describe(value) });
      return;
    }
    violation.to = sample.t;
    const next = worse(violation.worst, value);
    if (next !== violation.worst) {
      violation.worst = next;
      violation.clip = sample.clip;
      violation.clipTime = sample.clipTime;
    }
    violation.detail = describe(violation.worst);
  }
}

export interface Segment {
  clip: string;
  from: number;
  to: number;
}

export function segmentsOf(samples: Sample[]): Segment[] {
  const segments: Segment[] = [];
  for (const sample of samples) {
    const last = segments[segments.length - 1];
    if (last && last.clip === sample.clip) last.to = sample.t;
    else segments.push({ clip: sample.clip, from: sample.t, to: sample.t });
  }
  return segments;
}

const COLORS = {
  planted: new UE.LinearColor(0.1, 1, 0.2, 1),
  sliding: new UE.LinearColor(1, 0.1, 0.1, 1),
  lifted: new UE.LinearColor(1, 0.85, 0.1, 1),
  path: new UE.LinearColor(0.2, 0.6, 1, 1),
};

export function drawPose(pose: Pose) {
  pose.feet.forEach((foot, index) => {
    const color = !foot.planted ? COLORS.lifted : foot.slide > LIMITS.slide ? COLORS.sliding : COLORS.planted;
    for (const point of [pose.points[index * 2], pose.points[index * 2 + 1]]) UE.KismetSystemLibrary.DrawDebugSphere(world, point, 4, 8, color, 0, 1);
  });
}

export function drawPath(points: UE.Vector[]) {
  for (let index = 1; index < points.length; index++) UE.KismetSystemLibrary.DrawDebugLine(world, points[index - 1], points[index], COLORS.path, 0, 2);
}
