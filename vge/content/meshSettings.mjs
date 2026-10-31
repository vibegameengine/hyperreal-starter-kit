import { existsSync, readFileSync, statSync } from 'node:fs';

export const MESH_SETTINGS_SUFFIX = '.mesh.json';

export const meshSettingsFileOf = (model) => model.replace(/\.[^.\\/]+$/, MESH_SETTINGS_SUFFIX);

export const modelsOfMeshSettingsFile = (file) => ['.glb', '.gltf', '.fbx'].map((extension) => file.slice(0, -MESH_SETTINGS_SUFFIX.length) + extension);

export function meshSettingsOf(model) {
  const file = meshSettingsFileOf(model);
  if (!existsSync(file)) return undefined;
  return { file, mtimeMs: statSync(file).mtimeMs, description: JSON.parse(readFileSync(file, 'utf8')) };
}
