import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { world } from '../../../shared/engine/world';

export type TraversalKind = 'vault' | 'mantle' | 'climb';

export interface Ledge {
  top: UE.Vector;
  normal: UE.Vector;
  height: number;
  depth: number;
  distance: number;
}

export interface TraversalAction {
  kind: TraversalKind;
  ledge: Ledge;
  fitness: number;
}

export interface TraversalRange {
  kind: TraversalKind;
  minHeight: number;
  maxHeight: number;
  minDepth: number;
  maxDistance: number;
  preferredHeight: number;
}

export const TRAVERSAL_RANGES: readonly TraversalRange[] = [
  { kind: 'vault', minHeight: 40, maxHeight: 110, minDepth: 5, maxDistance: 120, preferredHeight: 90 },
  { kind: 'mantle', minHeight: 50, maxHeight: 160, minDepth: 30, maxDistance: 120, preferredHeight: 120 },
  { kind: 'climb', minHeight: 140, maxHeight: 260, minDepth: 20, maxDistance: 90, preferredHeight: 200 },
];

const PROBE_FORWARD_CM = 130;
const PROBE_HEIGHTS_CM = [40, 90, 150, 210];
const TOP_PROBE_INSET_CM = 15;
const TOP_PROBE_ABOVE_CM = 300;
const DEPTH_PROBE_CM = 120;
const VAULT_THIN_CM = 60;

function trace(from: UE.Vector, to: UE.Vector, ignore: UE.Actor) {
  const hit = $ref(new UE.HitResult());
  const ignored = UE.NewArray(UE.Actor);
  ignored.Add(ignore);
  const found = UE.KismetSystemLibrary.LineTraceSingle(world, from, to, UE.ETraceTypeQuery.TraceTypeQuery1, false, ignored, UE.EDrawDebugTrace.None, hit, true, UE.LinearColor.Red, UE.LinearColor.Green, 0);
  return found ? $unref(hit) : undefined;
}

const add = (a: UE.Vector, b: UE.Vector, scale = 1) => new UE.Vector(a.X + b.X * scale, a.Y + b.Y * scale, a.Z + b.Z * scale);
const up = new UE.Vector(0, 0, 1);

function wallAhead(pawn: UE.Character, feet: UE.Vector, forward: UE.Vector) {
  for (const height of PROBE_HEIGHTS_CM) {
    const from = add(feet, up, height);
    const hit = trace(from, add(from, forward, PROBE_FORWARD_CM), pawn);
    if (hit && hit.ImpactNormal.Z < 0.5) return hit;
  }
  return undefined;
}

function depthBehind(pawn: UE.Character, top: UE.Vector, inward: UE.Vector) {
  const above = add(top, up, 5);
  const blocked = trace(above, add(above, inward, DEPTH_PROBE_CM), pawn);
  const far = add(top, inward, VAULT_THIN_CM);
  const floor = trace(add(far, up, 20), add(far, up, -40), pawn);
  return { depth: blocked ? blocked.Distance : DEPTH_PROBE_CM, thin: !floor };
}

export function findLedge(pawn: UE.Character): (Ledge & { thin: boolean }) | undefined {
  const location = pawn.K2_GetActorLocation();
  const feet = add(location, up, -pawn.CapsuleComponent.GetScaledCapsuleHalfHeight());
  const yaw = (pawn.K2_GetActorRotation().Yaw * Math.PI) / 180;
  const forward = new UE.Vector(Math.cos(yaw), Math.sin(yaw), 0);
  const wall = wallAhead(pawn, feet, forward);
  if (!wall) return undefined;
  const inward = new UE.Vector(-wall.ImpactNormal.X, -wall.ImpactNormal.Y, 0);
  const probe = add(wall.ImpactPoint, inward, TOP_PROBE_INSET_CM);
  const top = trace(add(new UE.Vector(probe.X, probe.Y, feet.Z), up, TOP_PROBE_ABOVE_CM), new UE.Vector(probe.X, probe.Y, feet.Z), pawn);
  if (!top || top.ImpactNormal.Z < 0.7) return undefined;
  const { depth, thin } = depthBehind(pawn, top.ImpactPoint, inward);
  const distance = Math.hypot(wall.ImpactPoint.X - feet.X, wall.ImpactPoint.Y - feet.Y);
  return { top: top.ImpactPoint, normal: wall.ImpactNormal, height: top.ImpactPoint.Z - feet.Z, depth, distance, thin };
}

export function chooseAction(ledge: (Ledge & { thin: boolean }) | undefined, ranges: readonly TraversalRange[] = TRAVERSAL_RANGES): TraversalAction | undefined {
  if (!ledge) return undefined;
  const candidates = ranges
    .filter((range) => ledge.height >= range.minHeight && ledge.height <= range.maxHeight && ledge.depth >= range.minDepth && ledge.distance <= range.maxDistance)
    .filter((range) => range.kind !== 'vault' || ledge.thin)
    .map((range) => ({ kind: range.kind, ledge, fitness: 1 - Math.abs(ledge.height - range.preferredHeight) / (range.maxHeight - range.minHeight) }))
    .filter((action) => action.fitness > 1e-5)
    .sort((a, b) => b.fitness - a.fitness);
  return candidates[0];
}

export interface RootPath {
  times: readonly number[];
  points: readonly UE.Vector[];
  length: number;
}

export function rootPathOf(clip: UE.AnimSequenceBase, mesh: UE.SkeletalMesh, rootBone: string, stepSeconds = 1 / 30): RootPath {
  const names = UE.NewArray(UE.BuiltinName);
  names.Add(rootBone);
  const positions = UE.VgeScriptLibrary.SampleClipBones(clip, mesh, names, stepSeconds);
  const points = Array.from({ length: positions.Num() }, (_, index) => positions.Get(index));
  return { times: points.map((_, index) => index * stepSeconds), points, length: clip.GetPlayLength() };
}

export interface WarpedMove {
  start: UE.Vector;
  end: UE.Vector;
  yaw: number;
  path: RootPath;
}

export function warpedLocation(move: WarpedMove, time: number): UE.Vector {
  const { points, times } = move.path;
  if (!points.length) return move.end;
  const index = Math.min(points.length - 1, Math.max(0, Math.round((time / Math.max(1e-6, move.path.length)) * (times.length - 1))));
  const first = points[0];
  const last = points[points.length - 1];
  const along = (point: UE.Vector, axis: 'X' | 'Y' | 'Z') => (last[axis] - first[axis] === 0 ? (index / (points.length - 1)) : (point[axis] - first[axis]) / (last[axis] - first[axis]));
  const point = points[index];
  const horizontal = Math.min(1, Math.max(0, Math.hypot(point.X - first.X, point.Y - first.Y) / Math.max(1e-6, Math.hypot(last.X - first.X, last.Y - first.Y))));
  const vertical = along(point, 'Z');
  return new UE.Vector(
    move.start.X + (move.end.X - move.start.X) * horizontal,
    move.start.Y + (move.end.Y - move.start.Y) * horizontal,
    move.start.Z + (move.end.Z - move.start.Z) * vertical,
  );
}
