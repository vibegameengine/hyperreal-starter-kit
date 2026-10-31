import { createRequire } from 'node:module';
import { attributeOf, constInitializerOf, elementAt, initializerOf, numericValueOf, tagNameOf, unwrap } from './tsxSource.mjs';

const ts = createRequire(import.meta.url)('typescript-api');

const PROP_DECIMALS = 10_000;

function resolved(expression) {
  const node = unwrap(expression);
  if (node && ts.isIdentifier(node)) return constInitializerOf(node) ?? node;
  return node;
}

const propertyNameOf = (property) => {
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
};

const findProperty = (object, key) => object.properties.find((property) => ts.isPropertyAssignment(property) && propertyNameOf(property) === String(key));

function objectLiteralValue(node) {
  const value = {};
  for (const property of node.properties) {
    const name = ts.isPropertyAssignment(property) ? propertyNameOf(property) : undefined;
    if (name === undefined) return undefined;
    const entry = literalValueOf(property.initializer);
    if (entry === undefined) return undefined;
    value[name] = entry;
  }
  return value;
}

export function literalValueOf(expression) {
  const node = resolved(expression);
  if (!node) return undefined;
  const number = numericValueOf(node);
  if (number !== undefined) return number;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) {
    const values = node.elements.map(literalValueOf);
    return values.every((value) => value !== undefined) ? values : undefined;
  }
  if (ts.isObjectLiteralExpression(node)) return objectLiteralValue(node);
  return undefined;
}

const formatNumber = (value) => {
  const rounded = Math.round(value * PROP_DECIMALS) / PROP_DECIMALS;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const keyText = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`);

export function literalText(value) {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map(literalText).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, entry]) => `${keyText(key)}: ${literalText(entry)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  throw new Error(`${JSON.stringify(value)} cannot be written as a literal`);
}

const nested = (keys, value) => keys.reduceRight((inner, key) => ({ [key]: inner }), value);

function insertProperty(object, key, value) {
  const text = `${keyText(String(key))}: ${literalText(value)}`;
  const last = object.properties.at(-1);
  if (!last) return { start: object.getStart(), end: object.getEnd(), text: `{ ${text} }` };
  return { start: last.getEnd(), end: last.getEnd(), text: `, ${text}` };
}

function childOf(node, key, where) {
  if (ts.isObjectLiteralExpression(node)) {
    const property = findProperty(node, key);
    return property ? { node: resolved(property.initializer) } : { missing: true };
  }
  if (ts.isArrayLiteralExpression(node) && Number.isInteger(Number(key)) && node.elements[Number(key)]) return { node: resolved(node.elements[Number(key)]) };
  throw new Error(`${where} is computed: ${node.getText()}`);
}

export function pathEdit(sourceFile, offset, path, value) {
  const tag = elementAt(sourceFile, offset);
  if (!tag) throw new Error('the element is no longer at its source location');
  const [prop, ...keys] = path;
  const attribute = attributeOf(tag, prop);
  if (!attribute) {
    const at = tag.attributes.getEnd();
    return [{ start: at, end: at, text: ` ${prop}={${literalText(nested(keys, value))}}` }];
  }
  if (!attribute.initializer || ts.isStringLiteral(attribute.initializer)) {
    if (keys.length) throw new Error(`${prop} of <${tagNameOf(tag)}> holds no object`);
    return replaceAttributeValue(sourceFile, attribute, value);
  }
  let node = resolved(initializerOf(attribute));
  if (!node) throw new Error(`${prop} of <${tagNameOf(tag)}> is not a literal`);
  for (const [index, key] of keys.entries()) {
    const child = childOf(node, key, path.slice(0, index + 1).join('.'));
    if (child.missing) return [insertProperty(node, key, nested(keys.slice(index + 1), value))];
    node = child.node;
  }
  if (literalValueOf(node) === undefined) throw new Error(`${path.join('.')} of <${tagNameOf(tag)}> is computed: ${node.getText()}`);
  const text = literalText(value);
  if (text === node.getText(sourceFile)) return [];
  return [{ start: node.getStart(sourceFile), end: node.getEnd(), text }];
}

const attributeExpression = (attribute) => (attribute.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer : initializerOf(attribute));

function replaceAttributeValue(sourceFile, attribute, value) {
  const text = `${attribute.name.getText()}={${literalText(value)}}`;
  return [{ start: attribute.getStart(sourceFile), end: attribute.getEnd(), text }];
}

function attributeProps(tag) {
  return tag.attributes.properties.flatMap((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return [];
    const name = attribute.name.getText();
    if (!attribute.initializer) return [{ name, value: true, writable: true }];
    const expression = attributeExpression(attribute);
    const value = literalValueOf(expression);
    return [value === undefined ? { name, writable: false, reason: `computed: ${expression?.getText() ?? attribute.initializer.getText()}` } : { name, value, writable: true }];
  });
}

function parameterDefaults(fn) {
  const pattern = fn?.parameters[0]?.name;
  if (!pattern || !ts.isObjectBindingPattern(pattern)) return [];
  return pattern.elements.flatMap((element) => {
    if (element.dotDotDotToken) return [];
    const name = (element.propertyName ?? element.name).getText();
    return [{ name, value: element.initializer ? literalValueOf(element.initializer) : undefined }];
  });
}

export function componentProps(levels, level) {
  const entry = levels[level];
  if (!entry || level === 0) return undefined;
  const fromCall = attributeProps(entry.tag);
  const named = new Set(fromCall.map((prop) => prop.name));
  const fromDefaults = parameterDefaults(levels[level - 1]?.fn)
    .filter((prop) => !named.has(prop.name))
    .map((prop) => ({ name: prop.name, value: prop.value, writable: true, fromDefault: true }));
  return [...fromCall, ...fromDefaults];
}
