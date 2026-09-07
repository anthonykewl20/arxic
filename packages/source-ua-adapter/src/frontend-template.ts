import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { frontendControlTags, frontendStateAttributes } from './frontend-controls';

const actions = new Set([
  'action',
  'formaction',
  'onclick',
  'ondblclick',
  'oninput',
  'onchange',
  'onsubmit',
  'onreset',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onpointerdown',
  'onpointerup',
  'onmousedown',
  'onmouseup',
  'ontouchstart',
  'ontouchend',
  'ondragstart',
  'ondrop',
  'onscroll',
  'onload',
  'onerror',
]);
const states = new Set([
  ...frontendStateAttributes,
  'open',
  'checked',
  'selected',
  'readonly',
  'required',
  'aria-checked',
  'aria-selected',
  'aria-pressed',
]);
type Declaration = {
  kind: 'control' | 'action' | 'state';
  label: string;
  startLine: number;
  endLine: number;
};

/** Parse source-present markup only. No evaluation, rendered text, attribute values or invented nodes. */
export function readLiteralTemplate(source: string, ejs: boolean) {
  const flags = {
    malformedTemplate: false,
    parseError: false,
    templateCode: false,
    script: false,
    foreign: false,
    inert: false,
    event: false,
    budget: false,
  };
  const rows: Declaration[] = [];
  let text = source;
  if (ejs) {
    // Spaces preserve UTF-16 offsets and CR/LF lines, including code containing astral characters.
    let cursor = 0;
    const chunks: string[] = [];
    while (cursor < source.length) {
      const start = source.indexOf('<%', cursor);
      if (start < 0) {
        chunks.push(source.slice(cursor));
        break;
      }
      flags.templateCode = true;
      const end = source.indexOf('%>', start + 2);
      if (end < 0) {
        flags.malformedTemplate = true;
        return { rows, flags };
      }
      chunks.push(
        source.slice(cursor, start),
        source.slice(start, end + 2).replace(/[^\r\n]/g, ' '),
      );
      cursor = end + 2;
    }
    text = chunks.join('');
  }
  const document = parse(text, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => {
      if (error.code !== 'missing-doctype') flags.parseError = true;
    },
  });
  if (flags.parseError) return { rows, flags };
  const stack: DefaultTreeAdapterTypes.Node[] = [document];
  let visited = 0;
  while (stack.length && visited++ < 20_000) {
    const node = stack.pop()!;
    if ('tagName' in node) {
      const location = node.sourceCodeLocation?.startTag;
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml') flags.foreign = true;
      else if (location) {
        const names = node.attrs.map((attribute) => attribute.name);
        const add = (kind: Declaration['kind'], label: string) =>
          rows.push({ kind, label, startLine: location.startLine, endLine: location.endLine });
        if (frontendControlTags.has(node.tagName))
          add('control', `${node.tagName}${names.length ? ` (${names.join(', ')})` : ''}`);
        for (const name of names) {
          if (actions.has(name)) add('action', name);
          else if (name.startsWith('on')) flags.event = true;
          if (states.has(name)) add('state', name);
        }
        if (node.tagName === 'script') flags.script = true;
      }
      if (node.tagName === 'template' && 'content' in node) {
        flags.inert = true;
        stack.push((node as DefaultTreeAdapterTypes.Template).content);
      }
    }
    if ('childNodes' in node)
      for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  flags.budget = stack.length > 0;
  return { rows, flags };
}
