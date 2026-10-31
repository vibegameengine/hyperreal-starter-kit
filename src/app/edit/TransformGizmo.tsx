import * as UE from 'ue';
import type { ReactNode } from 'react';
import { instance } from '../../shared/material';
import type { Vector3 } from '../../shared/react/props';
import gizmo from './gizmo';
import {
  ALPHA,
  ALPHA_HIGHLIGHT,
  ARROW_HEAD_LENGTH,
  ARROW_HEAD_RADIUS,
  BOX_HALF_SIZE,
  CENTER_RADIUS,
  GIZMO_SIZE_PX,
  PLANE_HALF_DIAGONAL,
  PLANE_OFFSET,
  TRACKBALL_ALPHA_FACTOR,
  planeAxesOf,
  type GizmoPart,
} from './gizmoParts';

const CYLINDER = '/Engine/BasicShapes/Cylinder.Cylinder';
const CONE = '/Engine/BasicShapes/Cone.Cone';
const CUBE = '/Engine/BasicShapes/Cube.Cube';
const PLANE = '/Engine/BasicShapes/Plane.Plane';
const UNIT_CM = 100;
const ALONG_AXIS: Vector3[] = [
  [-90, 0, 0],
  [0, 0, 90],
  [0, 0, 0],
];

export interface PartLook {
  hovered?: string;
  fades: Record<string, number>;
}

export interface RingSegment {
  component: UE.StaticMeshComponent;
  centre: Vector3;
}

export interface GizmoRefs {
  root: UE.SceneComponent | null;
  viewAligned: UE.SceneComponent | null;
  clippedSegments: Map<string, RingSegment>;
}

const RING_SEGMENTS = 64;
const DISC_THICKNESS = 0.001;

const unitVector = (axis: number, distance: number): Vector3 => [axis === 0 ? distance * UNIT_CM : 0, axis === 1 ? distance * UNIT_CM : 0, axis === 2 ? distance * UNIT_CM : 0];
const lineScale = (widthPx: number, lengthUnits: number): Vector3 => [widthPx / GIZMO_SIZE_PX, widthPx / GIZMO_SIZE_PX, lengthUnits];

function alphaOf(part: GizmoPart, look: PartLook) {
  const fade = look.fades[part.id] ?? 1;
  const hovered = look.hovered === part.id;
  const base = (hovered ? ALPHA_HIGHLIGHT : ALPHA) * fade;
  return Math.round((part.shape === 'disc' ? base * TRACKBALL_ALPHA_FACTOR : base) * 20) / 20;
}

const look = (color: Vector3, alpha: number) => [instance(gizmo, { color: [...color], alpha })];

interface MeshProps {
  mesh: string;
  location: Vector3;
  rotation?: Vector3;
  scale: Vector3 | number;
  material: ReturnType<typeof look>;
  onComponent?: (component: UE.StaticMeshComponent | null) => void;
}

function Mesh(props: MeshProps) {
  return (
    <staticMeshComponent
      ref={(component) => props.onComponent?.(component)}
      location={props.location}
      rotation={props.rotation ?? [0, 0, 0]}
      scale={props.scale}
      staticMesh={props.mesh}
      overrideMaterials={props.material}
      collisionEnabled={UE.ECollisionEnabled.NoCollision}
      castShadow={false}
    />
  );
}

const segmentRotations = new Map<string, Vector3>();
function rotationAlong(direction: Vector3): Vector3 {
  const key = direction.map((value) => value.toFixed(5)).join(',');
  let rotation = segmentRotations.get(key);
  if (!rotation) {
    const rotator = UE.KismetMathLibrary.MakeRotFromZ(new UE.Vector(direction[0], direction[1], direction[2]));
    segmentRotations.set(key, (rotation = [rotator.Pitch, rotator.Yaw, rotator.Roll]));
  }
  return rotation;
}

function pointOnRing(plane: number, radius: number, angle: number): Vector3 {
  const [a, b] = plane === 0 ? [1, 2] : plane === 1 ? [2, 0] : [0, 1];
  const point = [0, 0, 0];
  point[a] = Math.cos(angle) * radius * UNIT_CM;
  point[b] = Math.sin(angle) * radius * UNIT_CM;
  return point as unknown as Vector3;
}

function Ring({ id, plane, radius, widthPx, material, refs }: { id: string; plane: number; radius: number; widthPx: number; material: ReturnType<typeof look>; refs?: GizmoRefs }) {
  const step = (2 * Math.PI) / RING_SEGMENTS;
  const length = 2 * radius * Math.sin(step / 2);
  return (
    <>
      {Array.from({ length: RING_SEGMENTS }, (_, index) => {
        const [from, to] = [pointOnRing(plane, radius, index * step), pointOnRing(plane, radius, (index + 1) * step)];
        const centre: Vector3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
        const direction: Vector3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const key = `${id}-${index}`;
        return (
          <Mesh
            key={key}
            mesh={CYLINDER}
            location={centre}
            rotation={rotationAlong(direction)}
            scale={lineScale(widthPx, length)}
            material={material}
            onComponent={
              refs &&
              ((component) => {
                if (component) refs.clippedSegments.set(key, { component, centre });
                else refs.clippedSegments.delete(key);
              })
            }
          />
        );
      })}
    </>
  );
}

