import * as UE from 'ue';
import { useMemo } from 'react';
import { loadContent } from '../../../shared/engine/content';
import { instance } from '../../../shared/material';
import { useContentAsset, useFrame } from '../../../shared/react';
import { cliff } from '../assets/coast/cliff';
import { COAST_CLIFFS } from '../assets/coast/cliffs/segments';
import { CLIFF_ROCKS, COAST_TEXTURE_MAPS } from '../assets/coastTextures';
import { coastHeights, SEA_LEVEL } from '../assets/coastShape';
import { SHORE_EXTENT, SHORE_FIELD_RES, SHORE_ORIGIN, SHORE_RES, SHORE_TRAVEL_SIZE, SWELL_DIRECTION } from '../assets/ocean/oceanShore';
import { useSurfSound } from './SurfSound';
import { landscapes } from './landscapes';
import { useSandTrail } from './SandTrail';
import { SandKick } from './SandKick';
import { WaterSplash } from './WaterSplash';
import { Ocean, useShoreTextures, type ShoreTextures } from '../ocean/Ocean';
import type { ShoreDomain } from '../ocean/shoreField';
import groundTextures from '../assets/scans/ground.glb';
import { useGroundTextures } from './GroundTextures';

const CM = 100;

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
  return useMemo(() => {
    const meshes = (asset?.meshes ?? []).map((path) => loadContent<UE.StaticMesh>(path)).filter((mesh): mesh is UE.StaticMesh => !!mesh);
    for (const mesh of meshes) if (mesh.BodySetup) mesh.BodySetup.CollisionTraceFlag = UE.ECollisionTraceFlag.CTF_UseComplexAsSimple;
    return meshes;
  }, [asset]);
}

const COAST_SHORE: ShoreDomain = {
  heightsAt: (x, y) => {
    const [ground, wave] = coastHeights(x * CM, y * CM);
    return [(ground - SEA_LEVEL) / CM, (wave - SEA_LEVEL) / CM] as const;
  },

  origin: SHORE_ORIGIN,
  size: SHORE_EXTENT,
  res: SHORE_RES,
  fieldRes: SHORE_FIELD_RES,
  swellDir: SWELL_DIRECTION,
  travelSize: SHORE_TRAVEL_SIZE,
};

export function useShoreOnSand(shore: ShoreTextures) {
  const fed = useMemo(() => new Set<UE.LandscapeProxy>(), [shore]);
  useFrame(() => {
    for (const landscape of landscapes()) {
      if (fed.has(landscape)) continue;
      landscape.SetLandscapeMaterialTextureParameterValue('OceanShoreState', shore.state);
      landscape.SetLandscapeMaterialTextureParameterValue('OceanLace', shore.lace);
      landscape.SetLandscapeMaterialScalarParameterValue('OceanShoreEnabled', 1);
      fed.add(landscape);
    }
  });
}

export function Coast() {
  useGroundTextures();
  const cliffMaterial = useCliffMaterial();
  const cliffMeshes = useCliffMeshes();
  const shore = useShoreTextures(COAST_SHORE);
  useShoreOnSand(shore);
  useSurfSound(shore);
  useSandTrail(shore);
  return (
    <>
      {cliffMaterial && cliffMeshes.map((mesh, index) => <staticMeshComponent key={index} location={[0, 0, 0]} staticMesh={mesh} overrideMaterials={[cliffMaterial]} />)}
      <Ocean seaLevel={SEA_LEVEL} shore={shore} />
      <SandKick />
      <WaterSplash />
    </>
  );
}
