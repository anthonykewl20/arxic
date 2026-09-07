import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { collectFrontendInventory, SourceUaAdapter } from '../index';
import { makeRepository } from './test-repo';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('keeps malformed templates, embedded code and phantom markup explicit without inventing controls', async () => {
  const repo = await makeRepository(undefined, {
    'broken.ejs': '<button>Before</button>\n<% never closed\n<input>',
    'broken.html': '<!doctype html><button name="unfinished',
    'safe.html':
      '<!doctype html><html><head><script>const privateCanary = "<button onclick=secret()>";</script></head><body><!-- <input disabled> --><form action="/real"><button disabled>Real</button></form></body></html>',
    'dynamic.ejs':
      '<% const privateCanary = "<button onclick=secret()>"; %>\n<input disabled <%= properties %>>',
  });
  roots.push(repo.root);
  const index = await new SourceUaAdapter().collect(repo.request);
  const result = await collectFrontendInventory(repo.root, index);
  expect(result.gaps).toEqual(
    expect.arrayContaining([
      { path: 'broken.ejs', reason: 'malformed-template' },
      { path: 'broken.html', reason: 'html-parse-error' },
      { path: 'safe.html', reason: 'embedded-script-not-analyzed' },
      { path: 'dynamic.ejs', reason: 'template-expressions-not-evaluated' },
    ]),
  );
  expect(result.rows.filter((row) => row.source.path.startsWith('broken.'))).toEqual([]);
  expect(
    result.rows
      .filter((row) => row.source.path === 'safe.html' && row.kind === 'control')
      .map((row) => row.label),
  ).toEqual(['form (action)', 'button (disabled)']);
  expect(
    result.rows
      .filter((row) => row.source.path === 'dynamic.ejs' && row.kind === 'control')
      .map((row) => row.label),
  ).toEqual(['input (disabled)']);
  expect(result.rows.some((row) => /privateCanary|secret|properties|\/real/u.test(row.label))).toBe(
    false,
  );
  expect(result.rows.every((row) => row.truthState === 'hypothesized')).toBe(true);
  expect(result.coverage.complete).toBe(false);
});

it('discovers all thirteen literal controls in the committed real Express view with exact source references', async () => {
  const repo = await makeRepository('vulnerable-auth-app');
  roots.push(repo.root);
  const index = await new SourceUaAdapter().collect(repo.request);
  const result = await collectFrontendInventory(repo.root, index);
  const path = 'src/views/index.ejs';
  const controls = result.rows.filter((row) => row.source.path === path && row.kind === 'control');
  expect(controls).toHaveLength(13);
  expect(controls.filter((row) => row.label.startsWith('form'))).toHaveLength(4);
  expect(controls.filter((row) => row.label.startsWith('input'))).toHaveLength(5);
  expect(controls.filter((row) => row.label.startsWith('button'))).toHaveLength(4);
  const lines = (await readFile(join(repo.root, path), 'utf8')).split('\n');
  const entry = index.manifest.find((file) => file.path === path)!;
  for (const row of controls) {
    expect(row.source.commit).toBe(repo.commit);
    expect(row.source.blobSha256).toBe(entry.blobSha256);
    expect(row.truthState).toBe('hypothesized');
    expect(lines.slice(row.source.startLine - 1, row.source.endLine).join('\n')).toContain(
      `<${row.label.split(' ')[0]}`,
    );
  }
  expect(result.gaps).toContainEqual({ path, reason: 'template-expressions-not-evaluated' });
  expect(result.gaps).not.toContainEqual({ path, reason: 'unsupported-framework' });
  expect(result.files.find((file) => file.path === path)?.status).toBe('gap');
  expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
  expect(await collectFrontendInventory(repo.root, index)).toEqual(result);
});

it('preserves multiline template offsets and makes inert, foreign and bounded markup gaps explicit', async () => {
  const repo = await makeRepository(undefined, {
    'offset.ejs': '<% const emoji = "😀";\n// <button>Ghost</button>\n%>\n<input\n name="email">',
    'inert.html':
      '<!doctype html><template><button>Later</button></template><svg><a>Foreign</a></svg><button onfutureevent="doNotRead()">Now</button>',
    'deep.html':
      '<!doctype html>' +
      '<div>'.repeat(20_010) +
      '<button>Beyond budget</button>' +
      '</div>'.repeat(20_010),
  });
  roots.push(repo.root);
  const result = await collectFrontendInventory(
    repo.root,
    await new SourceUaAdapter().collect(repo.request),
  );
  const offset = result.rows.filter((row) => row.source.path === 'offset.ejs');
  expect(offset).toHaveLength(1);
  expect(offset[0]).toMatchObject({
    kind: 'control',
    label: 'input (name)',
    source: { startLine: 4, endLine: 5 },
  });
  expect(result.gaps).toEqual(
    expect.arrayContaining([
      { path: 'inert.html', reason: 'inert-template-not-runtime-proof' },
      { path: 'inert.html', reason: 'foreign-markup-not-analyzed' },
      { path: 'inert.html', reason: 'event-attribute-not-analyzed' },
      { path: 'deep.html', reason: 'template-node-budget' },
    ]),
  );
  expect(
    result.rows
      .filter((row) => row.source.path === 'inert.html' && row.kind === 'control')
      .map((row) => row.label),
  ).toEqual(['button', 'button (onfutureevent)']);
  expect(result.rows.some((row) => row.source.path === 'deep.html')).toBe(false);
  expect(result.coverage.complete).toBe(false);
});
