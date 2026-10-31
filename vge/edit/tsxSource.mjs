import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript-api');

export const parseTsx = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const isJsxTag = (node) => ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node);
const jsxTagOf = (node) => (ts.isJsxElement(node) ? node.openingElement : node);

export function elementAt(sourceFile, offset) {
  let found;
  const visit = (node) => {
    if (offset < node.getStart(sourceFile) || offset >= node.getEnd()) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) found = jsxTagOf(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export const tagNameOf = (tag) => tag.tagName.getText();

export function attributeOf(tag, name) {
  return tag.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

export function unwrap(expression) {
  let current = expression;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current))) current = current.expression;
  return current;
}

export const initializerOf = (attribute) => (attribute?.initializer && ts.isJsxExpression(attribute.initializer) ? unwrap(attribute.initializer.expression) : undefined);

const isFunction = (node) => ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) if (isFunction(current)) return current;
  return undefined;
}

function componentFunctionOf(node) {
  let outermost;
  for (let current = enclosingFunction(node); current; current = enclosingFunction(current)) outermost = current;
  return outermost;
}

function componentNameOf(fn) {
  if (fn.name) return fn.name.getText();
  if (ts.isVariableDeclaration(fn.parent)) return fn.parent.name.getText();
  return undefined;
}

export function propParameterOf(fn, localName) {
  const pattern = fn?.parameters[0]?.name;
  if (!pattern || !ts.isObjectBindingPattern(pattern)) return undefined;
  for (const element of pattern.elements) {
    if (element.name.getText() !== localName) continue;
    return { prop: (element.propertyName ?? element.name).getText(), initializer: element.initializer };
  }
  return undefined;
}

function constDeclaredIn(scope, identifier) {
  const name = identifier.getText();
  let found;
  const visit = (node) => {
    if (found || node.getStart() > identifier.getStart() || isFunction(node)) return;
    if (ts.isVariableDeclaration(node) && node.initializer && (ts.getCombinedNodeFlags(node.parent) & ts.NodeFlags.Const) !== 0) {
      if (ts.isIdentifier(node.name) && node.name.getText() === name) found = unwrap(node.initializer);
      else if (ts.isArrayBindingPattern(node.name) && ts.isArrayLiteralExpression(unwrap(node.initializer))) {
        const index = node.name.elements.findIndex((element) => ts.isBindingElement(element) && element.name.getText() === name);
        if (index >= 0) found = unwrap(unwrap(node.initializer).elements[index]);
      }
    }
    ts.forEachChild(node, visit);
  };
  if (scope) ts.forEachChild(scope, visit);
  return found;
}

export function constInitializerOf(identifier) {
  for (let scope = enclosingFunction(identifier); scope; scope = enclosingFunction(scope)) {
    const found = constDeclaredIn(scope.body, identifier);
    if (found) return found;
  }
  return constDeclaredIn(identifier.getSourceFile(), identifier);
}

export const numericValueOf = (expression) => {
  const node = unwrap(expression);
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  return undefined;
};

const literalArrayValues = (expression) => {
  const node = unwrap(expression);
  if (!node || !ts.isArrayLiteralExpression(node)) return undefined;
  const values = node.elements.map(numericValueOf);
  return values.every((value) => value !== undefined) ? values : undefined;
};

export function analyseVector({ levels, prop, axes = 3 }) {
  const reasons = [];

  const vectorAtLevel = (level, name) => {
    const entry = levels[level];
    if (!entry) {
      reasons.push(`level ${level} has no source location`);
      return Array(axes).fill(null);
    }
    const attribute = attributeOf(entry.tag, name);
    if (!attribute) {
      const isComponentLevel = level > 0;
      const parameter = isComponentLevel ? propParameterOf(levels[level - 1]?.fn, name) : undefined;
      const base = parameter?.initializer ? literalArrayValues(parameter.initializer) : isComponentLevel ? undefined : Array(axes).fill(0);
      if (!base) {
        reasons.push(`<${tagNameOf(entry.tag)}> has no ${name} and no literal default for it`);
        return Array(axes).fill(null);
      }
      return base.map((value, index) => ({ level, prop: name, index, sign: 1, add: true, base }));
    }
    return vectorOf(initializerOf(attribute), level, name);
  };

  const fromParameter = (identifier, level) => {
    const fn = levels[level].fn;
    const parameter = propParameterOf(fn, identifier.getText());
    if (!parameter) return undefined;
    const owner = levels[level + 1];
    if (!owner || tagNameOf(owner.tag) !== componentNameOf(fn)) {
      reasons.push(`${identifier.getText()} comes from a call site that was not located`);
      return Array(axes).fill(null);
    }
    return vectorAtLevel(level + 1, parameter.prop);
  };

  function vectorOf(expression, level, name) {
    const node = unwrap(expression);
    if (!node) return Array(axes).fill(null);
    if (ts.isArrayLiteralExpression(node) && node.elements.length === axes) {
      return node.elements.map((element, index) => scalarOf(element, level, name, index));
    }
    if (ts.isIdentifier(node)) {
      const passed = fromParameter(node, level);
      if (passed) return passed;
      const bound = constInitializerOf(node);
      if (bound) return vectorOf(bound, level, name);
    }
    reasons.push(`${name} at level ${level} is computed: ${node.getText()}`);
    return Array(axes).fill(null);
  }

  function scalarOf(expression, level, name, index) {
    const node = unwrap(expression);
    if (numericValueOf(node) !== undefined) return { level, prop: name, index, sign: 1 };
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(unwrap(node.expression)) && numericValueOf(node.argumentExpression) !== undefined) {
      const vector = fromParameter(unwrap(node.expression), level);
      return vector?.[numericValueOf(node.argumentExpression)] ?? null;
    }
    if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.MinusToken)) {
      const reasonsBefore = reasons.length;
      const left = scalarOf(node.left, level, name, index);
      const right = scalarOf(node.right, level, name, index);
      if (Boolean(left) !== Boolean(right)) reasons.length = reasonsBefore;
      if (left && !right) return left;
      if (right && !left) return node.operatorToken.kind === ts.SyntaxKind.MinusToken ? { ...right, sign: -right.sign } : right;
      return null;
    }
    if (ts.isIdentifier(node)) {
      const bound = constInitializerOf(node);
      if (bound) return scalarOf(bound, level, name, index);
    }
    reasons.push(`${name}[${index}] at level ${level} is computed: ${node.getText()}`);
    return null;
  }

  const axesResult = vectorAtLevel(0, prop);
  return { axes: axesResult, reasons };
}

