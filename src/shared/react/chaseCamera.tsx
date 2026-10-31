import * as UE from 'ue';
import { $ref } from 'puerts';
import { useRef, type RefObject } from 'react';
import { useFrame } from './hooks';

export interface ChaseCameraProps {
  target: RefObject<UE.PrimitiveComponent | null>;
  distance?: number;
  height?: number;
  pitch?: number;
  followRate?: number;
  fieldOfView?: readonly [standing: number, fast: number];
  fastSpeed?: number;
}

const shortestTurn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

export function ChaseCamera({ target, distance = 650, height = 140, pitch = -9, followRate = 3.5, fieldOfView = [80, 98], fastSpeed = 5500 }: ChaseCameraProps) {
  const arm = useRef<UE.SpringArmComponent>(null);
  const camera = useRef<UE.CameraComponent>(null);
  const yaw = useRef<number | null>(null);

  useFrame((deltaSeconds) => {
    const body = target.current;
    if (!body || !arm.current || !camera.current) return;
    const heading = body.K2_GetComponentRotation().Yaw;
    yaw.current = yaw.current === null ? heading : yaw.current + shortestTurn(yaw.current, heading) * (1 - Math.exp(-followRate * deltaSeconds));
    arm.current.K2_SetWorldRotation(new UE.Rotator(pitch, yaw.current, 0), false, $ref(new UE.HitResult()), true);
    const speed = Math.min(1, body.GetPhysicsLinearVelocity('None').Size() / fastSpeed);
    camera.current.SetFieldOfView(fieldOfView[0] + (fieldOfView[1] - fieldOfView[0]) * speed * speed);
  });

  return (
    <springArmComponent ref={arm} location={[0, 0, height]} absoluteRotation targetArmLength={distance} enableCameraLag cameraLagSpeed={10} cameraLagMaxDistance={100} doCollisionTest={false}>
      <cameraComponent ref={camera} socket="SpringEndpoint" constrainAspectRatio={false} />
    </springArmComponent>
  );
}
