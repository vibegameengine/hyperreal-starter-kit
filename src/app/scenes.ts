import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { createElement } from 'react';
import { disposeScope, own, world } from '../shared/engine/world';
import { createSceneRoot } from '../shared/react';
import type { SceneModule } from '../shared/lib/devLab';

async function loadLab(id: string): Promise<SceneModule | undefined> {
  if (!import.meta.env.DEV) return undefined;
  const { LABS } = await import('./labs');
  return LABS.find((lab) => lab.id === id)?.load();
}

function loadScene(id: string): Promise<SceneModule | undefined> {
  if (id === 'main') return import('../scenes/main');
  if (id === 'world') return import('../scenes/world');
  if (id.startsWith('labs/')) return loadLab(id.slice('labs/'.length));
  return Promise.resolve(undefined);
}

declare const __vge: { app?: { scene?: string } };
const app = (__vge.app ??= {});

function sceneFromCommandLine() {
  const value = $ref('');
  return UE.KismetSystemLibrary.ParseParamValue(UE.KismetSystemLibrary.GetCommandLine(), 'Scene=', value) ? $unref(value) : undefined;
}

export const initialScene = () => app.scene ?? sceneFromCommandLine() ?? 'main';

export async function openScene(id: string) {
  const started = Date.now();
  const module = await loadScene(id);
  if (!module) {
    console.error(`[scenes] no scene '${id}' in this build; the main scene is 'main', labs are 'labs/<id>' in the dev build`);
    return false;
  }
  disposeScope('scene');
  app.scene = id;
  if (module.Scene) {
    const root = createSceneRoot(world);
    root.render(createElement(module.Scene));
    own(() => root.unmount());
  } else {
    await module.default();
  }
  console.log(`[scenes] opened ${id} in ${Date.now() - started} ms`);
  return true;
}
