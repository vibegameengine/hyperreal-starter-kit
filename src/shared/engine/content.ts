import * as UE from 'ue';
import type { MaterialParamType, MaterialRef } from '../material/types';
import type { NiagaraSystemRef } from '../niagara';
import type { MotionMatchingRef } from '../motion';
import type { ComputeRef } from '../compute';
import type { TerrainRef } from '../terrain';
import type { PcgGraphRef } from '../pcg';
import type { GeometryCollectionRef } from '../fracture';
import { gameInstance, own } from './world';

export interface ContentObject {
  path: string;
  class: string;
}

export interface ContentAssetRef {
  readonly key: string;
  readonly objects?: ContentObject[];
}

export interface ContentAsset {
  build: number;
  meshes: string[];
  skeletalMeshes: string[];
  animations: string[];
  sounds: string[];
  objects: ContentObject[];
}
export interface ContentPack {
  name: string;
  pak: string;
  shaderLibrary: string;
  build: number;
}
export interface ContentMaterial {
  path: string;
  class: string;
  kind: 'material' | 'instance';
  usage: string[];
  params: Record<string, MaterialParamType>;
  build: number;
}
export interface ContentNiagara {
  path: string;
  user: NiagaraSystemRef['user'];
  build: number;
}
interface ContentContainer {
  name: string;
  pak: string;
  shaderLibrary: string;
  build: number;
}
interface Manifest {
  plugin: string;
  build: number;
  containers: ContentContainer[];
  assets: Record<string, { build: number; objects: ContentObject[] }>;
  materials?: Record<string, ContentMaterial>;
  niagara?: Record<string, ContentNiagara>;
  terrain?: Record<string, ContentTerrain>;
  motion?: Record<string, ContentTerrain>;
  compute?: Record<string, ContentTerrain>;
  pcg?: Record<string, ContentTerrain>;
  fracture?: Record<string, ContentTerrain>;
  packs: Record<string, ContentPack>;
}
export interface ContentClip {
  path: string;
  length: number;
  rootSpeed: number;
}
export interface ContentTerrain {
  path: string;
  build: number;
  clips?: ContentClip[];
}
type TerrainListener = (terrain: ContentTerrain) => void;
type AssetListener = (asset: ContentAsset) => void;
type PackListener = (pack: ContentPack) => void;
type MaterialListener = (material: ContentMaterial) => void;
type NiagaraListener = (system: ContentNiagara) => void;

interface LiveContent {
  mounted: Set<string>;
  manifest: Manifest | null;
  listeners: Map<string, Set<AssetListener>>;
  packListeners?: Map<string, Set<PackListener>>;
  materialListeners?: Map<string, Set<MaterialListener>>;
  niagaraListeners?: Map<string, Set<NiagaraListener>>;
  terrainListeners?: Map<string, Set<TerrainListener>>;
  motionListeners?: Map<string, Set<TerrainListener>>;
  computeListeners?: Map<string, Set<TerrainListener>>;
  pcgListeners?: Map<string, Set<TerrainListener>>;
  fractureListeners?: Map<string, Set<TerrainListener>>;
  previews?: Map<string, { importing: UE.VgeAssetPreview; objects: Map<string, UE.Object>; listed: ContentObject[] }>;
}
declare const __vge: { content?: LiveContent };

const live: LiveContent = (__vge.content ??= { mounted: new Set(), manifest: null, listeners: new Map() });
const packListeners = (live.packListeners ??= new Map());
const materialListeners = (live.materialListeners ??= new Map());
const niagaraListeners = (live.niagaraListeners ??= new Map());
const terrainListeners = (live.terrainListeners ??= new Map());
const motionListeners = (live.motionListeners ??= new Map());
const computeListeners = (live.computeListeners ??= new Map());
const pcgListeners = (live.pcgListeners ??= new Map());
const fractureListeners = (live.fractureListeners ??= new Map());
const previews = (live.previews ??= new Map());
const PREVIEW_TIMEOUT_MS = 30000;
const PREVIEW_POLL_MS = 30;
const KIT_MASTERS: [string, string][] = [
  ['/InterchangeAssets/gltf/', '/Game/Vge/Materials/Gltf/'],
  ['/InterchangeAssets/Materials/', '/Game/Vge/Materials/Interchange/'],
];

function masterOf(material: UE.MaterialInterface): UE.MaterialInterface {
  let current = material;
  while (current instanceof UE.MaterialInstance && current.Parent) current = current.Parent;
  return current;
}

