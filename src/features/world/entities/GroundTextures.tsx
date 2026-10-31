import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useMemo } from 'react';
import { loadContent } from '../../../shared/engine/content';
import { world } from '../../../shared/engine/world';
import { useContentAsset, useFrame } from '../../../shared/react';
import groundTextures from '../assets/scans/ground.glb';

function landscapes() {
  const found = $ref(UE.NewArray(UE.Actor));
  UE.GameplayStatics.GetAllActorsOfClass(world, UE.LandscapeProxy.StaticClass(), found);
  const list = $unref(found);
  return Array.from({ length: list.Num() }, (_, i) => list.Get(i) as UE.LandscapeProxy);
}

export function useGroundTextures() {
  const asset = useContentAsset(groundTextures);
  const textures = useMemo(
    () => (asset?.objects ?? []).filter((o) => o.class === 'Texture2D').map((o) => [o.path.slice(o.path.lastIndexOf('.') + 1), loadContent<UE.Texture>(o.path)] as const),
    [asset],
  );
  const fed = useMemo(() => new Set<UE.LandscapeProxy>(), [textures]);
  useFrame(() => {
    if (!textures.length) return;
    for (const landscape of landscapes()) {
      if (fed.has(landscape)) continue;
      for (const [name, texture] of textures) if (texture) landscape.SetLandscapeMaterialTextureParameterValue(name, texture);
      fed.add(landscape);
    }
  });
}

export function GroundTextures() {
  useGroundTextures();
  return null;
}
