import * as UE from 'ue';
import { $ref } from 'puerts';
import { propsOf, type PropInfo } from './catalog';
import { isMaterialValue, resolveMaterial } from './materials';


const RESERVED = new Set(['children', 'key', 'ref', 'location', 'rotation', 'scale', 'socket']);
export const isReserved = (prop: string) => RESERVED.has(prop);

const loaded = new Map<string, UE.Object | undefined>();
export function loadAsset(path: string) {
  if (!loaded.has(path)) {
    const asset = UE.Object.Load(path);
    if (!asset) console.error(`[react] asset not found: ${path}`);
    loaded.set(path, asset);
  }
  return loaded.get(path);
}

export function toVector(value: any): UE.Vector {
  return Array.isArray(value) ? new UE.Vector(value[0], value[1], value[2]) : typeof value === 'number' ? new UE.Vector(value, value, value) : value;
}

export function toRotator(value: any): UE.Rotator {
  return Array.isArray(value) ? new UE.Rotator(value[0], value[1], value[2]) : value;
}

function toStruct(structName: string, value: any) {
  if (!Array.isArray(value)) return value;
  switch (structName) {
    case 'Vector':
      return toVector(value);
    case 'Rotator':
      return toRotator(value);
    case 'LinearColor':
      return new UE.LinearColor(value[0], value[1], value[2], value[3] ?? 1);
    case 'Vector2D':
      return new UE.Vector2D(value[0], value[1]);
    default:
      throw new Error(`a ${structName} cannot be written as a tuple; pass UE.${structName}`);
  }
}

function toArray(element: string, values: readonly any[], target: UE.Object, prop: string) {
  const [category, typeName] = element.split(':');
  const elementType = category === 'object' || category === 'struct' ? (UE as any)[typeName] : (UE as any)[category];
  const array = UE.NewArray(elementType);
  values.forEach((value, index) => {
    if (category === 'object' && isMaterialValue(value)) array.Add(resolveMaterial(target, `${prop}[${index}]`, value) ?? null);
    else if (category === 'object') array.Add(typeof value === 'string' ? loadAsset(value) : value);
    else if (category === 'struct') array.Add(toStruct(typeName, value));
    else array.Add(value);
  });
  return array;
}

const handlers = new WeakMap<object, Map<string, { current?: (...args: any[]) => void; bound: (...args: any[]) => void }>>();

function writeEvent(target: any, property: string, handler: ((...args: any[]) => void) | undefined) {
  let byEvent = handlers.get(target);
  if (!byEvent) handlers.set(target, (byEvent = new Map()));
  let slot = byEvent.get(property);
  if (!slot && handler) {
    const created: { current?: (...args: any[]) => void; bound: (...args: any[]) => void } = { bound: (...args) => created.current?.(...args) };
    slot = created;
    byEvent.set(property, slot);
    target[property].Add(slot.bound);
  }
  if (slot) slot.current = handler;
}

export function writeProp(target: any, className: string, prop: string, value: any, previous?: any): boolean {
  const info: PropInfo | undefined = propsOf(className)[prop];
  if (!info) throw new Error(`${className} has no prop '${prop}'`);
  const [property, setterKind, setter] = info;
  const kind = setterKind.startsWith('call:') ? setterKind.slice(5) : setterKind;
  if (kind === 'event') {
    writeEvent(target, property, value);
    return false;
  }
  if (kind === 'component') {
    writeComponent(target[property], value ?? {}, previous ?? {});
    return false;
  }
  let converted = value;
  if (kind.startsWith('struct:')) converted = toStruct(kind.slice(7), value);
  else if (kind === 'object' && isMaterialValue(value)) {
    converted = resolveMaterial(target, prop, value);
    if (!converted) return false;
  } else if (kind === 'object' && typeof value === 'string') converted = loadAsset(value);
  else if (kind.startsWith('array:') && Array.isArray(value)) converted = toArray(kind.slice(6), value, target, prop);
  if (setter) {
    target[setter](converted);
    return false;
  }
  target[property] = converted;
  return true;
}

export function writeProps(target: any, props: Record<string, any>, previous: Record<string, any> = {}) {
  if (!target) return;
  const className = target.GetClass().GetName();
  let written = false;
  const order = Object.keys(props).sort((a, b) => Number(b === 'mobility') - Number(a === 'mobility'));
  for (const prop of order) {
    if (isReserved(prop) || same(props[prop], previous[prop])) continue;
    try {
      written = writeProp(target, className, prop, props[prop], previous[prop]) || written;
    } catch (err: any) {
      console.error(`[react] ${className}.${prop}: ${err?.message ?? err}`);
    }
  }
  if (written && target instanceof UE.ActorComponent) UE.VgeScriptLibrary.ReregisterComponent(target);
  for (const prop of Object.keys(previous)) {
    if (!(prop in props) && propsOf(className)[prop]?.[1] === 'event') writeProp(target, className, prop, undefined);
  }
}

function writeComponent(component: any, props: Record<string, any>, previous: Record<string, any>) {
  writeProps(component, props, previous);
  if (component instanceof UE.SceneComponent && transformChanged(props, previous) && (props.location || props.rotation || props.scale)) {
    component.K2_SetRelativeLocationAndRotation(toVector(props.location ?? [0, 0, 0]), toRotator(props.rotation ?? [0, 0, 0]), false, $ref(new UE.HitResult()), true);
    component.SetRelativeScale3D(toVector(props.scale ?? 1));
  }
}

export function transformOf(props: Record<string, any>) {
  return UE.KismetMathLibrary.MakeTransform(toVector(props.location ?? [0, 0, 0]), toRotator(props.rotation ?? [0, 0, 0]), toVector(props.scale ?? 1));
}

const sameItem = (a: any, b: any) => a === b || (isMaterialValue(a) && isMaterialValue(b) && JSON.stringify(a) === JSON.stringify(b));
export function same(a: any, b: any) {
  if (sameItem(a, b)) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => sameItem(item, b[index]));
}

export const transformChanged = (a: Record<string, any>, b: Record<string, any>) =>
  !same(a.location, b.location) || !same(a.rotation, b.rotation) || !same(a.scale, b.scale);
