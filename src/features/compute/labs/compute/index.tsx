import * as UE from 'ue';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { loadContent, onMaterial } from '../../../../shared/engine/content';
import { world } from '../../../../shared/engine/world';
import { useCompute, useFrame } from '../../../../shared/react';
import { probe, PROBE_SIZE } from '../../assets/probe.compute';
import { probeScreen } from '../../assets/probe.material';

const PLANE = '/Engine/BasicShapes/Plane.Plane';

function useScreen(target: UE.TextureRenderTarget2D) {
  const [screen, setScreen] = useState<UE.MaterialInstanceDynamic>();
  useEffect(
    () =>
      onMaterial(probeScreen, (built) => {
        const parent = loadContent<UE.MaterialInterface>(built.path);
        if (!parent) return;
        const mid = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, parent);
        mid.SetTextureParameterValue('Probe', target);
        setScreen(mid);
      }),
    [target],
  );
  return screen;
}

export function Scene() {
  const target = useMemo(() => UE.KismetRenderingLibrary.CreateRenderTarget2D(world, PROBE_SIZE, PROBE_SIZE, UE.ETextureRenderTargetFormat.RTF_RGBA16f, new UE.LinearColor(0, 0, 0, 0), false, true), []);
  const screen = useScreen(target);
  const compute = useCompute(probe);
  const plane = useRef<UE.StaticMeshComponent>(null);
  const clock = useRef(0);

  useEffect(() => compute?.SetTexture('Target', target), [compute, target]);
  useEffect(() => {
    if (screen && plane.current) plane.current.SetMaterial(0, screen);
  }, [screen]);

  useFrame((dt) => {
    clock.current += dt;
    if (!compute) return;
    compute.SetParam('Clock', new UE.LinearColor(clock.current, 0, 0, 0));
    compute.Execute();
  });

  return (
    <>
      <LabStage />
      <staticMeshComponent ref={plane} location={[400, 0, 150]} rotation={[0, 90, 90]} scale={[2, 2, 1]} staticMesh={PLANE} castShadow={false} />
    </>
  );
}
