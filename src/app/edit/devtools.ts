import { flushSceneWork } from '../../shared/react/renderer';

const HOST_ROOT = 3;

interface RendererInternals {
  rendererPackageName: string;
  overrideProps(fiber: any, path: (string | number)[], value: unknown): void;
}

const devtoolsHook = () => (globalThis as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;

function sceneRenderer(): RendererInternals {
  let latest: RendererInternals | undefined;
  for (const internals of devtoolsHook().renderers.values()) if (internals.rendererPackageName === 'vge-scene') latest = internals;
  if (!latest) throw new Error('the scene renderer is not registered with the DevTools hook');
  return latest;
}

function isCurrent(fiber: any) {
  let node = fiber;
  while (node.return) node = node.return;
  return node.tag === HOST_ROOT && node.stateNode?.current === node;
}

export const currentOf = (fiber: any) => (isCurrent(fiber) ? fiber : (fiber.alternate ?? fiber));

export function ownerChainOf(hostFiber: any) {
  const chain = [currentOf(hostFiber)];
  for (let owner = chain[0]._debugOwner; owner && typeof owner.type === 'function'; owner = owner._debugOwner) chain.push(currentOf(owner));
  return chain;
}

export const creationStackOf = (fiber: any): string => currentOf(fiber)._debugStack?.stack ?? '';

export const propsOf = (fiber: any): Record<string, any> => currentOf(fiber).memoizedProps ?? {};

export function overridePath(fiber: any, path: readonly (string | number)[], value: unknown) {
  sceneRenderer().overrideProps(currentOf(fiber), [...path], value);
  flushSceneWork();
}

export const overrideProp = (fiber: any, prop: string, value: unknown) => overridePath(fiber, [prop], value);
