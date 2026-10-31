import * as UE from 'ue';
import { useEffect, useState } from 'react';
import type { ComputeRef } from '../compute';
import { loadContent, onCompute } from '../engine/content';
import { destroy, spawn } from '../engine/world';

export function useCompute(compute: ComputeRef | undefined) {
  const [component, setComponent] = useState<UE.VgeComputeComponent>();

  useEffect(() => {
    if (!compute) return;
    const holder = spawn<UE.Actor>(UE.Actor, new UE.Vector(0, 0, 0));
    const created = UE.NewObject(UE.VgeComputeComponent.StaticClass(), holder) as UE.VgeComputeComponent;
    created.RegisterComponent();
    const stop = onCompute(compute, (built) => {
      const graph = loadContent<UE.ComputeGraph>(built.path);
      if (!graph) return;
      created.SetGraph(graph);
      setComponent(created);
    });
    return () => {
      stop();
      setComponent(undefined);
      destroy(holder);
    };
  }, [compute?.key]);

  return component;
}
