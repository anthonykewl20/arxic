import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** Incremental, allow-listed progress; never writes test names, values or exception bodies. */
export default class DashboardProgressReporter {
  constructor() {
    this.path = process.env.ARXIC_DASHBOARD_PROGRESS_PATH;
    if (!this.path) throw new Error('Dashboard progress path is required');
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, '', { flag: 'wx' });
    this.started = performance.now();
    this.count = 0;
  }
  record(event, fields = {}) {
    if (++this.count > 5000) throw new Error('Dashboard progress record bound exceeded');
    appendFileSync(
      this.path,
      JSON.stringify({
        event,
        elapsedMs: Math.round(performance.now() - this.started),
        ...fields,
      }) + '\n',
    );
  }
  identity(test) {
    const file = basename(test.module.moduleId);
    return {
      file: /^[a-zA-Z0-9_.-]{1,160}$/u.test(file) ? file : 'unsupported-module',
      caseId: createHash('sha256').update(test.id).digest('hex').slice(0, 16),
      line: Number.isSafeInteger(test.location?.line) ? test.location.line : null,
    };
  }
  onTestRunStart() {
    this.record('run-start');
  }
  onTestCaseReady(test) {
    this.record('case-start', this.identity(test));
  }
  failureFields(test) {
    const error = test.result().errors?.[0] ?? {};
    const message = typeof error.message === 'string' ? error.message.slice(0, 512) : '';
    const timeout = /Test timed out in (\d+)ms/u.exec(message);
    const stack = typeof error.stack === 'string' ? error.stack.slice(0, 65536) : '';
    const marker = basename(test.module.moduleId) + ':';
    let failureLine = null;
    for (const line of stack.split('\n')) {
      const at = line.lastIndexOf(marker);
      if (at < 0) continue;
      const match = /^(\d+):\d+/u.exec(line.slice(at + marker.length));
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 1000000) {
        failureLine = Number(match[1]);
        break;
      }
    }
    return {
      failureKind: timeout
        ? 'reported-test-timeout'
        : error.name === 'AssertionError'
          ? 'assertion'
          : error.name === 'TimeoutError'
            ? 'browser-timeout'
            : 'other',
      failureLine,
      ...(timeout && Number(timeout[1]) <= 3600000
        ? { reportedTimeoutMs: Number(timeout[1]) }
        : {}),
    };
  }
  onTestCaseResult(test) {
    const state = test.result().state;
    this.record('case-result', {
      ...this.identity(test),
      state: ['passed', 'failed', 'skipped', 'pending'].includes(state) ? state : 'unknown',
      ...(state === 'failed' ? this.failureFields(test) : {}),
    });
  }
  onTestRunEnd(...args) {
    const reason = args[2];
    this.record('run-end', {
      reason: ['passed', 'failed', 'interrupted'].includes(reason) ? reason : 'unknown',
    });
  }
}
