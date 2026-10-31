import * as UE from 'ue';
import { useEffect, useMemo, useRef } from 'react';
import { world } from '../../../shared/engine/world';
import { useCompute, useFrame } from '../../../shared/react';
import { coastHeight, SEA_LEVEL } from '../assets/coastShape';
import { sandTrail } from '../assets/sand/sandTrail.compute';
import { STILL_WATER_LIMIT_CM, TRAIL_RES } from '../assets/sand/sandTrailSpec';
import type { ShoreTextures } from '../ocean/Ocean';
import { landscapes } from './landscapes';

const CM = 100;
const PLANT_HEIGHT_CM = 7;
const SWING_SPEED_CM = 200;
const PLANT_SPEED_CM = 60;
const HEEL_TO_BALL = 0.55;
const STANCE_SLIP = 0.3;

const STAMP_HOLD_S = 0.2;

interface FootState {
  planted: boolean;
  previous?: UE.Vector;
  stamp?: Plant;
  stampLeft?: number;
}

interface Plant {
  x: number;
  y: number;
  yaw: number;
  side: number;
}

function footPlant(mesh: UE.SkeletalMeshComponent, foot: string, ball: string, side: number, state: FootState, dt: number, bodySpeed: number): Plant | undefined {
  const ankle = mesh.GetSocketLocation(foot);
  const toe = mesh.GetSocketLocation(ball);
  const ground = coastHeight(toe.X, toe.Y);
  const height = toe.Z - ground;
  const speed = state.previous && dt > 0 ? Math.hypot(toe.X - state.previous.X, toe.Y - state.previous.Y) / dt : 0;
  state.previous = toe;
  if (speed > SWING_SPEED_CM) state.planted = false;
  const stanceSpeed = Math.max(PLANT_SPEED_CM, bodySpeed * STANCE_SLIP);
  if (state.planted || height > PLANT_HEIGHT_CM || speed > stanceSpeed || SEA_LEVEL - ground > STILL_WATER_LIMIT_CM) return undefined;
  state.planted = true;
  const x = ankle.X + (toe.X - ankle.X) * HEEL_TO_BALL;
  const y = ankle.Y + (toe.Y - ankle.Y) * HEEL_TO_BALL;
  return { x: x / CM, y: y / CM, yaw: Math.atan2(toe.Y - ankle.Y, toe.X - ankle.X), side };
}

function heldStamp(plant: Plant | undefined, state: FootState, dt: number) {
  if (plant) {
    state.stamp = plant;
    state.stampLeft = STAMP_HOLD_S;
  } else {
    state.stampLeft = (state.stampLeft ?? 0) - dt;
  }
  return (state.stampLeft ?? 0) > 0 ? state.stamp : undefined;
}

const footParam = (plant: Plant | undefined) => (plant ? new UE.LinearColor(plant.x, plant.y, plant.yaw, plant.side) : new UE.LinearColor(0, 0, 0, 0));

function useTrailOnSand(trail: UE.TextureRenderTarget2D, centre: { current: [number, number] }) {
  const fed = useMemo(() => new Set<UE.LandscapeProxy>(), [trail]);
  useFrame(() => {
    for (const landscape of landscapes()) {
      if (!fed.has(landscape)) {
        landscape.SetLandscapeMaterialTextureParameterValue('SandTrail', trail);
        fed.add(landscape);
      }
      landscape.SetLandscapeMaterialVectorParameterValue('SandTrailWindow', new UE.LinearColor(centre.current[0], centre.current[1], 1, 0));
    }
  });
}

export function useSandTrail(shore: ShoreTextures) {
  const compute = useCompute(sandTrail);
  const trail = useMemo(() => UE.KismetRenderingLibrary.CreateRenderTarget2D(world, TRAIL_RES, TRAIL_RES, UE.ETextureRenderTargetFormat.RTF_RGBA16f, new UE.LinearColor(0, 0, 0, 0), false, true), []);
  const feet = useRef({ left: {} as FootState, right: {} as FootState, started: undefined as unknown, frame: 0 });
  const centre = useRef<[number, number]>([0, 0]);
  useEffect(() => {
    if (!compute) return;
    compute.component.SetTexture('Trail', trail);
    compute.component.SetTexture('State', shore.state);
  }, [compute, trail, shore]);
  useTrailOnSand(trail, centre);
  useFrame((dt) => {
    const pawn = UE.GameplayStatics.GetPlayerCharacter(world, 0);
    if (!compute || !pawn?.Mesh) return;
    const at = pawn.K2_GetActorLocation();
    centre.current = [at.X / CM, at.Y / CM];
    const current = feet.current;
    const reset = current.started === compute ? 0 : 1;
    current.started = compute;
    const velocity = pawn.GetVelocity();
    const bodySpeed = Math.hypot(velocity.X, velocity.Y);
    const left = heldStamp(footPlant(pawn.Mesh, 'foot_l', 'ball_l', -1, current.left, dt, bodySpeed), current.left, dt);
    const right = heldStamp(footPlant(pawn.Mesh, 'foot_r', 'ball_r', 1, current.right, dt, bodySpeed), current.right, dt);
    compute.component.SetParam('Window', new UE.LinearColor(centre.current[0], centre.current[1], reset, Math.min(dt, 0.1)));
    compute.component.SetParam('FootA', footParam(left));
    compute.component.SetParam('FootB', footParam(right));
    current.frame += 1;
    compute.component.SetParam('Step', new UE.LinearColor(current.frame % 2, 0, 0, 0));
    compute.component.Execute();
  });
}