function onKitMaster(material: UE.MaterialInstanceDynamic) {
  const source = UE.KismetSystemLibrary.GetPathName(masterOf(material));
  const set = KIT_MASTERS.find(([from]) => source.startsWith(from));
  if (!set) return material;
  const name = source.slice(set[0].length).split('.')[0];
  const master = UE.Object.Load(`${set[1]}${name}.${name}`) as UE.MaterialInterface | undefined;
  if (!master) return material;
  const instance = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(gameInstance, master, '', UE.EMIDCreationFlags.None);
  instance.K2_CopyMaterialInstanceParameters(material, false);
  return instance;
}

function useKitMasters(objects: UE.Object[]) {
  const replaced = new Map<UE.Object, UE.MaterialInterface>();
  for (const object of objects) if (object instanceof UE.MaterialInstanceDynamic) replaced.set(object, onKitMaster(object));
  for (const object of objects) {
    if (!(object instanceof UE.StaticMesh)) continue;
    const slots = object.StaticMaterials;
    for (let index = 0; index < slots.Num(); index++) {
      const slot = slots.Get(index);
      const kit = replaced.get(slot.MaterialInterface);
      if (!kit) continue;
      slot.MaterialInterface = kit;
      slots.Set(index, slot);
    }
  }
}

export function contentAsset(key: string, objects?: ContentObject[]): ContentAssetRef {
  return { key, objects };
}

