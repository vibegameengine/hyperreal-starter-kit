import * as UE from 'ue';
import { $ref } from 'puerts';
import { useRef } from 'react';
import { withoutMotionBlur } from '../../../../scenes/lab-stage/OrbitCamera';
import { world } from '../../../../shared/engine/world';
import { useFrame } from '../../../../shared/react';
import { meander, valleyHeight } from '../../assets/valleyShape';

export const ROUTE_START_X = -6000;
const ROUTE_END_X = 2000;
const STOPPING = 400;
const CAMERA_CLEARANCE = 80;
const LOOK_AHEAD = 700;
const WALK_INPUT = 0.6;
const STAND_SECONDS = 3.3;

export const routeY = (x: number) => -meander(x) * 0.6;
export const routeStart: [number, number, number] = [ROUTE_START_X, routeY(ROUTE_START_X), valleyHeight(ROUTE_START_X, routeY(ROUTE_START_X)) + 120];

interface Shot {
  at: number;
  distance: number;
  height: number;
  yaw: number;
  look: number;
}

const SHOTS: Shot[] = [
  { at: 0, distance: 7000, height: 3800, yaw: 25, look: 0 },
  { at: 2.5, distance: 6000, height: 3000, yaw: 20, look: 0 },
  { at: 6.5, distance: 1500, height: 600, yaw: 15, look: 60 },
  { at: 10, distance: 450, height: 90, yaw: 10, look: 110 },
  { at: 17, distance: 700, height: 220, yaw: -15, look: 100 },
  { at: 26, distance: 2400, height: 1600, yaw: 0, look: 0 },
  { at: 37, distance: 4200, height: 3200, yaw: 60, look: 0 },
];

const ease = (t: number) => t * t * (3 - 2 * t);

function shotAt(time: number): Shot {
  const next = SHOTS.findIndex((shot) => shot.at > time);
  if (next === -1) return SHOTS[SHOTS.length - 1];
  if (next === 0) return SHOTS[0];
  const a = SHOTS[next - 1];
  const b = SHOTS[next];
  const t = ease((time - a.at) / (b.at - a.at));
  const mix = (key: keyof Shot) => a[key] + (b[key] - a[key]) * t;
  return { at: time, distance: mix('distance'), height: mix('height'), yaw: mix('yaw'), look: mix('look') };
}

export function Walk() {
  const camera = useRef<UE.CameraActor>(null);
  const clock = useRef(0);

  useFrame((deltaSeconds) => {
    const pawn = UE.GameplayStatics.GetPlayerPawn(world, 0);
    const controller = UE.GameplayStatics.GetPlayerController(world, 0);
    if (!pawn || !controller || !camera.current) return;
    clock.current += deltaSeconds;
    const time = clock.current;
    const at = pawn.K2_GetActorLocation();

    const remaining = ROUTE_END_X - at.X;
    if (time > STAND_SECONDS && remaining > 0) {
      const ahead = at.X + LOOK_AHEAD;
      pawn.AddMovementInput(new UE.Vector(LOOK_AHEAD, routeY(ahead) - at.Y, 0).GetSafeNormal(), WALK_INPUT * Math.min(1, remaining / STOPPING), false);
    }

    const heading = Math.atan2(routeY(at.X + 50) - routeY(at.X - 50), 100);
    const shot = shotAt(time);
    const yaw = heading + (shot.yaw * Math.PI) / 180;
    const eyeX = at.X + Math.cos(yaw) * shot.distance;
    const eyeY = at.Y + Math.sin(yaw) * shot.distance;
    const eye = new UE.Vector(eyeX, eyeY, Math.max(at.Z + shot.height, valleyHeight(eyeX, eyeY) + CAMERA_CLEARANCE));
    const target = new UE.Vector(at.X, at.Y, at.Z + shot.look);
    camera.current.K2_SetActorLocationAndRotation(eye, UE.KismetMathLibrary.FindLookAtRotation(eye, target), false, $ref(new UE.HitResult()), true);
    if (controller.GetViewTarget() !== camera.current) controller.SetViewTargetWithBlend(camera.current, 0);
  });

  return (
    <cameraActor
      ref={(actor: UE.CameraActor | null) => {
        camera.current = actor;
        if (actor) withoutMotionBlur(actor.CameraComponent);
      }}
      location={routeStart}
      cameraComponent={{ constrainAspectRatio: false }}
    />
  );
}