export function levelOf(sourceFile, offset) {
  const tag = elementAt(sourceFile, offset);
  if (!tag) return undefined;
  return { tag, fn: componentFunctionOf(tag) };
}

export function analyseWhole({ levels, prop, neutral }) {
  const reasons = [];
  const atLevel = (level, name) => {
    const entry = levels[level];
    if (!entry) {
      reasons.push(`level ${level} has no source location`);
      return null;
    }
    const attribute = attributeOf(entry.tag, name);
    if (!attribute) {
      if (level > 0) {
        const parameter = propParameterOf(levels[level - 1]?.fn, name);
        const base = parameter?.initializer ? (literalArrayValues(parameter.initializer) ?? numericValueOf(parameter.initializer)) : undefined;
        if (base === undefined) {
          reasons.push(`<${tagNameOf(entry.tag)}> has no ${name} and no literal default for it`);
          return null;
        }
        return { level, prop: name, add: true, base };
      }
      return { level, prop: name, add: true, base: neutral };
    }
    const node = initializerOf(attribute);
    if (node && (numericValueOf(node) !== undefined || literalArrayValues(node))) return { level, prop: name };
    if (node && ts.isIdentifier(node)) {
      const parameter = propParameterOf(entry.fn, node.getText());
      const owner = levels[level + 1];
      if (parameter && owner && tagNameOf(owner.tag) === componentNameOf(entry.fn)) return atLevel(level + 1, parameter.prop);
    }
    reasons.push(`${name} at level ${level} is computed: ${node?.getText()}`);
    return null;
  };
  return { target: atLevel(0, prop), reasons };
}

const formatNumber = (value) => {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};

const literalText = (value) => (Array.isArray(value) ? `[${value.map(formatNumber).join(', ')}]` : formatNumber(value));

export function valueEdit(text, sourceFile, offset, prop, value) {
  const tag = elementAt(sourceFile, offset);
  if (!tag) throw new Error('the element is no longer at its source location');
  const attribute = attributeOf(tag, prop);
  if (!attribute) {
    const at = tag.attributes.getEnd();
    return [{ start: at, end: at, text: ` ${prop}={${literalText(value)}}` }];
  }
  const initializer = initializerOf(attribute);
  if (initializer && numericValueOf(initializer) !== undefined) {
    if (literalText(value) === formatNumber(numericValueOf(initializer))) return [];
    return [{ start: initializer.getStart(sourceFile), end: initializer.getEnd(), text: literalText(value) }];
  }
  const values = Array.isArray(value) ? value : [value, value, value];
  const formatted = values.map(formatNumber);
  const array = initializer;
  if (!array || !ts.isArrayLiteralExpression(array)) throw new Error(`${prop} of <${tagNameOf(tag)}> is not a literal`);
  const replacements = [];
  array.elements.forEach((element, index) => {
    if (values[index] === undefined) return;
    const current = numericValueOf(element);
    if (current === undefined) {
      throw new Error(`${prop}[${index}] of <${tagNameOf(tag)}> is computed: ${element.getText()}`);
    }
    if (formatNumber(current) === formatted[index]) return;
    replacements.push({ start: element.getStart(sourceFile), end: element.getEnd(), text: formatted[index] });
  });
  return replacements;
}

export function applyReplacements(text, replacements) {
  return [...replacements].sort((a, b) => b.start - a.start).reduce((result, { start, end, text: inserted }) => result.slice(0, start) + inserted + result.slice(end), text);
}
