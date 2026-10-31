import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useRef } from 'react';
import { releaseMouse } from '../../shared/engine/mouse';
import { viewFrom, world } from '../../shared/engine/world';
import { useFrame } from '../../shared/react';
import type { Vector3 } from '../../shared/react/props';

const ORBIT_DEGREES_PER_PIXEL = 0.3;
const PAN_PER_PIXEL = 0.0015;
const DOLLY_PER_WHEEL_STEP = 0.12;
const DOLLY_PER_PIXEL = 0.005;
const PITCH_RANGE = [-89, 89] as const;
const DISTANCE_RANGE = [30, 50000] as const;
const MIN_FOCUS_DISTANCE = 150;
const FLY_SPEED = 600;
const FLY_FAST = 3;
const FLY_LOOK_DEGREES_PER_UNIT = 0.4;
const KEYS = {
  left: new UE.Key('LeftMouseButton'), middle: new UE.Key('MiddleMouseButton'), right: new UE.Key('RightMouseButton'),
  leftAlt: new UE.Key('LeftAlt'), rightAlt: new UE.Key('RightAlt'), wheel: new UE.Key('MouseWheelAxis'), frame: new UE.Key('F'),
  forward: new UE.Key('W'), back: new UE.Key('S'), leftward: new UE.Key('A'), rightward: new UE.Key('D'), down: new UE.Key('Q'), up: new UE.Key('E'),
  shift: new UE.Key('LeftShift'),
};

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const forwardOf = (pitch: number, yaw: number): Vector3 => [Math.cos(radians(pitch)) * Math.cos(radians(yaw)), Math.cos(radians(pitch)) * Math.sin(radians(yaw)), Math.sin(radians(pitch))];

interface Orbit { focus: Vector3; yaw: number; pitch: number; distance: number }

function orbitFrom(location: Vector3, rotation: Vector3, focus?: Vector3): Orbit {
  const [pitch, yaw] = rotation;
  const forward = forwardOf(pitch, yaw);
  if (focus) {
    const offset = [focus[0] - location[0], focus[1] - location[1], focus[2] - location[2]];
    return { focus, yaw, pitch, distance: Math.max(DISTANCE_RANGE[0], Math.hypot(offset[0], offset[1], offset[2])) };
  }
  const along = Math.max(MIN_FOCUS_DISTANCE, -(location[0] * forward[0] + location[1] * forward[1] + location[2] * forward[2]));
  return { focus: [location[0] + forward[0] * along, location[1] + forward[1] * along, location[2] + forward[2] * along], yaw, pitch, distance: along };
}

export function withoutMotionBlur(component: UE.CameraComponent) {
  const settings = component.PostProcessSettings;
  settings.bOverride_MotionBlurAmount = true;
  settings.MotionBlurAmount = 0;
  component.PostProcessSettings = settings;
  component.PostProcessBlendWeight = 1;
}

function cursorMoveSince(controller: UE.PlayerController, lastCursor: { current: [number, number] | null }): [number, number] {
  const x = $ref(0);
  const y = $ref(0);
  if (!controller.GetMousePosition(x, y)) {
    lastCursor.current = null;
    return [0, 0];
  }
  const cursor: [number, number] = [$unref(x), $unref(y)];
  const previous = lastCursor.current;
  lastCursor.current = cursor;
  return previous ? [cursor[0] - previous[0], cursor[1] - previous[1]] : [0, 0];
}

export interface OrbitCameraProps {
  location: Vector3;
  rotation: Vector3;
  focus?: Vector3;
  editing?: boolean;
  navigation?: 'orbit' | 'pan' | 'fly';
}

