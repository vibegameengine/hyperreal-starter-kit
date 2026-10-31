export const MOTION_MODULE = /\.motion\.[jt]sx?$/;
const DESCRIBE = '/src/shared/motion/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

export function createMotionModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key));
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, MOTION_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function motionHandleModule(exports, paths = {}) {
  const lines = [`import { motionMatchingAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'motion-matching', key: entry.exportKey, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}), ...(entry.runtime?.continuingPoseCostBias !== undefined ? { continuingPoseCostBias: entry.runtime.continuingPoseCostBias } : {}) };
    const value = `motionMatchingAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildMotionMatching(service, entry, { objectsOf }) {
  const clips = entry.request.clips.map((clip) => {
    if (clip.startsWith('/')) return clip;
    const sequence = (objectsOf(clip) ?? []).find((object) => object.class === 'AnimSequence');
    if (!sequence) throw new Error(`${entry.exportKey}: clip ${clip} has no built animation sequence`);
    return sequence.path;
  });
  const skeleton = entry.request.skeleton.startsWith('/') ? entry.request.skeleton : (objectsOf(entry.request.skeleton) ?? []).find((object) => object.class === 'Skeleton')?.path;
  if (!skeleton) throw new Error(`${entry.exportKey}: ${entry.request.skeleton} has no imported skeleton`);
  const result = await service.call('motion-matching', { path: entry.path.replace(/\.[^./]+$/, ''), skeleton, clips, ...(entry.request.playRate ? { playRate: entry.request.playRate } : {}), ...(entry.request.node ? { node: entry.request.node } : {}), ...(entry.request.schema ? { schema: entry.request.schema } : {}), ...(entry.request.database ? { database: entry.request.database } : {}), ...(entry.request.channels ? { channels: entry.request.channels } : {}), ...(entry.request.normalization ? { normalization: entry.request.normalization } : {}) });
  if (result.error) throw new Error(`${entry.exportKey}: ${result.error} ${JSON.stringify(result.clips ?? [])}`);
  return { path: result.animClass, database: result.database, clips: result.clips, channels: result.channels };
}
