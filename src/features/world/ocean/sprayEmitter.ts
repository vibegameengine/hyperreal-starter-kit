import * as UE from 'ue';
import { SPRAY, SPRAY_BODY_PARAMS, SPRAY_CPU, SPRAY_REQUEST_FLOATS, SPRAY_REQUEST_PARAMS, SPRAY_REQUESTS } from '../assets/ocean/spraySpec';

const CM = 100;
const VALUES_PER_PARAM = 4;

type Triple = [number, number, number];

export interface SprayEmitOptions {
  spread?: number;
  jitter?: number;
  life?: number;
  to?: UE.Vector;
  sizeJitter?: number;
}

export interface SprayBodyShape {
  zAft: number;
  zShoulder: number;
  zStem: number;
  halfBeam: number;
  wlShoulder: number;
  wlStem: number;
  wlHalfBeam: number;
  ySheerAft: number;
  ySheerStem: number;
  yBottom: number;
  boxMin: Triple;
  boxMax: Triple;
}

export type SprayKind = (typeof SPRAY)[keyof typeof SPRAY];

const toWaterAxes = (v: UE.Vector): Triple => [v.X / CM, v.Z / CM, v.Y / CM];
const directionAxes = (v: UE.Vector): Triple => [v.X, v.Z, v.Y];
const dot = (a: Triple, b: Triple) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function bodyFrame(transform: UE.Transform) {
  const rotation = transform.Rotator();
  const columns = [UE.KismetMathLibrary.GetRightVector(rotation), UE.KismetMathLibrary.GetUpVector(rotation), UE.KismetMathLibrary.GetForwardVector(rotation)].map(directionAxes);
  const origin = toWaterAxes(transform.GetLocation());
  const toWorld = [0, 1, 2].map((row) => new UE.LinearColor(columns[0][row], columns[1][row], columns[2][row], origin[row]));
  const toBody = columns.map((axis) => new UE.LinearColor(axis[0], axis[1], axis[2], -dot(axis, origin)));
  return { toWorld, toBody };
}

export function createSprayEmitter() {
  const requests = new Float32Array(SPRAY_REQUESTS * SPRAY_REQUEST_FLOATS);
  const state = { count: 0, particles: 0, cpuHead: 0 };
  const body = new Map<string, UE.LinearColor>(SPRAY_BODY_PARAMS.map((name) => [name, new UE.LinearColor(0, 0, 0, 0)]));
  body.set('BodyHull', new UE.LinearColor(0, 0, 1, 0));
  body.set('BodyHullWL', new UE.LinearColor(0, 1, 0, 0));
  body.set('BodySheer', new UE.LinearColor(0, 0, -1, 0));

  function emit(at: UE.Vector, velocity: UE.Vector, count: number, size = 0.04, kind: SprayKind = SPRAY.DROPLET, options: SprayEmitOptions = {}) {
    if (state.count >= SPRAY_REQUESTS || count <= 0) return;
    const n = Math.min(Math.round(count), SPRAY_CPU - state.particles);
    if (n <= 0) return;
    const { spread = 0.6, jitter = 0.05, life = kind === SPRAY.MIST ? 2.5 : 1.6, to, sizeJitter = 0.5 } = options;
    state.particles += n;
    const o = state.count * SPRAY_REQUEST_FLOATS;
    requests.set([...toWaterAxes(at), state.particles, ...toWaterAxes(to ?? at), size, ...toWaterAxes(velocity), kind, spread, jitter, life, sizeJitter], o);
    state.count++;
  }

  function emitAlongPoints(points: UE.Vector[], velocity: UE.Vector | UE.Vector[], countPerSegment: number, size = 0.04, kind: SprayKind = SPRAY.DROPLET, options: SprayEmitOptions = {}) {
    for (let i = 0; i + 1 < points.length; i++) {
      emit(points[i], Array.isArray(velocity) ? velocity[i] : velocity, countPerSegment, size, kind, { ...options, to: points[i + 1] });
    }
  }

  function setBodyShape(shape: SprayBodyShape) {
    body.set('BodyHull', new UE.LinearColor(shape.zAft, shape.zShoulder, shape.zStem, shape.halfBeam));
    body.set('BodyHullWL', new UE.LinearColor(shape.wlShoulder, shape.wlStem, shape.wlHalfBeam, 0));
    body.set('BodySheer', new UE.LinearColor(shape.ySheerAft, shape.ySheerStem, shape.yBottom, 0));
    body.set('BodyBoxMin', new UE.LinearColor(...shape.boxMin, 0));
    body.set('BodyBoxMax', new UE.LinearColor(...shape.boxMax, 0));
  }

  function setBody(transform: UE.Transform | null, velocity?: UE.Vector) {
    if (!transform) {
      body.set('BodyVel', new UE.LinearColor(0, 0, 0, 0));
      return;
    }
    const frame = bodyFrame(transform);
    frame.toWorld.forEach((row, k) => body.set(`BodyMat${k}`, row));
    frame.toBody.forEach((row, k) => body.set(`BodyInv${k}`, row));
    body.set('BodyVel', new UE.LinearColor(...(velocity ? toWaterAxes(velocity) : ([0, 0, 0] as Triple)), 1));
  }

  function flush(component: UE.VgeComputeComponent) {
    component.SetParam('SprayCpu', new UE.LinearColor(state.cpuHead, state.particles, state.count, 0));
    for (let k = 0; k < state.count * VALUES_PER_PARAM; k++) {
      const v = requests.subarray(k * VALUES_PER_PARAM, (k + 1) * VALUES_PER_PARAM);
      component.SetParam(SPRAY_REQUEST_PARAMS[k], new UE.LinearColor(v[0], v[1], v[2], v[3]));
    }
    body.forEach((value, name) => component.SetParam(name, value));
    state.cpuHead = (state.cpuHead + state.particles) % SPRAY_CPU;
    state.count = 0;
    state.particles = 0;
  }

  return { emit, emitAlongPoints, setBodyShape, setBody, flush };
}

export type SprayEmitter = ReturnType<typeof createSprayEmitter>;

const mounted = new Set<SprayEmitter>();

export const activeSprayEmitter = () => mounted.values().next().value;
export const mountSprayEmitter = (emitter: SprayEmitter) => {
  mounted.add(emitter);
  return () => {
    mounted.delete(emitter);
  };
};
