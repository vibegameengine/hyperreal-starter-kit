import type { ComponentType } from 'react';

export type ControlType = 'object' | 'boolean' | 'select' | 'radio' | 'inline-radio' | 'number' | 'range' | 'text' | 'color';

export interface Control {
  type: ControlType;
  min?: number;
  max?: number;
  step?: number;
  labels?: Record<string, string>;
}

export interface LiveKeyContext<Props> {
  props: Props;
  object: unknown;
}

export interface ArgType<Props = any> {
  control?: ControlType | Control | false;
  description?: string;
  name?: string;
  options?: readonly unknown[];
  table?: { category?: string; disable?: boolean; readonly?: boolean };
  liveKey?: (context: LiveKeyContext<Props>) => string | undefined;
  keys?: readonly string[] | ((context: LiveKeyContext<Props>) => readonly string[]);
  template?: Record<string, unknown> | ((context: LiveKeyContext<Props>) => Record<string, unknown>);
  fields?: Record<string, ArgType<Props>>;
}

type PropsOf<C> = C extends ComponentType<infer Props> ? Props : never;

export interface EditableMeta<C extends ComponentType<any> = ComponentType<any>> {
  component: C;
  title?: string;
  argTypes?: { [Prop in keyof PropsOf<C>]?: ArgType<PropsOf<C>> };
}

const metaOfComponent = new WeakMap<object, EditableMeta>();
const metaOfName = new Map<string, EditableMeta>();

const nameOf = (component: ComponentType<any>) => component.displayName ?? component.name;

export function defineEditable<C extends ComponentType<any>>(meta: EditableMeta<C>): EditableMeta<C> {
  metaOfComponent.set(meta.component, meta as EditableMeta);
  if (nameOf(meta.component)) metaOfName.set(nameOf(meta.component), meta as EditableMeta);
  return meta;
}

export function editableMetaOf(component: unknown): EditableMeta | undefined {
  if (typeof component !== 'function') return undefined;
  return metaOfName.get(nameOf(component as ComponentType<any>)) ?? metaOfComponent.get(component);
}
