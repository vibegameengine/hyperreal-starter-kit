import * as UE from 'ue';
import { world } from '../../../../shared/engine/world';
import { motionDatabaseOf } from '../../../../shared/react/motionMatching';

export interface Step {
  until: number;
  name: string;
  direction: [number, number];
  input: number;
}

export const SCENARIO: Step[] = [
  { until: 2, name: 'idle', direction: [1, 0], input: 0 },
  { until: 5, name: 'walk forward', direction: [1, 0], input: 0.5 },
  { until: 8, name: 'run forward', direction: [1, 0], input: 1 },
  { until: 10, name: 'stop', direction: [1, 0], input: 0 },
  { until: 13, name: 'walk right (turn 90)', direction: [0, 1], input: 0.5 },
  { until: 16, name: 'run back (turn 180)', direction: [0, -1], input: 1 },
  { until: 18, name: 'stop', direction: [0, -1], input: 0 },
];

export type Mode = 'scenario' | 'drive' | 'clip';
export type View = 'side' | 'front' | 'behind' | 'top' | 'player';
export type Clip = { name: string; path: string };

export const START: [number, number, number] = [0, 0, 100];
export const VIEWER_AT: [number, number, number] = [-1500, -1500, 0];
export const CAPSULE_HALF_HEIGHT = 88;
export const CAMERA_DISTANCE = 380;
export const CAMERA_HEIGHT = 90;
export const TIME_SCALES = [1, 0.25, 0.1];

export const pawnOf = () => UE.GameplayStatics.GetPlayerPawn(world, 0) as UE.Character | undefined;

export function linkedInstance(pawn: UE.Character) {
  const graph = pawn.Mesh.GetAnimInstance() as UE.VgeAnimInstance;
  const description = graph?.DescribeGraph() ?? '';
  const id = /linkedGraph#(\d+)/.exec(description)?.[1];
  return id ? graph.GetLinkedInstance(id) : undefined;
}

export function databaseClips(graphClass: string | undefined): Clip[] {
  const database = motionDatabaseOf(graphClass);
  if (!database) return [];
  return Array.from({ length: database.GetNumAnimationAssets() }, (_, index) => database.GetAnimationAsset(index))
    .filter((asset): asset is UE.Object => !!asset)
    .map((asset) => ({ name: asset.GetName(), path: UE.KismetSystemLibrary.GetPathName(asset) }));
}
