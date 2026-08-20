import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPacks, runRules } from '..';
import { packDirs, workspaceRoot } from './test-repo';

const expectedFields: Record<string, string> = {
  'nextjs-page-route': 'NAME',
  'nextjs-route-handler': 'METHOD',
  'nextjs-auth-form': 'TAG',
  'nextjs-server-action': 'NAME',
  'nextjs-auth-guard': 'ARGS',
  'nextjs-password-hash': 'PASSWORD',
  'nextjs-token-create': 'SIZE',
  'nextjs-token-persist': 'QUERY',
  'nextjs-token-verify': 'SUPPLIED',
  'nextjs-mail-transport': 'CONFIG',
  'nextjs-session-cookie': 'NAME',
  'nextjs-totp-verify': 'OPTIONS',
  'express-route': 'PATH',
  'express-form-fields': 'FIELD',
  'express-inline-handler': 'METHOD',
  'express-auth-guard': 'PASSWORD',
  'express-password-hash': 'PASSWORD',
  'express-token-create': 'SIZE',
  'express-token-persist': 'QUERY',
  'express-token-verify': 'TOKEN',
  'express-mail-transport': 'MESSAGE',
  'express-session-cookie': 'NAME',
  'express-totp-verify': 'TOKEN',
  'laravel-route': 'PATH',
};

const realCases: Record<string, { positive: string; negative: string }> = {
  'nextjs-page-route': {
    positive: 'test-fixtures/reference-auth-app/app/login/page.tsx',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-route-handler': {
    positive: 'test-fixtures/reference-auth-app/app/logout/route.ts',
    negative: 'test-fixtures/reference-auth-app/lib/db.ts',
  },
  'nextjs-auth-form': {
    positive: 'test-fixtures/reference-auth-app/app/login/page.tsx',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-server-action': {
    positive: 'test-fixtures/reference-auth-app/app/login/actions.ts',
    negative: 'test-fixtures/reference-auth-app/lib/db.ts',
  },
  'nextjs-auth-guard': {
    positive: 'test-fixtures/reference-auth-app/app/login/actions.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-password-hash': {
    positive: 'test-fixtures/reference-auth-app/app/login/actions.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-token-create': {
    positive: 'test-fixtures/reference-auth-app/lib/session.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-token-persist': {
    positive: 'test-fixtures/reference-auth-app/lib/session.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-token-verify': {
    positive: 'test-fixtures/reference-auth-app/lib/session.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-mail-transport': {
    positive: 'test-fixtures/reference-auth-app/lib/mail.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-session-cookie': {
    positive: 'test-fixtures/reference-auth-app/lib/session.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'nextjs-totp-verify': {
    positive: 'test-fixtures/reference-auth-app/app/mfa/challenge/actions.ts',
    negative: 'test-fixtures/reference-auth-app/app/layout.tsx',
  },
  'express-route': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/db.ts',
  },
  'express-form-fields': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-inline-handler': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/db.ts',
  },
  'express-auth-guard': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-password-hash': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-token-create': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-token-persist': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-token-verify': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
  'express-mail-transport': {
    positive: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/db.ts',
  },
  'express-session-cookie': {
    positive: 'test-fixtures/vulnerable-auth-app/src/server.ts',
    negative: 'test-fixtures/vulnerable-auth-app/src/mail.ts',
  },
};

describe('real sg per-rule positive and negative fixtures', async () => {
  const loaded = await loadPacks(packDirs);
  for (const rule of loaded.rules) {
    it(`${rule.packId}/${rule.id} matches every positive and no negative`, async () => {
      const fixtureRoot = join(rule.file, '../../tests', rule.id);
      const positives = (await readdir(join(fixtureRoot, 'positive'))).map((name) =>
        join(fixtureRoot, 'positive', name),
      );
      const negatives = (await readdir(join(fixtureRoot, 'negative'))).map((name) =>
        join(fixtureRoot, 'negative', name),
      );
      for (const positive of positives) {
        const result = await runRules({ cwd: workspaceRoot, rules: [rule], paths: [positive] });
        expect(result.diagnostics).toEqual([]);
        expect(result.matches.length).toBeGreaterThan(0);
        expect(result.matches[0]?.fields).toHaveProperty(expectedFields[rule.id]!);
      }
      const negative = await runRules({ cwd: workspaceRoot, rules: [rule], paths: negatives });
      expect(negative.diagnostics).toEqual([]);
      expect(negative.matches).toEqual([]);
      const real = realCases[rule.id];
      if (real) {
        const positive = await runRules({
          cwd: workspaceRoot,
          rules: [rule],
          paths: [real.positive],
        });
        const negativeReal = await runRules({
          cwd: workspaceRoot,
          rules: [rule],
          paths: [real.negative],
        });
        expect(positive.matches.length).toBeGreaterThan(0);
        expect(negativeReal.matches).toEqual([]);
      }
    });
  }
});
