import { relative } from 'node:path';
import { componentProps, pathEdit } from './propSource.mjs';
import { createSourceLocator, sourceUrlPlugin } from './sourceLocator.mjs';
import { analyseVector, analyseWhole, applyReplacements, levelOf, parseTsx, tagNameOf, valueEdit } from './tsxSource.mjs';
import { createHistory, readSource, writeIfUnchanged } from './writer.mjs';

export function liveEditPlugins({ root }) {
  let server;
  const environment = () => server.environments.unreal;
  const locator = createSourceLocator({ environment, root });
  const history = createHistory();
  const shortPath = (file) => relative(root, file).replaceAll('\\', '/');

  function locateLevels(stacks) {
    const levels = [];
    for (const stack of stacks) {
      const location = locator.locate(stack);
      if (location.outsideSources) break;
      if (location.reason) return { levels, missing: `level ${levels.length}: ${location.reason}` };
      const level = levelOf(parseTsx(location.file, location.text), location.offset);
      if (!level) return { levels, missing: `level ${levels.length}: no JSX element at ${shortPath(location.file)}:${location.line}:${location.column}` };
      levels.push({ ...location, ...level, matchesDisk: readSource(location.file).text === location.text });
    }
    return { levels };
  }

  function inspect({ chain }) {
    const { levels, missing } = locateLevels(chain);
    const located = missing ? [missing] : [];
    if (!levels.length) return { levels: [], axes: [null, null, null], rotation: null, scale: null, props: [], reasons: located };
    const location = analyseVector({ levels, prop: 'location' });
    const rotation = analyseWhole({ levels, prop: 'rotation', neutral: [0, 0, 0] });
    const scale = analyseWhole({ levels, prop: 'scale', neutral: 1 });
    return {
      levels: levels.map(({ file, line, column, tag, matchesDisk }) => ({ file: shortPath(file), line, column, tag: tagNameOf(tag), matchesDisk })),
      axes: location.axes,
      rotation: rotation.target,
      scale: scale.target,
      props: levels.map((_, level) => componentProps(levels, level) ?? null),
      reasons: [...located, ...location.reasons, ...rotation.reasons, ...scale.reasons],
    };
  }

  function commit({ edits }, client) {
    const byFile = new Map();
    for (const { stack, prop, path, value } of edits) {
      const location = locator.locate(stack);
      if (location.outsideSources || location.reason) throw new Error(`an edited element has no source location${location.reason ? `: ${location.reason}` : ''}`);
      const disk = readSource(location.file).text;
      if (disk !== location.text) throw new Error(`${shortPath(location.file)} changed on disk after the game loaded it; select the object again`);
      let entry = byFile.get(location.file);
      if (!entry) byFile.set(location.file, (entry = { before: disk, sourceFile: parseTsx(location.file, disk), replacements: [] }));
      entry.replacements.push(...(path ? pathEdit(entry.sourceFile, location.offset, path, value) : valueEdit(disk, entry.sourceFile, location.offset, prop, value)));
    }
    const files = [];
    for (const [path, { before, replacements }] of byFile) {
      if (!replacements.length) continue;
      const after = applyReplacements(before, replacements);
      writeIfUnchanged(path, before, after);
      files.push({ path, before, after });
    }
    if (files.length) history.record(client, files);
    return { files: files.map(({ path }) => shortPath(path)) };
  }

  const operations = {
    inspect: (request) => inspect(request),
    commit: (request, client) => commit(request, client),
    undo: (_request, client) => ({ files: history.undo(client).map(shortPath) }),
    redo: (_request, client) => ({ files: history.redo(client).map(shortPath) }),
    stats: () => locator.stats(),
  };

  return [
    sourceUrlPlugin({ root }),
    {
      name: 'vge:live-edit',
      configureServer(viteServer) {
        server = viteServer;
        environment().hot.on('vge:edit', (request, client) => {
          let reply;
          try {
            const operation = operations[request?.op];
            if (!operation) throw new Error(`unknown live-edit operation '${request?.op}'`);
            reply = { id: request.id, ok: true, result: operation(request, client) };
          } catch (err) {
            reply = { id: request?.id, ok: false, error: String(err?.message ?? err) };
          }
          client.send('vge:edit-reply', reply);
        });
        server.ws.on('vge:edit-mode', (request) => environment().hot.send('vge:edit-mode', request));
        environment().hot.on('vge:edit-mode-state', (state) => server.ws.send({ type: 'custom', event: 'vge:edit-mode-state', data: state }));
      },
    },
  ];
}
