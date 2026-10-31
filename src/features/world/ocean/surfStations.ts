import { SHORE, SHORE_EXTENT, SHORE_ORIGIN, SWELL_DIRECTION } from '../assets/ocean/oceanShore';
import type { ShoreFieldData } from './shoreField';

export const STATION_COUNT = 9;
const STATION_GAP = 11;
const WATERLINE_SEARCH = 400;
const SNAP_SEARCH = 60;
const MIN_EXPOSURE = 0.03;
const BORE_APPROACH = 0.08;
const TURN_GAIN = 10 ** (-3 / 20);
const BED_FLOOR = 10 ** (-11 / 20);
const NEAR_REFERENCE = 5;
const NEAR_ROLLOFF = 0.8;
const BED_DISTANCE_HALF = 200;

export interface SurfStation {
  x: number;
  y: number;
  exposure: number;
  along: number;
  tShore: number;
}

export interface StationLevel {
  phase: number;
  envelope: number;
  volume: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const fract = (value: number) => value - Math.floor(value);

function bilinear(values: Float32Array, res: number, x: number, y: number, channel: number) {
  const fx = clamp(((x - SHORE_ORIGIN) / SHORE_EXTENT) * res - 0.5, 0, res - 1.001);
  const fy = clamp(((y - SHORE_ORIGIN) / SHORE_EXTENT) * res - 0.5, 0, res - 1.001);
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const at = (a: number, b: number) => values[(b * res + a) * 4 + channel];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

export class ShoreSampler {
  constructor(private readonly data: ShoreFieldData) {}

  land(x: number, y: number) {
    return bilinear(this.data.ground, this.data.res, x, y, 0);
  }

  along(x: number, y: number) {
    return bilinear(this.data.ground, this.data.res, x, y, 2);
  }

  field(x: number, y: number) {
    const res = this.data.fieldRes;
    const field = this.data.field;
    return [0, 1, 2, 3].map((channel) => bilinear(field, res, x, y, channel)) as [arrival: number, dirX: number, dirY: number, tShore: number];
  }
}

function bar(along: number) {
  const w = Math.sin(along * 0.021 + 1.9) * 1.4 + Math.sin(along * 0.009 + 0.3) * 0.9;
  const r = Math.sin(along * 0.059 + w);
  const width = 0.8 + Math.sin(along * 0.017 + 4.1) * 0.08;
  const rip = smoothstep(width, 0.985, r);
  const level = 0.9 + (Math.sin(along * 0.031 + 7.3) * 0.6 + Math.sin(along * 0.083 + 1.1) * 0.4) * 0.14;
  return [level * (1 - rip * 0.58), rip] as const;
}

export function wobble(along: number) {
  return (
    Math.sin(along * 0.029 + 0.7) * 0.07 +
    Math.sin(along * 0.083 + 2.1) * 0.035 +
    Math.sin(along * 0.19 + 0.4) * 0.022 +
    Math.sin(along * 0.37 + 2.6) * 0.011 +
    bar(along)[1] * 0.045
  );
}

export function waveAmp(m: number, along: number) {
  const waveSet = Math.abs(Math.sin((m * Math.PI) / 7)) * 0.6 + 0.55;
  const rnd = (fract(Math.sin(m * 127.1 + 311.7) * 43758.5453) - 0.5) * 2;
  const warp = Math.sin(along * 0.016 + m * 0.9) * 1.6;
  const a1 = Math.sin(along * 0.062 + m * 1.7 + warp);
  const a2 = Math.sin(along * 0.13 + m * 4.1 + 1.3 - warp * 0.7);
  const a3 = Math.sin(along * 0.29 + m * 2.3 + warp * 0.5) * 0.6 + Math.sin(along * 0.47 + m * 5.9 + 0.8) * 0.4;
  const alongV = a1 * 0.6 + a2 * 0.4 + a3 * 0.28;
  return Math.max(SHORE.amplitude * waveSet * (1 + rnd * SHORE.variation * 0.5 + alongV * SHORE.variation * 0.7) * bar(along)[0], 0.02);
}

function directionAt(sampler: ShoreSampler, x: number, y: number) {
  const [, dx, dy] = sampler.field(x, y);
  const exposure = Math.hypot(dx, dy);
  if (exposure > 1e-3) return { dx: dx / exposure, dy: dy / exposure, exposure };
  return { dx: SWELL_DIRECTION[0], dy: SWELL_DIRECTION[1], exposure };
}

function crossing(sampler: ShoreSampler, x: number, y: number, dx: number, dy: number, reach: number, step: number) {
  const startsOnLand = sampler.land(x, y) > 0;
  const sign = startsOnLand ? -1 : 1;
  for (let r = 0; r < reach; r += step) {
    const px = x + dx * sign * r;
    const py = y + dy * sign * r;
    if (sampler.land(px, py) > 0 !== startsOnLand) return { x: px, y: py };
  }
  return undefined;
}

function stationAt(sampler: ShoreSampler, x: number, y: number): SurfStation | undefined {
  const local = directionAt(sampler, x, y);
  if (local.exposure < MIN_EXPOSURE) return undefined;
  const edge = crossing(sampler, x, y, local.dx, local.dy, SNAP_SEARCH, 0.5);
  if (!edge) return undefined;
  const [arrival, dx, dy, tShore] = sampler.field(edge.x, edge.y);
  if (arrival >= 1e4 || tShore >= 1e4) return undefined;
  const exposure = clamp(Math.hypot(dx, dy) * 1.4, 0, 1);
  return {
    x: edge.x,
    y: edge.y,
    exposure,
    along: sampler.along(edge.x, edge.y),
    tShore,
  };
}

export function buildStations(sampler: ShoreSampler, listenerX: number, listenerY: number) {
  const { dx, dy } = directionAt(sampler, listenerX, listenerY);
  const waterline = crossing(sampler, listenerX, listenerY, dx, dy, WATERLINE_SEARCH, 1.5);
  if (!waterline) return undefined;
  const stations: SurfStation[] = [];
  for (let k = 0; k < STATION_COUNT; k++) {
    const offset = (k - (STATION_COUNT - 1) / 2) * STATION_GAP;
    const station = stationAt(sampler, waterline.x - dy * offset, waterline.y + dx * offset);
    if (station) stations.push(station);
  }
  return stations;
}

function waveEnvelope(phase: number) {
  const up = SHORE.swashUp;
  if (phase < -BORE_APPROACH || phase >= up + SHORE.swashDown) return 0;
  if (phase < 0) return smoothstep(-BORE_APPROACH, 0, phase);
  if (phase < up) return 1 + (TURN_GAIN - 1) * (phase / up);
  return TURN_GAIN * (1 - smoothstep(up, up + SHORE.swashDown, phase));
}

function waveLoudness(m: number, station: SurfStation) {
  const relative = waveAmp(m, station.along) / SHORE.amplitude;
  return 10 ** ((16 * Math.log10(clamp(relative * station.exposure, 0.05, 3))) / 20);
}

export function swashPhase(station: SurfStation, time: number) {
  return (time - station.tShore) / SHORE.period + wobble(station.along);
}

export function stationEnvelope(station: SurfStation, time: number) {
  const phase = swashPhase(station, time);
  const current = Math.floor(phase);
  let envelope = 0;
  for (let m = current - 1; m <= current + 1; m++) {
    envelope = Math.max(envelope, waveEnvelope(phase - m) * waveLoudness(m, station));
  }
  return { phase: phase - current, envelope };
}

const nearGain = (distance: number) => NEAR_REFERENCE / (NEAR_REFERENCE + NEAR_ROLLOFF * Math.max(distance - NEAR_REFERENCE, 0));

export function stationLevels(stations: SurfStation[], listener: readonly [number, number, number], seaLevel: number, time: number, bedVolume: number): StationLevel[] {
  const distances = stations.map((station) => Math.hypot(station.x - listener[0], station.y - listener[1], seaLevel - listener[2]));
  const gains = distances.map(nearGain);
  const norm = Math.sqrt(gains.reduce((sum, gain) => sum + gain * gain, 0)) || 1;
  const bed = bedVolume / (1 + Math.min(...distances) / BED_DISTANCE_HALF);
  return stations.map((station, index) => {
    const { phase, envelope } = stationEnvelope(station, time);
    return { phase, envelope, volume: ((bed * gains[index]) / norm) * (BED_FLOOR + (1 - BED_FLOOR) * envelope) };
  });
}
