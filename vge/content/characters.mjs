// Characters and their animations from model files, as the game code imports them (vite/contentAssetsPlugin.mjs):
//   import mixamo from '../assets/mixamo/default-humanoid.fbx';                                   a model
//   import idle from '../assets/mixamo/animations/idle.fbx?skeleton=../default-humanoid.fbx';      clips on its skeleton
//   import idleOnManny from './idle.fbx?skeleton=../default-humanoid.fbx&retarget=manny';           those clips retargeted
//   import mixamoMoves from '../assets/mixamo/default-humanoid.fbx?retargetFrom=manny';            Manny's clips on it
// `skeleton` is the model file whose skeleton the animation-only file was made for, relative to that file. `retarget`
// and `retargetFrom` name a character of the project (CHARACTERS) or another model file. Retargeting runs in the
// content service the way the editor's Retarget Animations window does with an auto-generated retargeter
// (Source/VibeGameEngineTools/Private/VgeRetargeter.cpp).
import { dirname, relative, resolve } from 'node:path';
import { isSound } from './sound.mjs';

// Characters that ship with the project, by the name the imports use.
export const CHARACTERS = {
  manny: {
    mesh: '/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple',
    animationFolder: '/Game/Characters/Mannequins/Anims/Unarmed',
  },
};

// What an import asks for: { key, file, kind: 'model' | 'clips' | 'retargetFrom', model?, retarget?, from? }.
// `key` is the identity the game code's import carries: the file's path relative to the dev folder, plus the query
// with any file in it relative to the dev folder too.
export function specOfModelKey(root, modelKey) {
  const [path, query] = modelKey.split('?');
  return contentSpec(root, resolve(root, path), query);
}

export function contentSpec(root, file, query) {
  const keyOf = (path) => relative(root, path).replaceAll('\\', '/');
  const params = new URLSearchParams(query ?? '');
  if (isSound(file)) {
    const optimize = params.get('audio-optimize') !== 'off';
    return { key: optimize ? keyOf(file) : `${keyOf(file)}?audio-optimize=off`, file, kind: 'sound', optimize };
  }
  const character = (value, from) => (value in CHARACTERS ? { character: value } : { model: keyOf(resolve(dirname(from), value)) });
  const skeleton = params.get('skeleton');
  if (skeleton) {
    const model = keyOf(resolve(dirname(file), skeleton));
    const retarget = params.get('retarget') ? character(params.get('retarget'), file) : null;
    const query = `skeleton=${model}${retarget ? `&retarget=${retarget.character ?? retarget.model}` : ''}`;
    return { key: `${keyOf(file)}?${query}`, file, kind: 'clips', model, retarget };
  }
  const from = params.get('retargetFrom');
  if (from) {
    const source = character(from, file);
    return { key: `${keyOf(file)}?retargetFrom=${source.character ?? source.model}`, file, kind: 'retargetFrom', model: keyOf(file), from: source };
  }
  return { key: keyOf(file), file, kind: 'model' };
}

// The model files an import needs built first.
export function modelsOf(spec) {
  return [spec.model, spec.retarget?.model, spec.from?.model].filter(Boolean);
}

const first = (objects, cls) => objects?.find((object) => object.class === cls)?.path;

// Imports what a clips or retargetFrom spec asks for into the content folder `dest` and returns its objects.
// `modelObjects(key)` gives the objects of a model file already imported.
export async function importSpec(service, spec, dest, { modelObjects }) {
  const meshOf = (target) => (target.character ? CHARACTERS[target.character].mesh : first(modelObjects(target.model), 'SkeletalMesh'));
  if (spec.kind === 'clips') {
    const model = modelObjects(spec.model);
    const skeleton = first(model, 'Skeleton');
    if (!skeleton) throw new Error(`${spec.model} has no skeleton to put ${spec.file} on`);
    const clips = await service.call('import-animations', { source: spec.file, dest, skeleton });
    if (!spec.retarget) return clips.objects;
    const retargeted = await service.call('retarget', {
      source: first(model, 'SkeletalMesh'),
      target: meshOf(spec.retarget),
      animations: clips.objects.filter((o) => o.class === 'AnimSequence').map((o) => o.path),
      dest: `${dest}/Retargeted`,
    });
    return retargeted.objects;
  }
  const target = first(modelObjects(spec.model), 'SkeletalMesh');
  if (!target) throw new Error(`${spec.file} has no skeletal mesh to retarget onto`);
  const request = spec.from.character
    ? { source: CHARACTERS[spec.from.character].mesh, animationFolder: CHARACTERS[spec.from.character].animationFolder }
    : { source: meshOf(spec.from), animations: modelObjects(spec.from.model).filter((o) => o.class === 'AnimSequence').map((o) => o.path) };
  const retargeted = await service.call('retarget', { ...request, target, dest });
  return retargeted.objects;
}