function Line({ axis, from, to, widthPx, material }: { axis: number; from: number; to: number; widthPx: number; material: ReturnType<typeof look> }) {
  return <Mesh mesh={CYLINDER} location={unitVector(axis, (from + to) / 2)} rotation={ALONG_AXIS[axis]} scale={lineScale(widthPx, to - from)} material={material} />;
}

function PlaneHandle({ part, material, outline }: { part: GizmoPart; material: ReturnType<typeof look>; outline: ReturnType<typeof look> }) {
  const [a, b] = planeAxesOf(part.axis);
  const centreUnits = PLANE_OFFSET + PLANE_HALF_DIAGONAL;
  const centre: Vector3 = [0, 1, 2].map((axis) => (axis === a || axis === b ? (centreUnits / Math.SQRT2) * UNIT_CM : 0)) as unknown as Vector3;
  const side = PLANE_HALF_DIAGONAL * Math.SQRT2;
  const edges: ReactNode[] = [a, b].flatMap((along) => {
    const other = along === a ? b : a;
    return [-1, 1].map((sign) => {
      const location = [...centre] as [number, number, number];
      location[other] += (sign * side * UNIT_CM) / 2;
      return <Mesh key={`${along}${sign}`} mesh={CYLINDER} location={location} rotation={ALONG_AXIS[along]} scale={lineScale(part.lineWidthPx, side)} material={outline} />;
    });
  });
  return (
    <>
      <Mesh mesh={PLANE} location={centre} rotation={ALONG_AXIS[part.axis]} scale={[side, side, 1]} material={material} />
      {edges}
    </>
  );
}

function PartMeshes({ part, partLook, refs }: { part: GizmoPart; partLook: PartLook; refs: GizmoRefs }) {
  const alpha = alphaOf(part, partLook);
  const material = look(part.color, alpha);
  if (part.shape === 'arrow' || part.shape === 'box') {
    const head =
      part.shape === 'arrow' ? (
        <Mesh mesh={CONE} location={unitVector(part.axis, part.end + ARROW_HEAD_LENGTH / 2)} rotation={ALONG_AXIS[part.axis]} scale={[(ARROW_HEAD_RADIUS * UNIT_CM) / 50, (ARROW_HEAD_RADIUS * UNIT_CM) / 50, ARROW_HEAD_LENGTH]} material={material} />
      ) : (
        <Mesh mesh={CUBE} location={unitVector(part.axis, part.end + BOX_HALF_SIZE)} scale={2 * BOX_HALF_SIZE} material={material} />
      );
    return (
      <>
        {part.stem && <Line axis={part.axis} from={part.start} to={part.end} widthPx={part.lineWidthPx} material={material} />}
        {head}
      </>
    );
  }
  if (part.shape === 'plane') return <PlaneHandle part={part} material={look(part.color, Math.round(alpha * 10) / 20)} outline={material} />;
  if (part.shape === 'ring' && part.axis <= 2) return <Ring id={part.id} plane={part.axis} radius={part.radius} widthPx={part.lineWidthPx} material={material} refs={refs} />;
  return null;
}

function ViewAlignedMeshes({ part, partLook }: { part: GizmoPart; partLook: PartLook }) {
  const material = look(part.color, alphaOf(part, partLook));
  if (part.shape === 'disc') return partLook.hovered === part.id ? <Mesh mesh={CYLINDER} location={[0, 0, 0]} scale={[2 * part.radius, 2 * part.radius, DISC_THICKNESS]} material={material} /> : null;
  if (part.shape === 'circle') {
    return (
      <>
        <Ring id={`${part.id}-inner`} plane={2} radius={CENTER_RADIUS} widthPx={part.lineWidthPx} material={material} />
        {part.radius > CENTER_RADIUS && <Ring id={`${part.id}-outer`} plane={2} radius={part.radius} widthPx={part.lineWidthPx} material={material} />}
      </>
    );
  }
  if (part.shape === 'ring') return <Ring id={part.id} plane={2} radius={part.radius} widthPx={part.lineWidthPx} material={material} />;
  return null;
}

export function TransformGizmo({ parts, partLook, refs }: { parts: GizmoPart[]; partLook: PartLook; refs: GizmoRefs }) {
  const viewAligned = (part: GizmoPart) => part.shape === 'disc' || part.shape === 'circle' || (part.shape === 'ring' && part.axis > 2);
  return (
    <sceneComponent
      ref={(root) => {
        refs.root = root;
      }}
    >
      {parts.filter((part) => !viewAligned(part)).map((part) => (
        <PartMeshes key={part.id} part={part} partLook={partLook} refs={refs} />
      ))}
      <sceneComponent
        ref={(component) => {
          refs.viewAligned = component;
        }}
      >
        {parts.filter(viewAligned).map((part) => (
          <ViewAlignedMeshes key={part.id} part={part} partLook={partLook} />
        ))}
      </sceneComponent>
    </sceneComponent>
  );
}
