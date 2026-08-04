import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARXIC_RULES_CHAIN_INCOMPLETE,
  ARXIC_RULES_CONFLICT,
  ARXIC_RULES_DIRTY_TREE,
  ARXIC_RULES_FALLBACK,
  ARXIC_RULES_PACK_INVALID,
  ARXIC_RULES_SG_ERROR,
  AstGrepAdapter,
  diagnosticsOf,
  sourceRefsOf,
} from '..';
import { makeRepository, packDirs, writePack } from './test-repo';

describe('ast-grep sad paths and truth-state dispositions', () => {
  it('does not claim a conventional route without a handler and guard as hypothesized', async () => {
    const repo = await makeRepository(undefined, {
      'app/signup/page.tsx':
        'export default async function SignupPage() { return <main>Signup</main>; }\n',
    });
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({ revision: repo.revision });
    expect(result.chains).toContainEqual(
      expect.objectContaining({
        feature: 'signup',
        status: 'incomplete',
        truthState: 'hypothesized',
      }),
    );
    expect(
      result.chains.some((chain) => chain.feature === 'signup' && chain.status === 'connected'),
    ).toBe(false);
    expect(diagnosticsOf(result.events)).toContainEqual(
      expect.objectContaining({ code: ARXIC_RULES_CHAIN_INCOMPLETE, severity: 'hypothesized' }),
    );
  });

  it('labels unsupported decorator syntax as blocked regex fallback without evidence', async () => {
    const repo = await makeRepository(undefined, {
      'src/controller.ts': "class Auth { @Post('/login') login() {} }\n",
    });
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({ revision: repo.revision });
    expect(diagnosticsOf(result.events)).toContainEqual(
      expect.objectContaining({
        code: ARXIC_RULES_FALLBACK,
        severity: 'blocked',
        message: expect.stringContaining('regex-fallback'),
      }),
    );
    expect(sourceRefsOf(result.events)).toHaveLength(0);
  });

  it('fails closed deterministically when two packs define the same rule id', async () => {
    const repo = await makeRepository(undefined, {
      'src/server.ts': "app.post('/login', () => {});\n",
    });
    const parent = await mkdtemp(join(tmpdir(), 'arxic-pack-conflict-'));
    const duplicate = await writePack(parent, 'duplicate-pack', 'express-route');
    const result = await new AstGrepAdapter({ packs: [...packDirs, duplicate] }).scan({
      revision: repo.revision,
    });
    expect(diagnosticsOf(result.events)).toContainEqual(
      expect.objectContaining({
        code: ARXIC_RULES_CONFLICT,
        severity: 'blocked',
        message: expect.stringContaining('duplicate-pack@1.0.0'),
      }),
    );
    expect(result.matches.some((match) => match.ruleId === 'express-route')).toBe(false);
  });

  it('emits no source references for a dirty git tree', async () => {
    const repo = await makeRepository(undefined, {
      'src/server.ts': "app.post('/login', () => {});\n",
    });
    await writeFile(join(repo.root, 'src/server.ts'), "app.post('/changed', () => {});\n");
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({ revision: repo.revision });
    expect(sourceRefsOf(result.events)).toHaveLength(0);
    expect(diagnosticsOf(result.events)).toContainEqual(
      expect.objectContaining({ code: ARXIC_RULES_DIRTY_TREE, severity: 'blocked' }),
    );
  });

  it('turns a missing sg binary into a blocked diagnostic without crashing', async () => {
    const repo = await makeRepository(undefined, {
      'src/server.ts': "app.post('/login', () => {});\n",
    });
    const result = await new AstGrepAdapter({
      packs: packDirs,
      sgBinary: '/nonexistent/arxic-sg',
    }).scan({ revision: repo.revision });
    expect(sourceRefsOf(result.events)).toHaveLength(0);
    expect(diagnosticsOf(result.events)).toContainEqual(
      expect.objectContaining({ code: ARXIC_RULES_SG_ERROR, severity: 'blocked' }),
    );
  });

  it('passes option-like repository paths to sg as data', async () => {
    const repo = await makeRepository(undefined, {
      '--auth.ts':
        "app.post('/login', async (_request, _response) => { await bcrypt.compare(password, hash); });\n",
    });
    const result = await new AstGrepAdapter({ packs: packDirs }).scan({ revision: repo.revision });
    expect(result.matches).toContainEqual(
      expect.objectContaining({ ruleId: 'express-route', file: '--auth.ts' }),
    );
    expect(
      diagnosticsOf(result.events).some((diagnostic) => diagnostic.code === ARXIC_RULES_SG_ERROR),
    ).toBe(false);
  });

  it('rejects malformed pack JSON and malformed rule YAML as blocked', async () => {
    const repo = await makeRepository(undefined, { 'src/index.ts': 'export const ok = true;\n' });
    const parent = await mkdtemp(join(tmpdir(), 'arxic-pack-invalid-'));
    const malformedJson = await writePack(parent, 'bad-json', 'bad-json-rule', true);
    const malformedRule = await writePack(parent, 'bad-rule', 'bad-rule-id');
    await writeFile(
      join(malformedRule, 'rules/rule.yml'),
      'id: missing-metadata\nlanguage: TypeScript\nrule:\n  pattern: $A\n',
    );
    const result = await new AstGrepAdapter({ packs: [malformedJson, malformedRule] }).scan({
      revision: repo.revision,
    });
    expect(
      diagnosticsOf(result.events).filter(
        (diagnostic) => diagnostic.code === ARXIC_RULES_PACK_INVALID,
      ),
    ).toHaveLength(2);
  });
});
