import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { loadContent, onGeometryCollection } from '../engine/content';
import type { GeometryCollectionRef } from '../fracture';
import type { Vector3 } from './props';

export interface DestructibleProps {
  collection: GeometryCollectionRef;
  at: Vector3;
  rotation?: Vector3;
  scale?: number;
  anchored?: boolean;
  onBreak?: (event: UE.ChaosBreakEvent) => void;
  onReady?: (component: UE.GeometryCollectionComponent) => void;
}

export function Destructible({ collection, at, rotation, scale = 1, anchored = false, onBreak, onReady }: DestructibleProps) {
  const component = useRef<UE.GeometryCollectionComponent | null>(null);
  const latest = useRef({ onReady, anchored });
  latest.current = { onReady, anchored };

  useEffect(
    () =>
      onGeometryCollection(collection, (next) => {
        const target = component.current;
        const asset = loadContent<UE.GeometryCollection>(next.path);
        if (!target || !asset) return;
        target.SetRestCollection(asset, true);
        target.SetRestCollection(asset, false);
        target.SetNotifyBreaks(true);
        target.SetSimulatePhysics(true);
        if (latest.current.anchored) target.SetAnchoredByIndex(0, true);
        latest.current.onReady?.(target);
      }),
    [collection.key],
  );

  return (
    <geometryCollectionComponent
      ref={component}
      location={at}
      rotation={rotation}
      scale={[scale, scale, scale]}
      objectType={anchored ? UE.EObjectStateTypeEnum.Chaos_Object_Kinematic : UE.EObjectStateTypeEnum.Chaos_Object_Sleeping}
      onChaosBreakEvent={onBreak}
    />
  );
}
