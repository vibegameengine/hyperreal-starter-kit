import { editableMetaOf, type ArgType, type Control, type EditableMeta } from '../../shared/react/editable';
import { propsOf } from './devtools';
import type { Selected, SourceProp } from './editState';

export type PropPath = (string | number)[];

export interface CardRow {
  path: PropPath;
  label: string;
  depth: number;
  kind: 'number' | 'range' | 'boolean' | 'select' | 'text' | 'vector' | 'group';
  value?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { id: string; label: string }[];
  writable: boolean;
  reason?: string;
  description?: string;
  live?: boolean;
  added?: boolean;
  entry?: boolean;
  entries?: { key: string; live: boolean; added: boolean }[];
}

export interface CardLevel {
  index: number;
  tag: string;
  file: string;
  line: number;
}

export interface PropCard {
  title: string;
  level: number;
  levels: CardLevel[];
  rows: CardRow[];
}

const HIDDEN_PROPS = new Set(['children', 'key', 'ref']);
const VECTOR_LENGTHS = new Set([2, 3, 4]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
const isNumberVector = (value: unknown): value is number[] => Array.isArray(value) && VECTOR_LENGTHS.has(value.length) && value.every((item) => typeof item === 'number');

function isEditableValue(value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return true;
  if (isNumberVector(value)) return true;
  return isPlainObject(value) && Object.values(value).every(isEditableValue);
}

interface RowSource {
  writable: boolean;
  reason?: string;
}

interface RowPlace {
  source: RowSource;
  depth: number;
  argType?: ArgType;
}

const controlOf = (argType: ArgType | undefined): Control | undefined => {
  const control = argType?.control;
  if (!control) return undefined;
  return typeof control === 'string' ? { type: control } : control;
};

function leafRow(path: PropPath, value: unknown, { argType, source, depth }: RowPlace): CardRow | undefined {
  const control = controlOf(argType);
  const base = { path, label: argType?.name ?? String(path.at(-1)), depth, value, writable: source.writable && !argType?.table?.readonly, reason: source.reason, description: argType?.description };
  if (argType?.options) {
    const labels = control?.labels ?? {};
    return { ...base, kind: 'select', options: argType.options.map((option) => ({ id: String(option), label: labels[String(option)] ?? String(option) })) };
  }
  if (typeof value === 'number') return control?.type === 'range' || (control?.min !== undefined && control.max !== undefined) ? { ...base, kind: 'range', min: control?.min, max: control?.max, step: control?.step } : { ...base, kind: 'number', min: control?.min, max: control?.max, step: control?.step };
  if (typeof value === 'boolean') return { ...base, kind: 'boolean' };
  if (typeof value === 'string') return { ...base, kind: 'text' };
  if (isNumberVector(value)) return { ...base, kind: 'vector', step: control?.step };
  return undefined;
}

interface DictionaryView {
  keys: readonly string[];
  live?: string;
  template: Record<string, unknown>;
}

function rowsOf(path: PropPath, value: unknown, place: RowPlace, dictionary?: DictionaryView): CardRow[] {
  const { argType, source, depth } = place;
  if (!isPlainObject(value)) {
    const row = leafRow(path, value, place);
    return row ? [row] : [];
  }
  const group: CardRow = { path, label: argType?.name ?? String(path.at(-1)), depth, kind: 'group', writable: source.writable, reason: source.reason, description: argType?.description };
  const inner = { source, depth: depth + 1, argType };
  if (dictionary) {
    const entries = dictionary.keys.map((key) => ({ key, live: key === dictionary.live, added: !isPlainObject(value[key]) }));
    return [{ ...group, entries }, ...dictionary.keys.flatMap((key) => entryRows(path, value, inner, { key, dictionary }))];
  }
  return [group, ...Object.entries(value).flatMap(([key, entry]) => rowsOf([...path, key], entry, { source, depth: depth + 1, argType: argType?.fields?.[key] }))];
}

function entryRows(path: PropPath, entries: Record<string, unknown>, { source, depth, argType }: RowPlace, { key, dictionary }: { key: string; dictionary: DictionaryView }): CardRow[] {
  const existing = entries[key];
  const shape = { ...dictionary.template, ...(isPlainObject(existing) ? existing : {}) };
  const header: CardRow = { path: [...path, key], label: key, depth, kind: 'group', writable: source.writable, live: key === dictionary.live, added: existing === undefined, entry: true };
  const fields = Object.entries(shape).flatMap(([field, entry]) => rowsOf([...path, key, field], entry, { source, depth: depth + 1, argType: argType?.fields?.[field] }));
  return [header, ...fields];
}

function guarded<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function dictionaryViewOf(argType: ArgType | undefined, value: unknown, context: { props: Record<string, unknown>; object: unknown }): DictionaryView | undefined {
  if (!argType || (!argType.keys && !argType.liveKey)) return undefined;
  const live = guarded(() => argType.liveKey?.(context));
  const declared = typeof argType.keys === 'function' ? guarded(() => (argType.keys as (c: typeof context) => readonly string[])(context)) : argType.keys;
  const existing = isPlainObject(value) ? Object.keys(value) : [];
  const keys = [...new Set([...(declared ?? []), ...existing, ...(live ? [live] : [])])];
  const firstEntry = isPlainObject(value) ? Object.values(value).find(isPlainObject) : undefined;
  const template = (typeof argType.template === 'function' ? guarded(() => (argType.template as (c: typeof context) => Record<string, unknown>)(context)) : argType.template) ?? firstEntry ?? {};
  return { keys, live, template };
}

function propNames(meta: EditableMeta | undefined, sourceProps: SourceProp[], runtime: Record<string, unknown>) {
  const names = [...sourceProps.map((prop) => prop.name), ...Object.keys(meta?.argTypes ?? {}), ...Object.keys(runtime)];
  return [...new Set(names)].filter((name) => !HIDDEN_PROPS.has(name));
}

function rowsOfLevel(selected: Selected, level: number): CardRow[] {
  const fiber = selected.chain[level];
  const meta = editableMetaOf(fiber?.type);
  const runtime = propsOf(fiber);
  const sourceProps = selected.inspected?.props?.[level] ?? [];
  return propNames(meta, sourceProps, runtime).flatMap((name) => {
    const argType = (meta?.argTypes as Record<string, ArgType> | undefined)?.[name];
    if (argType?.control === false || argType?.table?.disable) return [];
    const source = sourceProps.find((prop) => prop.name === name);
    const value = runtime[name] ?? source?.value;
    if (!isEditableValue(value)) return [];
    const writable = source ? { writable: source.writable, reason: source.reason } : { writable: false, reason: 'not in the source of this call' };
    return rowsOf([name], value, { argType, source: writable, depth: 0 }, dictionaryViewOf(argType, value, { props: runtime, object: selected.node.object }));
  });
}

const componentName = (fiber: any) => fiber?.type?.displayName ?? fiber?.type?.name ?? 'component';

export function componentLevels(selected: Selected): CardLevel[] {
  const located = selected.inspected?.levels ?? [];
  return located.flatMap((level, index) => (index > 0 && selected.inspected?.props?.[index] ? [{ index, tag: level.tag, file: level.file, line: level.line }] : []));
}

export function propCardOf(selected: Selected, wantedLevel: number | undefined): PropCard | undefined {
  const levels = componentLevels(selected);
  const level = levels.find((each) => each.index === wantedLevel)?.index ?? levels.at(-1)?.index;
  if (level === undefined) return undefined;
  const fiber = selected.chain[level];
  const meta = editableMetaOf(fiber?.type);
  return { title: meta?.title ?? componentName(fiber), level, levels, rows: rowsOfLevel(selected, level) };
}
