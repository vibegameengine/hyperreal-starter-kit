import * as UE from 'ue';
import { useMemo } from 'react';
import { loadContent } from '../../../shared/engine/content';
import { instance } from '../../../shared/material';
import { useContentAsset } from '../../../shared/react';
import { cliff } from '../assets/coast/cliff.material';
import { COAST_CLIFFS } from '../assets/coast/cliffs/segments';
import { CLIFF_ROCKS, COAST_TEXTURE_MAPS } from '../assets/coastTextures';
import { SEA_LEVEL } from '../assets/coastShape';
import { Ocean } from '../ocean/Ocean';
import groundTextures from '../assets/scans/ground.glb';
import { useGroundTextures } from './GroundTextures';

const CLIFF_MAPS = CLIFF_ROCKS.flatMap((rock) => COAST_TEXTURE_MAPS.map((map) => `${rock}${map}`));

function useCliffMaterial() {
  const asset = useContentAsset(groundTextures);
  return useMemo(() => {
    const byName = new Map(asset?.objects.filter((o) => o.class === 'Texture2D').map((o) => [o.path.slice(o.path.lastIndexOf('.') + 1), o.path]));
    const textures = CLIFF_MAPS.map((name) => [name, byName.get(name)] as const);
    return textures.every(([, path]) => path) ? instance(cliff, Object.fromEntries(textures as [string, string][])) : undefined;
  }, [asset]);
}

function useCliffMeshes() {
  const asset = useContentAsset(COAST_CLIFFS);
  return useMemo(() => (asset?.meshes ?? []).map((path) => loadContent<UE.StaticMesh>(path)).filter((mesh): mesh is UE.StaticMesh => !!mesh), [asset]);
}

export function Coast() {
  useGroundTextures();
  const cliffMaterial = useCliffMaterial();
  const cliffMeshes = useCliffMeshes();
  return (
    <>
      {cliffMaterial && cliffMeshes.map((mesh, index) => <staticMeshComponent key={index} location={[0, 0, 0]} staticMesh={mesh} overrideMaterials={[cliffMaterial]} />)}
      <Ocean seaLevel={SEA_LEVEL} />
    </>
  );
}
