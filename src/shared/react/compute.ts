import * as UE from 'ue';
import { useEffect, useState } from 'react';
import type { ComputeRef } from '../compute';
import { loadContent, onCompute } from '../engine/content';
import { destroy, spawn } from '../engine/world';

export interface ComputeInstance {
  component: UE.VgeComputeComponent;
  graph: UE.ComputeGraph;
}

export function useCompute(compute: ComputeRef | undefined) {
  const [instance, setInstance] = useState<ComputeInstance>();

  useEffect(() => {
    if (!compute) return;
    const holder = spawn<UE.Actor>(UE.Actor, new UE.Vector(0, 0, 0));
    const component = UE.NewObject(UE.VgeComputeComponent.StaticClass(), holder) as UE.VgeComputeComponent;
    component.RegisterComponent();
    const stop = onCompute(compute, (built) => {
      const graph = loadContent<UE.ComputeGraph>(built.path);
      if (!graph) return;
      component.SetGraph(graph);
      setInstance({ component, graph });
    });
    return () => {
      stop();
      setInstance(undefined);
      setTimeout(() => destroy(holder), 0);
    };
  }, [compute?.key]);

  return instance;
}
