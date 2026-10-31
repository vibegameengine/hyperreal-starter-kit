import { SHORE_SIM_RES, WIND_SPEED } from './oceanSpectrum';

export const SPRAY_RING = 32768;
export const SPRAY_CPU = 8192;
export const SPRAY_TOTAL = SPRAY_RING + SPRAY_CPU;
export const SPRAY_COLUMNS = 256;
export const SPRAY_ROWS = SPRAY_TOTAL / SPRAY_COLUMNS;
export const SPRAY_REQUESTS = 32;
export const SPRAY_REQUEST_FLOATS = 16;
export const SPRAY_REQUEST_GROUPS = 4;
export const SPRAY_REQUESTS_PER_GROUP = (SPRAY_REQUESTS * 4) / SPRAY_REQUEST_GROUPS;
export const SPRAY_BODY_PARAMS = ['BodyMat0', 'BodyMat1', 'BodyMat2', 'BodyInv0', 'BodyInv1', 'BodyInv2', 'BodyVel', 'BodyHull', 'BodyHullWL', 'BodySheer', 'BodyBoxMin', 'BodyBoxMax'] as const;
export const SPRAY_REQUEST_PARAMS = Array.from({ length: SPRAY_REQUEST_GROUPS * SPRAY_REQUESTS_PER_GROUP }, (_, k) => `R${String(k).padStart(3, '0')}`);
export const SPRAY_EMIT_RANGE = 240;
export const SPRAY_BUDGET_START = 0.3;
export const SPRAY_BUDGET_WINDOW = 2.5;
export const SPRAY_HEAD_SAMPLES = 32;
export const SPRAY_HEAD_FIRST_SAMPLE = 2;
export const SPRAY_HEAD_TEXELS = SPRAY_HEAD_SAMPLES + SPRAY_HEAD_FIRST_SAMPLE;
export const SPRAY_EMITTED_WRAP = 1 << 20;
export const SPRAY_CREST_OCCURRENCES = 6;
export const SPRAY_OCCURRENCE_TEXELS = 8;
export const SPRAY_EMIT_TEXELS = 1 + SPRAY_CREST_OCCURRENCES * SPRAY_OCCURRENCE_TEXELS;
export const SPRAY_SCAN_THREADS = 1024;
export const SPRAY_DEPOSIT_TILE = 16;
export const SPRAY_DEPOSIT_RES = SHORE_SIM_RES;
export const SPRAY_DEPOSIT_GAIN = 0.02;
export const SPRAY_MAX_DISTANCE = 320;
export const SPRAY_WIND = { x: 0.35 / Math.hypot(0.35, 0.94), z: 0.94 / Math.hypot(0.35, 0.94), speed: WIND_SPEED } as const;

export const SPRAY_KIND = {
  tau: [3.0, 0.35, 5.0, 1.8, 2.5],
  grav: [9.81, 0.3, 9.81, 8.5, 9.81],
  turb: [0, 0.5, 0, 0.3, 0.1],
  grow: [0, 0.22, 0, 0.3, 0.7],
  dies: [1, 0, 1, 1, 1],
  deposit: [1, 0, 3, 4, 2],
  stretch: [1 / 40, 0, 1 / 40, 1 / 30, 1 / 60],
  alpha: [0.55, 0.06, 0.8, 0.66, 0.22],
  fadeIn: [0.02, 0.2, 0.02, 0.12, 0.02],
  fadeOut: [0.8, 0.45, 0.8, 0.7, 0.5],
} as const;

export const SPRAY = { DROPLET: 0, MIST: 1, LIGAMENT: 2, SPRAY: 3, SHEET: 4 } as const;

const literal = (value: number) => value.toFixed(6);

export const sprayByKind = (kind: string, values: readonly number[]) => `SprayByKind(${kind}, ${values.map(literal).join(', ')})`;
