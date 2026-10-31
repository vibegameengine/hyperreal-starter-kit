import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export function clothOf(root, spec) {
  if (!spec.cloth) return undefined;
  const file = resolve(root, spec.cloth);
  return { file, mtimeMs: statSync(file).mtimeMs, description: JSON.parse(readFileSync(file, 'utf8')) };
}
