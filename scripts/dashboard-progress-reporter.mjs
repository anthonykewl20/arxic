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
  onTestCaseResult(test) {
    const state = test.result().state;
    this.record('case-result', {
      ...this.identity(test),
      state: ['passed', 'failed', 'skipped', 'pending'].includes(state) ? state : 'unknown',
    });
  }
  onTestRunEnd(...args) {
    const reason = args[2];
    this.record('run-end', {
      reason: ['passed', 'failed', 'interrupted'].includes(reason) ? reason : 'unknown',
    });
  }
}
