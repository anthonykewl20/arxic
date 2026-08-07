import { describe, expect, it } from 'vitest';
import { parseArgs } from '../args';

describe('parseArgs', () => {
  it('rejects an unknown command with stable usage diagnostics', () => {
    expect(parseArgs(['launch'])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CLI-USAGE', severity: 'blocked' }],
    });
  });

  it('rejects run without a config path', () => {
    expect(parseArgs(['run'])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CLI-USAGE' }],
    });
  });

  it('rejects an unknown flag', () => {
    expect(parseArgs(['run', '--config', 'x', '--unsafe'])).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'ARXIC-CLI-USAGE' }],
    });
  });

  it.each([['--version'], ['-v']])('parses %s', (flag) => {
    expect(parseArgs([flag])).toEqual({ ok: true, command: { kind: 'version' } });
  });

  it.each([['--help'], ['-h']])('parses %s', (flag) => {
    expect(parseArgs([flag])).toEqual({ ok: true, command: { kind: 'help' } });
  });

  it('parses run output options', () => {
    expect(parseArgs(['run', '--config', 'x', '--out', 'y'])).toEqual({
      ok: true,
      command: { kind: 'run', config: 'x', out: 'y' },
    });
  });

  it('parses an explicit run identifier', () => {
    expect(parseArgs(['run', '--config', 'x', '--run-id', 'foo'])).toEqual({
      ok: true,
      command: { kind: 'run', config: 'x', runId: 'foo' },
    });
  });
});
