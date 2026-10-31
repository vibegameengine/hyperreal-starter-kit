import * as UE from 'ue';
import { colored } from '../../shared/engine/world';
import type { Vector3 } from '../../shared/react/props';
import { OrbitCamera } from './OrbitCamera';

export interface LabStageProps {
  ground?: boolean;
  groundSize?: number;
  camera?: { location: Vector3; rotation: Vector3; focus?: Vector3 } | null;
  sunPitch?: number;
  sunYaw?: number;
  fogDensity?: number;
}

const CUBE = '/Engine/BasicShapes/Cube.Cube';

export function LabStage({ ground = true, groundSize = 40, camera = { location: [-900, 0, 420], rotation: [-20, 0, 0] }, sunPitch = -35, sunYaw = 40, fogDensity = 0.02 }: LabStageProps) {
  return (
    <>
      <directionalLight location={[0, 0, 500]} rotation={[sunPitch, sunYaw, 0]} lightComponent={{ mobility: UE.EComponentMobility.Movable, intensity: 8 }} directionalLightComponent={{ atmosphereSunLight: true }} />
      <skyAtmosphere />
      <exponentialHeightFog component={{ fogDensity }} />
      <skyLight location={[0, 0, 200]} lightComponent={{ mobility: UE.EComponentMobility.Movable, realTimeCapture: true }} />
      {ground && <staticMeshComponent location={[0, 0, -5]} scale={[groundSize, groundSize, 0.1]} staticMesh={CUBE} overrideMaterials={[colored([0.35, 0.35, 0.38])]} />}
      {camera && <OrbitCamera location={camera.location} rotation={camera.rotation} focus={camera.focus} />}
    </>
  );
}
