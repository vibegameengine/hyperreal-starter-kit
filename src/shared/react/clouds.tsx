import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { onMaterial } from '../engine/content';
import type { MaterialValue } from '../material';
import { materialKeyOf, resolveMaterial } from './materials';

export interface CloudsProps {
  material?: MaterialValue;
  bottomAltitude?: number;
  height?: number;
}

export function Clouds({ material, bottomAltitude, height }: CloudsProps) {
  const actor = useRef<UE.VolumetricCloud | null>(null);
  const [builtPath, setBuiltPath] = useState('');
  const base = material && (material.kind === 'dynamic' ? material.base : material);

  useEffect(() => {
    if (!base) return;
    return onMaterial(base, (built) => setBuiltPath(built.path));
  }, [base?.key]);

  useEffect(() => {
    const component = actor.current?.VolumetricCloudComponent;
    if (!material || !component || !builtPath) return;
    const resolved = resolveMaterial(component, 'cloud', material);
    if (resolved) component.SetMaterial(resolved);
  }, [material && materialKeyOf(material), builtPath]);

  useEffect(() => {
    const component = actor.current?.VolumetricCloudComponent;
    if (!component) return;
    if (bottomAltitude !== undefined) component.SetLayerBottomAltitude(bottomAltitude);
    if (height !== undefined) component.SetLayerHeight(height);
  }, [bottomAltitude, height]);

  return <volumetricCloud ref={actor} />;
}
