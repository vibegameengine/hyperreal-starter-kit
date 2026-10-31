import * as UE from 'ue';
import { useEffect, useState } from 'react';
import { loadContent, onGroom } from '../engine/content';
import type { GroomRef } from '../groom';
import type { Vector3 } from './props';

export interface GroomProps {
  groom: GroomRef;
  target: () => UE.SkeletalMeshComponent | null | undefined;
  simulate?: boolean;
  wind?: Vector3;
  airDrag?: number;
  onReady?: (component: UE.GroomComponent) => void;
}

function simulation(wind: Vector3, airDrag: number, simulate: boolean) {
  const settings = new UE.HairSimulationSettings();
  settings.bOverrideSettings = true;
  settings.SolverSettings.bEnableSimulation = simulate;
  settings.ExternalForces.GravityVector = new UE.Vector(0, 0, -981);
  settings.ExternalForces.AirVelocity = new UE.Vector(...wind);
  settings.ExternalForces.AirDrag = airDrag;
  return settings;
}

export function Groom({ groom, target, simulate = true, wind = [0, 0, 0], airDrag = 0.1, onReady }: GroomProps) {
  const [bindingPath, setBindingPath] = useState<string>();
  const groomPath = bindingPath && `${bindingPath.slice(0, bindingPath.lastIndexOf('/'))}/${groom.groomName}.${groom.groomName}`;
  const [component, setComponent] = useState<UE.GroomComponent | null>(null);
  useEffect(() => onGroom(groom, (built) => setBindingPath(built.path)), [groom.key]);

  useEffect(() => {
    const mesh = target();
    if (!mesh || !groomPath || !bindingPath) return;
    const hair = UE.NewObject(UE.GroomComponent.StaticClass(), mesh.GetOwner()) as UE.GroomComponent;
    hair.SetGroomAsset(loadContent<UE.GroomAsset>(groomPath)!);
    hair.SetBindingAsset(loadContent<UE.GroomBindingAsset>(bindingPath)!);
    hair.K2_AttachToComponent(mesh, 'None', UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.SnapToTarget, true);
    hair.RegisterComponent();
    hair.AddCollisionComponent(mesh);
    setComponent(hair);
    onReady?.(hair);
    return () => {
      setComponent(null);
      if (UE.KismetSystemLibrary.IsValid(hair)) hair.K2_DestroyComponent(hair);
    };
  }, [groomPath, bindingPath]);

  useEffect(() => {
    const hair = component;
    if (!hair) return;
    hair.SimulationSettings = simulation(wind, airDrag, simulate);
    hair.SetEnableSimulation(simulate);
  }, [component, simulate, airDrag, ...wind]);

  return null;
}
