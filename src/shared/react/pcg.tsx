import * as UE from 'ue';
import { useEffect, useRef } from 'react';
import { loadContent, onPcg, type ContentTerrain } from '../engine/content';
import type { PcgGraphRef } from '../pcg';
import type { Vector3 } from './props';
import { useTerrainLevel } from './terrain';

export interface PcgGenerated {
  ms: number;
  instances: Record<string, number>;
}

export interface PcgProps {
  graph: PcgGraphRef;
  at: Vector3;
  extent: Vector3;
  seed?: number;
  params?: Record<string, number | boolean>;
  splines?: readonly (readonly Vector3[])[];
  onGenerated?: (generated: PcgGenerated) => void;
}

function setSplinePoints(spline: UE.SplineComponent | null, points: readonly Vector3[]) {
  if (!spline) return;
  const array = UE.NewArray(UE.Vector);
  for (const [x, y, z] of points) array.Add(new UE.Vector(x, y, z));
  spline.SetSplinePoints(array, UE.ESplineCoordinateSpace.World, true);
}

function setParams(component: UE.PCGComponent, graph: PcgGraphRef, params: Record<string, number | boolean>) {
  const instance = component.GraphInstance;
  for (const [name, value] of Object.entries(params)) {
    const type = graph.params[name];
    if (type === 'float' && typeof value === 'number') UE.PCGGraphParametersHelpers.SetFloatParameter(instance, name, value);
    else if (type === 'int' && typeof value === 'number') UE.PCGGraphParametersHelpers.SetInt32Parameter(instance, name, Math.round(value));
    else if (type === 'bool' && typeof value === 'boolean') UE.PCGGraphParametersHelpers.SetBoolParameter(instance, name, value);
    else console.error(`[pcg] ${graph.key}: '${name}' is ${type ? `a ${type} parameter, given ${JSON.stringify(value)}` : `not a parameter (parameters: ${Object.keys(graph.params).join(', ') || 'none'})`}`);
  }
}

function instancesOf(component: UE.PCGComponent) {
  const found = component.GetOwner().K2_GetComponentsByClass(UE.InstancedStaticMeshComponent.StaticClass());
  const counts: Record<string, number> = {};
  for (let index = 0; index < found.Num(); index++) {
    const ism = found.Get(index) as UE.InstancedStaticMeshComponent;
    const mesh = ism.StaticMesh ? ism.StaticMesh.GetName() : 'none';
    counts[mesh] = (counts[mesh] ?? 0) + ism.GetInstanceCount();
  }
  return counts;
}

export function Pcg({ graph, at, extent, seed = 0, params, splines = [], onGenerated }: PcgProps) {
  const component = useRef<UE.PCGComponent | null>(null);
  const built = useRef<ContentTerrain | undefined>(undefined);
  const started = useRef(0);
  const latest = useRef({ seed, params, onGenerated });
  latest.current = { seed, params, onGenerated };

  const generate = () => {
    const target = component.current;
    if (!target || !built.current) return;
    target.Seed = latest.current.seed;
    if (latest.current.params) setParams(target, graph, latest.current.params);
    started.current = Date.now();
    target.Generate(true);
  };

  useEffect(
    () =>
      onPcg(graph, (next) => {
        const target = component.current;
        const asset = loadContent<UE.PCGGraph>(next.path);
        if (!target || !asset) return;
        built.current = next;
        target.SetGraph(asset);
        generate();
      }),
    [graph.key],
  );

  const terrainLevel = useTerrainLevel();
  useEffect(generate, [seed, JSON.stringify(params), JSON.stringify([at, extent, splines]), terrainLevel]);

  const onGraphGenerated = () => {
    if (component.current) latest.current.onGenerated?.({ ms: Date.now() - started.current, instances: instancesOf(component.current) });
  };

  return (
    <boxComponent location={at} boxExtent={extent} collisionEnabled={UE.ECollisionEnabled.NoCollision} hiddenInGame>
      {splines.map((points, index) => (
        <splineComponent key={index} ref={(spline: UE.SplineComponent | null) => setSplinePoints(spline, points)} />
      ))}
      <pCGComponent ref={component} generationTrigger={UE.EPCGComponentGenerationTrigger.GenerateOnDemand} onPCGGraphGeneratedExternal={onGraphGenerated} />
    </boxComponent>
  );
}
