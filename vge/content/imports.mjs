// What the game's code imports of the content the pipeline builds, read from the source files themselves: every model
// file import (with its query, as content/characters.mjs contentSpec keys it), every material module and every
// Niagara module. A build of something no file imports any more is removed (content/pipeline.mjs removeUnused), so
// deleting an import from the code frees what it took on disk. The source files are read, not the module graph of the
// running game: a lab that is not open still keeps what it imports.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { init, parse } from 'es-module-lexer';
import { transformSync } from 'esbuild';
import { contentSpec, modelsOf } from './characters.mjs';

const MODEL = /\.(glb|gltf|fbx|wav|mp3|ogg|flac|opus|aif|aiff)$/i;
const CODE = /\.(m?[jt]sx?)$/;
const MODULE_EXTENSIONS = ['', '.tsx', '.ts', '.jsx', '.js'];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (CODE.test(entry.name) && !entry.name.endsWith('.d.ts')) yield path;
  }
}

// `root` is the checkout (keys are paths relative to it), `srcDir` the folder of the game's code. Returns the keys of
// the model imports and the models they are built on, the keys of the material, Niagara and terrain modules imported, and the
// files that could not be read (one being saved with a syntax error): with any, what is imported is not known.
export async function importedContent({ root, srcDir }) {
  await init;
  const keyOf = (path) => relative(root, path).replaceAll('\\', '/');
  const models = new Set();
  const modules = new Set();
  const unreadable = [];
  for (const file of sourceFiles(srcDir)) {
    // esbuild takes the types and JSX out, which the lexer does not read; an import nothing uses is dropped with them.
    let imports;
    try {
      const loader = file.match(CODE)[1].replace(/^m/, '');
      [imports] = parse(transformSync(readFileSync(file, 'utf8'), { loader, format: 'esm' }).code);
    } catch {
      unreadable.push(keyOf(file));
      continue;
    }
    for (const { n: specifier } of imports) {
      if (!specifier || !specifier.startsWith('.')) continue;
      const [path, query] = specifier.split('?');
      const target = resolve(dirname(file), path);
      if (MODEL.test(path)) {
        const spec = contentSpec(root, target, query);
        models.add(spec.key);
        for (const model of modelsOf(spec)) models.add(model);
        continue;
      }
      if (!/\.(material|niagara|terrain|motion|compute|pcg|fracture)(\.[jt]sx?)?$/.test(path)) continue;
      const found = MODULE_EXTENSIONS.map((extension) => target + extension).find((candidate) => existsSync(candidate) && CODE.test(candidate));
      if (found) modules.add(keyOf(found));
    }
  }
  return { models, modules, unreadable };
}
