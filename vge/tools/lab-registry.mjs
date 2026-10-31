import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LAB_ID = /defineLab\(\{\s*id:\s*'([^']+)'/g;
const PREVIEW_KEY = /^\s*(?:'([^']+)'|([A-Za-z]+))[,:]/gm;

export const labIds = (root) => [...readFileSync(join(root, 'src', 'app', 'labs.ts'), 'utf8').matchAll(LAB_ID)].map((match) => match[1]);

export function previewIds(root) {
  const source = readFileSync(join(root, 'src', 'ui', 'app', 'labs', 'previews.ts'), 'utf8');
  const record = source.slice(source.indexOf('LAB_PREVIEWS'));
  return [...record.matchAll(PREVIEW_KEY)].map((match) => match[1] ?? match[2]);
}
