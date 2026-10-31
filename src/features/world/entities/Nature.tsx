import * as UE from 'ue';
import { useMemo, useRef } from 'react';
import type { ContentAsset, ContentAssetRef } from '../../../shared/engine/content';
import { useContentAsset, useContentMesh, useFrame } from '../../../shared/react';
import { GROWTH_STAGES, metresBehindFront, sprout } from '../growth/field';
import { useGrowthFront } from '../growth/Growth';
import { instance, type MaterialRef, type MaterialValue } from '../../../shared/material';
import rockFlatModel from '../assets/nature/rock-flat.glb';
import rockModel from '../assets/nature/rock.glb';
import treeTallModel from '../assets/nature/tree-tall.glb';
import treeModel from '../assets/nature/tree.glb';
import { bark, leaves, stone } from '../assets/nature/nature';
import { lakeShore, PATH_WIDTH, pathOffset, VALLEY_HALF_SIZE, valleyHeight, valleySlope } from '../assets/valleyShape';

interface Placement {
  location: [number, number, number];
  yaw: number;
  scale: number;
  variant: number;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScatterRule {
  seed: number;
  count: number;
  extent: number;
  accept: (x: number, y: number, slope: number) => boolean;
  size: [number, number];
  sink: number;
  spacing: number;
}

function scatter({ seed, count, extent, accept, size, sink, spacing }: ScatterRule): Placement[] {
  const next = random(seed);
  const placed: Placement[] = [];
  const crowded = (x: number, y: number) => placed.some((p) => Math.hypot(p.location[0] - x, p.location[1] - y) < spacing);
  for (let attempt = 0; placed.length < count && attempt < count * 20; attempt++) {
    const x = (next() * 2 - 1) * extent;
    const y = (next() * 2 - 1) * extent;
    const slope = valleySlope(x, y);
    if (!accept(x, y, slope) || crowded(x, y)) continue;
    const scale = size[0] + next() * (size[1] - size[0]);
    placed.push({ location: [x, y, valleyHeight(x, y) - sink * scale], yaw: next() * 360, scale, variant: next() < 0.5 ? 0 : 1 });
  }
  return placed;
}

const EDGE = VALLEY_HALF_SIZE * 0.95;
const offPath = (x: number, y: number) => pathOffset(x, y) > PATH_WIDTH + 250 && lakeShore(x, y) > 1.1;

interface Variant {
  mesh: UE.StaticMesh | undefined;
  materials: MaterialValue[];
}

interface KindProps {
  placements: Placement[];
  variants: Variant[];
}

const SPROUT_SPREAD_METRES = 12;
const SPROUT_SPAN_METRES = 10;
const UNSPROUTED = 0.001;

function useSprouting(placements: Placement[]) {
  const front = useGrowthFront();
  const components = useRef<(UE.StaticMeshComponent | null)[]>([]);
  const shown = useMemo(() => placements.map(() => -1), [placements]);
  useFrame(() => {
    if (!front?.active) return;
    placements.forEach((p, i) => {
      const component = components.current[i];
      if (!component) return;
      const behind = metresBehindFront(front.radius, Math.hypot(p.location[0] - front.x, p.location[1] - front.y));
      const grown = Math.max(UNSPROUTED, sprout(behind, GROWTH_STAGES.trees + (p.yaw / 360) * SPROUT_SPREAD_METRES, SPROUT_SPAN_METRES));
      if (shown[i] === grown) return;
      const scale = p.scale * grown;
      component.SetWorldScale3D(new UE.Vector(scale, scale, scale));
      shown[i] = grown;
    });
  });
  const attach = (index: number, component: UE.StaticMeshComponent | null) => {
    components.current[index] = component;
    shown[index] = -1;
  };
  return { attach, sprouting: !!front };
}

function Kind({ placements, variants }: KindProps) {
  const { attach, sprouting } = useSprouting(placements);
  return (
    <>
      {placements.map((p, index) => {
        const { mesh, materials } = variants[p.variant]?.mesh ? variants[p.variant] : variants[0];
        if (!mesh) return null;
        const scale = sprouting ? p.scale * UNSPROUTED : p.scale;
        return (
          <staticMeshComponent
            key={index}
            ref={(component: UE.StaticMeshComponent | null) => attach(index, component)}
            location={p.location}
            rotation={[0, p.yaw, 0]}
            scale={[scale, scale, scale]}
            staticMesh={mesh}
            overrideMaterials={materials}
          />
        );
      })}
    </>
  );
}

export const TREE_SLOTS: [MaterialRef, string][] = [
  [bark, 'Bark'],
  [leaves, 'Leaf'],
];
const ROCK_SLOTS: [MaterialRef, string][] = [[stone, 'Stone']];

const textureMaps =(prefix: string) => [`${prefix}Color`, `${prefix}Normal`, `${prefix}Surface`];

function texturesOf(asset: ContentAsset | undefined, params: string[]) {
  const byName = new Map(asset?.objects.filter((o) => o.class === 'Texture2D').map((o) => [o.path.slice(o.path.lastIndexOf('.') + 1).replace(/^T_/, ''), o.path]));
  const entries = params.map((param) => [param, byName.get(param)] as const);
  return entries.every(([, path]) => path) ? Object.fromEntries(entries as [string, string][]) : undefined;
}

export function useTextured(model: ContentAssetRef, slots: [MaterialRef, string][]): Variant {
  const mesh = useContentMesh(model);
  const asset = useContentAsset(model);
  return useMemo(() => {
    const textures = slots.map(([, prefix]) => texturesOf(asset, textureMaps(prefix)));
    if (!mesh || textures.some((t) => !t)) return { mesh: undefined, materials: [] };
    return { mesh, materials: slots.map(([material], i) => instance(material, textures[i]!)) };
  }, [mesh, asset]);
}

export function Nature() {
  const tree = useTextured(treeModel, TREE_SLOTS);
  const treeTall = useTextured(treeTallModel, TREE_SLOTS);
  const rock = useTextured(rockModel, ROCK_SLOTS);
  const rockFlat = useTextured(rockFlatModel, ROCK_SLOTS);

  const trees = useMemo(() => scatter({ seed: 11, count: 260, extent: EDGE, accept: (x, y, slope) => slope < 28 && offPath(x, y) && Math.abs(y) > 1200, size: [0.8, 1.35], sink: 15, spacing: 450 }), []);
  const rocks = useMemo(() => scatter({ seed: 23, count: 140, extent: EDGE, accept: (x, y, slope) => slope > 16 && offPath(x, y), size: [0.5, 2.2], sink: 35, spacing: 350 }), []);

  return (
    <>
      <Kind placements={trees} variants={[tree, treeTall]} />
      <Kind placements={rocks} variants={[rock, rockFlat]} />
    </>
  );
}
