// Model files are modules of the game code, the way Vite treats every asset: a model reaches the game only when
// code imports it, and nothing is picked up from a folder.
//   import flightCase from '../assets/flight-case.glb';
//   import idle from '../assets/mixamo/animations/idle.fbx?skeleton=../default-humanoid.fbx';
//   import grid from '../assets/ocean/grid.glb?nanite=off';
//   import flag from '../assets/cloth/flag.glb?cloth=./flagCloth.json';
// The query asks for animation clips on a model's skeleton or for a retarget, and carries the model's import
// settings: `nanite=off`, `lods=<triangles>@<screenSize>,...` and `cloth=<settings file>` (content/characters.mjs).
// The module's default export is the asset's handle (shared/engine/content.ts contentAsset): its key is the file's
// path relative to the dev folder, with the query when there is one. In the dev server the handle is filled by the
// content pipeline's builds; in the release build it carries the imported objects' paths.
import { resolve } from 'node:path';
import { contentSpec } from '../content/characters.mjs';

const MODEL = /\.(glb|gltf|fbx|abc|wav|mp3|ogg|flac|opus|aif|aiff)$/i;
const CONTENT_MODULE = '/src/shared/engine/content.ts';

// `onImport(spec)` runs when the game code first loads an import (content/characters.mjs contentSpec) and returns the
// objects to bake into the module (release build) or nothing (dev server, where the pipeline sends them when built).
// `onChange(file)` runs when an imported file, or a settings file an import names, is saved again.
export function contentAssetsPlugin({ root, onImport, onChange }) {
  const modelsOfSettings = new Map();
  return {
    name: 'vge:content-assets',
    // Ahead of Vite's own asset plugin, which would make .glb/.gltf a URL string.
    enforce: 'pre',
    applyToEnvironment: (environment) => environment.name === 'unreal',
    async load(id) {
      const [file, query] = id.split('?');
      if (!MODEL.test(file)) return;
      const spec = contentSpec(root, file, query);
      if (spec.cloth) {
        const settings = resolve(root, spec.cloth).replaceAll('\\', '/');
        modelsOfSettings.set(settings, file);
        this.addWatchFile(settings);
      }
      const objects = await onImport(spec);
      const args = objects ? `${JSON.stringify(spec.key)}, ${JSON.stringify(objects)}` : JSON.stringify(spec.key);
      return { code: `import { contentAsset } from '${CONTENT_MODULE}';\nexport default contentAsset(${args});\n`, moduleType: 'js' };
    },
    // A saved model rebuilds its asset; the module itself stays (its handle is the same), so no code reloads.
    hotUpdate({ file, modules }) {
      const model = modelsOfSettings.get(file.replaceAll('\\', '/'));
      if (model) {
        onChange?.(model);
        return [];
      }
      if (!MODEL.test(file) || modules.length === 0) return;
      onChange?.(file);
      return [];
    },
  };
}
