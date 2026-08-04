import { describe, expect, it } from 'vitest';
import { ARXIC_SOURCE_REVISION_INVALID, validateSourceRevision, type SourceRevision } from '..';

const sourceRevision: SourceRevision = {
  repository: 'https://github.com/example/shop',
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
  submodules: [
    {
      path: 'packages/idp',
      repository: 'https://github.com/example/idp',
      commit: '89abcdef0123456789abcdef0123456789abcdef',
    },
  ],
};

const expectInvalid = (input: unknown) => {
  const result = validateSourceRevision(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      ARXIC_SOURCE_REVISION_INVALID,
    );
  }
};

describe('SourceRevision contract', () => {
  it('rejects a revision missing dirty', () => {
    const { dirty, ...input } = sourceRevision;
    expect(dirty).toBe(false);
    expectInvalid(input);
  });

  it('rejects a revision with a bad commit pattern', () => {
    expectInvalid({ ...sourceRevision, commit: 'main' });
  });

  it('rejects a revision with a non-uri repository', () => {
    expectInvalid({ ...sourceRevision, repository: 'not a uri' });
  });

  it('rejects a submodule missing commit', () => {
    expectInvalid({
      ...sourceRevision,
      submodules: [{ path: 'packages/idp', repository: 'https://github.com/example/idp' }],
    });
  });

  it('accepts the ADR SourceRevision literal', () => {
    expect(validateSourceRevision(sourceRevision)).toEqual({ ok: true, value: sourceRevision });
  });

  it("accepts dirty:true (blob-link manufacturing is the producer's job in #8)", () => {
    const dirtyRevision = { ...sourceRevision, dirty: true };
    expect(validateSourceRevision(dirtyRevision)).toEqual({ ok: true, value: dirtyRevision });
  });
});
