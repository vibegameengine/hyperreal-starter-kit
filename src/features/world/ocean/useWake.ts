import * as UE from 'ue';
import { useEffect, useMemo, useRef } from 'react';
import { world } from '../../../shared/engine/world';
import { useCompute, useFrame } from '../../../shared/react';
import { oceanWakeColumns, oceanWakeInverse, oceanWakeRows } from '../assets/ocean/oceanWake';
import { WAKE_CELL, WAKE_RES } from '../assets/ocean/wakeSpec';
import { groundAt } from './breakerStations';
import type { ShoreTextures } from './Ocean';
import type { ShoreFieldData } from './shoreField';

const CM = 100;
const HALF = WAKE_RES / 2;
const WINDOW_BOX = 170;
const GRAVITY = 9.81;
const LEG_RADIUS = 0.12;
const STATIC_HEAD = 0.03;
const DYNAMIC_PRESSURE = 0.35;
const FULL_DEPTH = 0.3;
const MAX_LEG_SPEED = 3;
const SETTLE_SECONDS = 40;
const WAKE_PASS_PRIORITY = 10;
const SOURCE = { visc: 0.006, boil: 1.2, foamGain: 0.35, churn: 1 } as const;

const wakeTarget = (format = UE.ETextureRenderTargetFormat.RTF_RGBA32f) =>
  UE.KismetRenderingLibrary.CreateRenderTarget2D(world, WAKE_RES, WAKE_RES, format, new UE.LinearColor(0, 0, 0, 0), false, true);

export interface WakeSurface {
  display: UE.TextureRenderTarget2D;
  window: { current: UE.LinearColor };
}

interface LegState {
  previous?: UE.Vector;
}

interface WakeState {
  centre?: [number, number];
  origin: [number, number];
  reset: boolean;
  idle: number;
  started?: unknown;
  legs: [LegState, LegState];
}

function legSource(data: ShoreFieldData, mesh: UE.SkeletalMeshComponent, socket: string, leg: LegState, dt: number) {
  const at = mesh.GetSocketLocation(socket);
  const previous = leg.previous;
  leg.previous = at;
  const depth = -groundAt(data, at.X / CM, at.Y / CM);
  if (depth <= 0.02 || !previous || dt <= 0) return { param: new UE.LinearColor(0, 0, 0, LEG_RADIUS), speed: 0 };
  const speed = Math.min(MAX_LEG_SPEED, Math.hypot(at.X - previous.X, at.Y - previous.Y) / CM / dt);
  const immersed = Math.min(1, depth / FULL_DEPTH);
  const head = (STATIC_HEAD + (DYNAMIC_PRESSURE * speed * speed) / (2 * GRAVITY)) * immersed;
  return { param: new UE.LinearColor(at.X / CM, at.Y / CM, head, LEG_RADIUS), speed };
}

function moveWindow(state: WakeState, x: number, y: number) {
  const bx = x / WAKE_CELL;
  const by = y / WAKE_CELL;
  if (!state.centre || Math.abs(bx - state.centre[0]) > WAKE_RES || Math.abs(by - state.centre[1]) > WAKE_RES) {
    state.centre = [Math.round(bx), Math.round(by)];
    state.reset = true;
  }
  const c = state.centre;
  if (bx - c[0] > WINDOW_BOX) c[0] = Math.ceil(bx - WINDOW_BOX);
  if (c[0] - bx > WINDOW_BOX) c[0] = Math.floor(bx + WINDOW_BOX);
  if (by - c[1] > WINDOW_BOX) c[1] = Math.ceil(by - WINDOW_BOX);
  if (c[1] - by > WINDOW_BOX) c[1] = Math.floor(by + WINDOW_BOX);
  const previous = state.reset ? [c[0] - HALF, c[1] - HALF] : state.origin;
  state.origin = [c[0] - HALF, c[1] - HALF];
  return previous;
}

export function useWake(shore: ShoreTextures | undefined, surface: UE.MaterialInstanceDynamic | undefined) {
  const rows = useCompute(shore ? oceanWakeRows : undefined);
  const columns = useCompute(shore ? oceanWakeColumns : undefined);
  const inverse = useCompute(shore ? oceanWakeInverse : undefined);
  const targets = useMemo(() => ({ display: wakeTarget(UE.ETextureRenderTargetFormat.RTF_RGBA16f), state: wakeTarget(), scratch: wakeTarget(), spec: wakeTarget() }), []);
  const display = targets.display;
  const state = useRef<WakeState>({ origin: [0, 0], reset: true, idle: SETTLE_SECONDS, legs: [{}, {}] });
  const window = useRef(new UE.LinearColor(0, 0, 0, 0));
  useEffect(() => {
    if (!rows || !columns || !inverse || !shore) return;
    for (const pass of [rows, inverse]) {
      pass.component.SetTexture('Ground', shore.ground);
      pass.component.SetTexture('Field', shore.field);
      pass.component.SetTexture('State', targets.state);
      pass.component.SetTexture('Scratch', targets.scratch);
    }
    [rows, columns, inverse].forEach((pass, order) => {
      pass.component.SetTexture('Spec', targets.spec);
      pass.component.SetSortPriority(WAKE_PASS_PRIORITY + order);
    });
    rows.component.SetTexture('Display', display);
    state.current.reset = true;
  }, [rows, columns, inverse, shore, targets]);
  useEffect(() => {
    surface?.SetTextureParameterValue('OceanWake', display);
  }, [surface, display]);
  useFrame((dt) => {
    const pawn = UE.GameplayStatics.GetPlayerCharacter(world, 0);
    if (!rows || !columns || !inverse || !shore || !pawn?.Mesh) return;
    const current = state.current;
    if (current.started !== rows) current.reset = true;
    current.started = rows;
    const a = legSource(shore.data, pawn.Mesh, 'foot_l', current.legs[0], dt);
    const b = legSource(shore.data, pawn.Mesh, 'foot_r', current.legs[1], dt);
    if (current.idle > SETTLE_SECONDS && (a.param.B > 0 || b.param.B > 0)) current.reset = true;
    current.idle = a.param.B > 0 || b.param.B > 0 ? 0 : current.idle + dt;
    const amount = Math.min(1, Math.max(0, (SETTLE_SECONDS - current.idle) / 4));
    const at = pawn.K2_GetActorLocation();
    const previous = moveWindow(current, at.X / CM, at.Y / CM);
    const c = current.centre ?? [0, 0];
    window.current = new UE.LinearColor(c[0] * WAKE_CELL, c[1] * WAKE_CELL, amount, 0);
    surface?.SetVectorParameterValue('OceanWakeWindow', window.current);
    if (amount <= 0) return;
    const step = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    const params: [string, UE.LinearColor][] = [
      ['Window', new UE.LinearColor(current.origin[0], current.origin[1], previous[0], previous[1])],
      ['Step', new UE.LinearColor(step, current.reset ? 1 : 0, UE.GameplayStatics.GetTimeSeconds(world), amount)],
      ['LegA', a.param],
      ['LegB', b.param],
      ['Source', new UE.LinearColor(SOURCE.visc, SOURCE.boil, SOURCE.foamGain, SOURCE.churn)],
    ];
    for (const pass of [rows, columns, inverse]) {
      for (const [name, value] of params) pass.component.SetParam(name, value);
      pass.component.Execute();
    }
    current.reset = false;
  });
  return useMemo<WakeSurface>(() => ({ display, window }), [display]);
}