export function OrbitCamera({ location, rotation, focus, editing = false, navigation }: OrbitCameraProps) {
  const camera = useRef<UE.CameraActor>(null);
  const start = useRef(orbitFrom(location, rotation, focus));
  const orbit = useRef<Orbit>({ ...start.current });
  const lastCursor = useRef<[number, number] | null>(null);
  const flying = useRef<[number, number] | null | undefined>(undefined);
  const cursorX = $ref(0);
  const cursorY = $ref(0);
  const ignoredHit = $ref(new UE.HitResult());
  useEffect(
    () => () => {
      if (flying.current !== undefined) releaseMouse();
    },
    [],
  );

  useFrame((deltaSeconds) => {
    const actor = camera.current;
    const controller = UE.GameplayStatics.GetPlayerController(world, 0);
    if (!actor || !controller) return;
    const view = orbit.current;
    const down = (key: UE.Key) => controller.IsInputKeyDown(key);
    const alt = down(KEYS.leftAlt) || down(KEYS.rightAlt);

    const [dx, dy] = cursorMoveSince(controller, lastCursor);

    if (editing && controller.GetViewTarget() !== actor) viewFrom(actor);
    const allows = (mode: 'orbit' | 'pan' | 'fly') => !editing || navigation === mode;
    if (down(KEYS.left) && allows('orbit')) {
      view.yaw = (view.yaw + dx * ORBIT_DEGREES_PER_PIXEL) % 360;
      view.pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], view.pitch - dy * ORBIT_DEGREES_PER_PIXEL));
    } else if (down(KEYS.middle) && allows('pan')) {
      const step = view.distance * PAN_PER_PIXEL;
      const yaw = radians(view.yaw);
      const pitch = radians(view.pitch);
      const right: Vector3 = [-Math.sin(yaw), Math.cos(yaw), 0];
      const up: Vector3 = [-Math.sin(pitch) * Math.cos(yaw), -Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch)];
      const move = (axis: 0 | 1 | 2) => view.focus[axis] - right[axis] * dx * step + up[axis] * dy * step;
      view.focus = [move(0), move(1), move(2)];
    } else if (alt && down(KEYS.right) && !editing) {
      view.distance *= 1 + dy * DOLLY_PER_PIXEL;
    } else if (down(KEYS.right) && allows('fly')) {
      if (flying.current === undefined) {
        flying.current = lastCursor.current;
        controller.bShowMouseCursor = false;
        UE.WidgetBlueprintLibrary.SetInputMode_GameOnly(controller, false);
      }
      controller.GetInputMouseDelta(cursorX, cursorY);
      const [lookX, lookY] = [$unref(cursorX) * FLY_LOOK_DEGREES_PER_UNIT, $unref(cursorY) * FLY_LOOK_DEGREES_PER_UNIT];
      const before = forwardOf(view.pitch, view.yaw);
      const eye: Vector3 = [view.focus[0] - before[0] * view.distance, view.focus[1] - before[1] * view.distance, view.focus[2] - before[2] * view.distance];
      view.yaw = (view.yaw + lookX) % 360;
      view.pitch = Math.min(PITCH_RANGE[1], Math.max(PITCH_RANGE[0], view.pitch + lookY));
      const ahead = forwardOf(view.pitch, view.yaw);
      const right: Vector3 = [-Math.sin(radians(view.yaw)), Math.cos(radians(view.yaw)), 0];
      const axis = (plus: UE.Key, minus: UE.Key) => (down(plus) ? 1 : 0) - (down(minus) ? 1 : 0);
      const [f, r, u] = [axis(KEYS.forward, KEYS.back), axis(KEYS.rightward, KEYS.leftward), axis(KEYS.up, KEYS.down)];
      const step = FLY_SPEED * (down(KEYS.shift) ? FLY_FAST : 1) * deltaSeconds;
      const move = (i: 0 | 1 | 2) => eye[i] + (ahead[i] * f + right[i] * r + (i === 2 ? u : 0)) * step;
      const moved: Vector3 = [move(0), move(1), move(2)];
      view.focus = [moved[0] + ahead[0] * view.distance, moved[1] + ahead[1] * view.distance, moved[2] + ahead[2] * view.distance];
    }
    if (flying.current !== undefined && !down(KEYS.right)) {
      const cursor = flying.current;
      flying.current = undefined;
      releaseMouse();
      if (cursor) controller.SetMouseLocation(Math.round(cursor[0]), Math.round(cursor[1]));
      lastCursor.current = null;
    }
    const wheel = controller.GetInputAnalogKeyState(KEYS.wheel);
    if (wheel) view.distance *= 1 - wheel * DOLLY_PER_WHEEL_STEP;
    view.distance = Math.min(DISTANCE_RANGE[1], Math.max(DISTANCE_RANGE[0], view.distance));
    if (!editing && controller.WasInputKeyJustPressed(KEYS.frame)) Object.assign(view, { ...start.current });

    const forward = forwardOf(view.pitch, view.yaw);
    const at = new UE.Vector(view.focus[0] - forward[0] * view.distance, view.focus[1] - forward[1] * view.distance, view.focus[2] - forward[2] * view.distance);
    actor.K2_SetActorLocationAndRotation(at, new UE.Rotator(view.pitch, view.yaw, 0), false, ignoredHit, false);
  }, { tickEvenWhenPaused: editing });

  return (
    <cameraActor ref={(actor) => {
        camera.current = actor;
        if (!actor) return;
        withoutMotionBlur(actor.CameraComponent);
        viewFrom(actor);
      }} location={location} rotation={rotation} cameraComponent={{ constrainAspectRatio: false }} />
  );
}
