import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { loadContent, onMaterial } from '../engine/content';
import type { MaterialRef } from '../material';

export interface CloudsProps {
  material?: MaterialRef;
  bottomAltitude?: number;
  height?: number;
}

export function Clouds({ material, bottomAltitude, height }: CloudsProps) {
  const actor = useRef<UE.VolumetricCloud | null>(null);

  useEffect(() => {
    if (!material) return;
    return onMaterial(material, (built) => {
      const loaded = loadContent<UE.MaterialInterface>(built.path);
      if (loaded && actor.current) actor.current.VolumetricCloudComponent.SetMaterial(loaded);
    });
  }, [material?.key]);

  useEffect(() => {
    const component = actor.current?.VolumetricCloudComponent;
    if (!component) return;
    if (bottomAltitude !== undefined) component.SetLayerBottomAltitude(bottomAltitude);
    if (height !== undefined) component.SetLayerHeight(height);
  }, [bottomAltitude, height]);

  return <volumetricCloud ref={actor} />;
}
