import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateDiagnostic, validateEvidenceRef } from '@arxic/contracts';
import { describe, expect, it } from 'vitest';
import { AstGrepAdapter, canonicalJson } from '..';
import { makeRepository, packDirs } from './test-repo';

describe('real sg CLI proof against the auth fixture apps', () => {
  it.each([
    [
      'reference-auth-app',
      'nextjs',
      ['session-cookie', 'mail-transport', 'token-create', 'token-persist', 'totp-verify'],
    ],
    [
      'vulnerable-auth-app',
      'express',
      ['session-cookie', 'mail-transport', 'token-create', 'token-persist'],
    ],
  ] as const)(
    'connects route to handler to guard for %s',
    async (fixture, framework, categories) => {
      const repo = await makeRepository(fixture);
      const adapter = new AstGrepAdapter({
        packs: packDirs,
        now: () => '2026-08-05T12:00:00.000Z',
      });
      const first = await adapter.scan({
        revision: repo.revision,
        features: ['login'],
        framework,
      });
      const second = await adapter.scan({
        revision: repo.revision,
        features: ['login'],
        framework,
      });
      const login = first.chains.find(
        (chain) => chain.framework === framework && chain.feature === 'login',
      );
      expect(new Set(first.matches.map((match) => match.packId))).toEqual(
        new Set([`${framework}-auth`]),
      );
      expect(login).toMatchObject({
        routePath: '/login',
        status: 'connected',
        truthState: 'hypothesized',
      });
      expect(login?.evidence.length).toBeGreaterThanOrEqual(3);
      expect(
        new Set(login?.evidence.map((ref) => ref.ruleId!.split('/')[1]?.split('@')[0])),
      ).toEqual(
        framework === 'nextjs'
          ? new Set(['nextjs-page-route', 'nextjs-server-action', 'nextjs-auth-guard'])
          : new Set(['express-route', 'express-inline-handler', 'express-auth-guard']),
      );
      if (framework === 'nextjs') {
        const loginGuards = first.matches.filter(
          (match) =>
            match.packId === 'nextjs-auth' &&
            match.category === 'guard' &&
            match.file === 'app/login/actions.ts',
        );
        expect([...new Set(loginGuards.map((match) => match.fields.GUARD))]).toEqual(
          expect.arrayContaining(['verifyCsrf', 'consumeRateLimit']),
        );
        const passwordEvidence = first.matches.find(
          (match) =>
            match.packId === 'nextjs-auth' &&
            match.category === 'password-hash' &&
            match.file === 'app/login/actions.ts' &&
            'PASSWORD' in match.fields,
        );
        expect(passwordEvidence?.fields).toMatchObject({
          PASSWORD: 'password',
          HASH: 'user.passwordHash',
        });
      } else {
        const loginRoute = first.matches.find(
          (match) =>
            match.packId === 'express-auth' &&
            match.category === 'route' &&
            match.fields.METHOD === 'post' &&
            match.fields.PATH === "'/login'",
        );
        expect(loginRoute).toBeDefined();
        const linkedGuard = first.matches.find(
          (match) =>
            match.packId === 'express-auth' &&
            match.category === 'guard' &&
            'PASSWORD' in match.fields &&
            match.file === loginRoute?.file &&
            match.startLine >= loginRoute.startLine &&
            match.endLine <= loginRoute.endLine,
        );
        expect(linkedGuard?.fields).toMatchObject({
          PASSWORD: 'password',
          HASH: 'user.passwordHash',
        });
      }
      for (const category of categories)
        expect(first.matches.some((match) => match.category === category)).toBe(true);
      expect(canonicalJson(first)).toBe(canonicalJson(second));
      for (const event of first.events)
        expect(
          'ref' in event ? validateEvidenceRef(event.ref) : validateDiagnostic(event.diagnostic),
        ).toMatchObject({ ok: true });
      for (const match of first.matches) {
        const bytes = await readFile(join(repo.root, match.evidence.path));
        expect(match.evidence.blobSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      }
    },
  );
});