export const assetName = (ref: ContentAssetRef) =>
  ref.key
    .replace(/^.*\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

function describe(build: number, objects: ContentObject[]): ContentAsset {
  const byClass = (cls: string) => objects.filter((o) => o.class === cls).map((o) => o.path);
  return { build, meshes: byClass('StaticMesh'), skeletalMeshes: byClass('SkeletalMesh'), animations: byClass('AnimSequence'), sounds: byClass('SoundWave'), objects };
}

export function loadContent<T extends UE.Object>(path: string): T | undefined {
  for (const preview of previews.values()) {
    const object = preview.objects.get(path);
    if (object) return object as T;
  }
  const object = UE.Object.Load(path) as T | undefined;
  if (!object) console.error(`[content] ${path} is not loadable from build ${live.manifest?.build ?? 'release'}`);
  return object;
}

function notify(key: string, asset: ContentAsset, listeners: Iterable<AssetListener>) {
  for (const listener of listeners) {
    try {
      listener(asset);
    } catch (err: any) {
      console.error(`[content] ${key} listener failed: ${err?.stack ?? err}`);
    }
  }
}

function notifyBuilt(table: Map<string, Set<TerrainListener>>, now: Record<string, ContentTerrain> | undefined, before: Record<string, ContentTerrain> | undefined) {
  for (const [key, listeners] of table) {
    const built = now?.[key];
    if (built && (before?.[key]?.path !== built.path || before?.[key]?.build !== built.build)) notifyTerrain(key, built, listeners);
  }
}

function apply(manifest: Manifest | null) {
  try {
    if (!manifest) return;
    for (const container of manifest.containers ?? []) {
      if (live.mounted.has(container.pak)) continue;
      if (!gameInstance.MountContent(container.pak, manifest.plugin, container.shaderLibrary)) {
        console.error(`[content] could not mount ${container.pak}`);
        return;
      }
      live.mounted.add(container.pak);
    }
    const previous = live.manifest;
    for (const pack of Object.values(manifest.packs ?? {})) {
      if (live.mounted.has(pack.pak)) continue;
      if (!gameInstance.MountContent(pack.pak, manifest.plugin, pack.shaderLibrary)) {
        console.error(`[content] could not mount pack ${pack.name} (${pack.pak})`);
        continue;
      }
      live.mounted.add(pack.pak);
    }
    live.manifest = manifest;
    for (const [key, listeners] of live.listeners) {
      const entry = manifest.assets[key];
      if (!entry || previous?.assets[key]?.build === entry.build) continue;
      previews.delete(key);
      notify(key, describe(entry.build, entry.objects), listeners);
    }
    for (const [name, listeners] of packListeners) {
      const pack = manifest.packs?.[name];
      if (pack && previous?.packs?.[name]?.build !== pack.build) notifyPack(pack, listeners);
    }
    for (const [key, listeners] of materialListeners) {
      const material = manifest.materials?.[key];
      if (material && previous?.materials?.[key]?.path !== material.path) notifyMaterial(key, material, listeners);
    }
    for (const [key, listeners] of niagaraListeners) {
      const system = manifest.niagara?.[key];
      if (system && previous?.niagara?.[key]?.path !== system.path) notifyNiagara(key, system, listeners);
    }
    notifyBuilt(terrainListeners, manifest.terrain, previous?.terrain);
    notifyBuilt(motionListeners, manifest.motion, previous?.motion);
    notifyBuilt(computeListeners, manifest.compute, previous?.compute);
    notifyBuilt(pcgListeners, manifest.pcg, previous?.pcg);
    notifyBuilt(fractureListeners, manifest.fracture, previous?.fracture);
    console.log(`[content] build ${manifest.build} mounted, assets: ${Object.keys(manifest.assets).join(', ')}; packs: ${Object.keys(manifest.packs ?? {}).join(', ')}`);
  } catch (err: any) {
    console.error(`[content] applying build ${manifest?.build} failed: ${err?.stack ?? err}`);
  }
}

function preview({ key, file }: { key: string; file: string }) {
  const building = live.manifest?.assets[key]?.build;
  const importing = UE.VgeAssetPreview.Import(file, `/Game/VgePreview/${assetName({ key })}_${Date.now()}`);
  const started = Date.now();
  const poll = () => {
    if (live.manifest?.assets[key]?.build !== building) return;
    if (!importing.IsDone()) {
      if (Date.now() - started < PREVIEW_TIMEOUT_MS) setTimeout(poll, PREVIEW_POLL_MS);
      return;
    }
    const found = importing.Objects();
    const objects = new Map<string, UE.Object>();
    const listed: ContentObject[] = [];
    for (let index = 0; index < found.Num(); index++) {
      const object = found.Get(index);
      const path = UE.KismetSystemLibrary.GetPathName(object);
      objects.set(path, object);
      listed.push({ path, class: object.GetClass().GetName() });
    }
    useKitMasters([...objects.values()]);
    previews.set(key, { importing, objects, listed });
    console.log(`[content] ${key} previewed from its file in ${Date.now() - started} ms`);
    notify(key, describe(-1, listed), live.listeners.get(key) ?? []);
  };
  poll();
}

export function onAsset(ref: ContentAssetRef, listener: AssetListener) {
  if (ref.objects) {
    notify(ref.key, describe(0, ref.objects), [listener]);
    return own(() => {});
  }
  if (!live.listeners.has(ref.key)) live.listeners.set(ref.key, new Set());
  live.listeners.get(ref.key)!.add(listener);
  const entry = live.manifest?.assets[ref.key];
  const previewed = previews.get(ref.key);
  if (previewed) notify(ref.key, describe(-1, previewed.listed), [listener]);
  else if (entry) notify(ref.key, describe(entry.build, entry.objects), [listener]);
  return own(() => live.listeners.get(ref.key)?.delete(listener));
}

function notifyPack(pack: ContentPack, listeners: Iterable<PackListener>) {
  for (const listener of listeners) {
    try {
      listener(pack);
    } catch (err: any) {
      console.error(`[content] pack ${pack.name} listener failed: ${err?.stack ?? err}`);
    }
  }
}

export function onPack(name: string, listener: PackListener) {
  if (!packListeners.has(name)) packListeners.set(name, new Set());
  packListeners.get(name)!.add(listener);
  const pack = live.manifest?.packs?.[name];
  if (pack) notifyPack(pack, [listener]);
  return own(() => packListeners.get(name)?.delete(listener));
}

function notifyMaterial(key: string, material: ContentMaterial, listeners: Iterable<MaterialListener>) {
  for (const listener of listeners) {
    try {
      listener(material);
    } catch (err: any) {
      console.error(`[content] material ${key} listener failed: ${err?.stack ?? err}`);
    }
  }
}

export function materialAsset(ref: MaterialRef): MaterialRef {
  return ref;
}

export function currentMaterial(ref: MaterialRef): ContentMaterial | undefined {
  if (ref.path) return { path: ref.path, class: ref.kind === 'instance' ? 'MaterialInstanceConstant' : 'Material', kind: ref.kind, usage: [...ref.usage], params: { ...ref.params }, build: 0 };
  return live.manifest?.materials?.[ref.key];
}

export function onMaterial(ref: MaterialRef, listener: MaterialListener) {
  const now = currentMaterial(ref);
  if (ref.path) {
    if (now) notifyMaterial(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!materialListeners.has(ref.key)) materialListeners.set(ref.key, new Set());
  materialListeners.get(ref.key)!.add(listener);
  if (now) notifyMaterial(ref.key, now, [listener]);
  return own(() => materialListeners.get(ref.key)?.delete(listener));
}

function notifyNiagara(key: string, system: ContentNiagara, listeners: Iterable<NiagaraListener>) {
  for (const listener of listeners) {
    try {
      listener(system);
    } catch (err: any) {
      console.error(`[content] system ${key} listener failed: ${err?.stack ?? err}`);
    }
  }
}

function notifyTerrain(key: string, terrain: ContentTerrain, listeners: Iterable<TerrainListener>) {
  for (const listener of listeners) {
    try {
      listener(terrain);
    } catch (err: any) {
      console.error(`[content] terrain ${key} listener failed: ${err?.stack ?? err}`);
    }
  }
}

export function terrainAsset(ref: TerrainRef): TerrainRef {
  return ref;
}

export function onTerrain(ref: TerrainRef, listener: TerrainListener) {
  const now = ref.path ? { path: ref.path, build: 0 } : live.manifest?.terrain?.[ref.key];
  if (ref.path) {
    if (now) notifyTerrain(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!terrainListeners.has(ref.key)) terrainListeners.set(ref.key, new Set());
  terrainListeners.get(ref.key)!.add(listener);
  if (now) notifyTerrain(ref.key, now, [listener]);
  return own(() => terrainListeners.get(ref.key)?.delete(listener));
}

export function motionMatchingAsset(ref: MotionMatchingRef): MotionMatchingRef {
  return ref;
}

export function onMotionMatching(ref: MotionMatchingRef, listener: TerrainListener) {
  const now = ref.path ? { path: ref.path, build: 0 } : live.manifest?.motion?.[ref.key];
  if (ref.path) {
    if (now) notifyTerrain(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!motionListeners.has(ref.key)) motionListeners.set(ref.key, new Set());
  motionListeners.get(ref.key)!.add(listener);
  if (now) notifyTerrain(ref.key, now, [listener]);
  return own(() => motionListeners.get(ref.key)?.delete(listener));
}

export function computeAsset(ref: ComputeRef): ComputeRef {
  return ref;
}

export function onCompute(ref: ComputeRef, listener: TerrainListener) {
  const now = ref.path ? { path: ref.path, build: 0 } : live.manifest?.compute?.[ref.key];
  if (ref.path) {
    if (now) notifyTerrain(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!computeListeners.has(ref.key)) computeListeners.set(ref.key, new Set());
  computeListeners.get(ref.key)!.add(listener);
  if (now) notifyTerrain(ref.key, now, [listener]);
  return own(() => computeListeners.get(ref.key)?.delete(listener));
}

export function pcgAsset(ref: PcgGraphRef): PcgGraphRef {
  return ref;
}

export function onPcg(ref: PcgGraphRef, listener: TerrainListener) {
  const now = ref.path ? { path: ref.path, build: 0 } : live.manifest?.pcg?.[ref.key];
  if (ref.path) {
    if (now) notifyTerrain(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!pcgListeners.has(ref.key)) pcgListeners.set(ref.key, new Set());
  pcgListeners.get(ref.key)!.add(listener);
  if (now) notifyTerrain(ref.key, now, [listener]);
  return own(() => pcgListeners.get(ref.key)?.delete(listener));
}

export function niagaraAsset(ref: NiagaraSystemRef): NiagaraSystemRef {
  return ref;
}

export function currentNiagara(ref: NiagaraSystemRef): ContentNiagara | undefined {
  if (ref.path) return { path: ref.path, user: ref.user, build: 0 };
  return live.manifest?.niagara?.[ref.key];
}

export function onNiagara(ref: NiagaraSystemRef, listener: NiagaraListener) {
  const now = currentNiagara(ref);
  if (ref.path) {
    if (now) notifyNiagara(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!niagaraListeners.has(ref.key)) niagaraListeners.set(ref.key, new Set());
  niagaraListeners.get(ref.key)!.add(listener);
  if (now) notifyNiagara(ref.key, now, [listener]);
  return own(() => niagaraListeners.get(ref.key)?.delete(listener));
}

export function onMesh(ref: ContentAssetRef, listener: (mesh: UE.StaticMesh) => void) {
  return onAsset(ref, (asset) => {
    const mesh = asset.meshes[0] && loadContent<UE.StaticMesh>(asset.meshes[0]);
    if (mesh) listener(mesh);
  });
}

if (import.meta.hot) {
  import.meta.hot.on('vge:content', apply);
  import.meta.hot.on('vge:content-preview', preview);
  import.meta.hot.on('vge:content-error', (e: { file: string; message: string }) => console.error(`[content] ${e.file}: ${e.message}`));
  import.meta.hot.send('vge:content-sync');
}

export function geometryCollectionAsset(ref: GeometryCollectionRef): GeometryCollectionRef {
  return ref;
}

export function onGeometryCollection(ref: GeometryCollectionRef, listener: TerrainListener) {
  const now = ref.path ? { path: ref.path, build: 0 } : live.manifest?.fracture?.[ref.key];
  if (ref.path) {
    if (now) notifyTerrain(ref.key, now, [listener]);
    return own(() => {});
  }
  if (!fractureListeners.has(ref.key)) fractureListeners.set(ref.key, new Set());
  fractureListeners.get(ref.key)!.add(listener);
  if (now) notifyTerrain(ref.key, now, [listener]);
  return own(() => fractureListeners.get(ref.key)?.delete(listener));
}
