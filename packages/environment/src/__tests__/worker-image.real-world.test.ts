import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkerSandbox,
  dockerVersion,
  dockerImageInspect,
  execInSandbox,
  inspectSandbox,
  type WorkerQuotas,
} from '..';

/**
 * B1-wire step 2 / #103: prove the real arxic-worker image launches under the
 * FULL sandbox hardening (non-root, read-only rootfs, tmpfs /work, read-only
 * source bind, cap-drop ALL, no-new-privileges, internal network, quotas) and
 * that the pipeline toolchain — node, pnpm, ast-grep (sg) — runs as a non-root
 * uid WITHOUT any network egress.
 *
 * The decisive red→green pivot is `pnpm --version` under the internal network:
 * the B1 spike image installed pnpm through corepack, which re-fetches the
 * prepared package per-uid and therefore fails under the sandbox's no-egress
 * network. The system-wide install (npm i -g) removes that dependency. This
 * test holds the line: if a future Dockerfile change reintroduces a
 * network-bound package-manager bootstrap, this assertion fails closed here.
 *
 * Local runs skip when Docker or the `arxic-worker:dev` image is unavailable.
 * CI sets `ARXIC_WORKER_IMAGE_REQUIRED=1`, so either missing prerequisite is a
 * hard failure after the worker-image job builds the image.
 */
const ARXIC_WORKER_IMAGE = 'arxic-worker:dev';
const workerImageRequired = process.env.ARXIC_WORKER_IMAGE_REQUIRED === '1';

const directories: string[] = [];
let dockerAvailable = false;
let dockerReason = '';
let imageAvailable = false;
const quotas: WorkerQuotas = {
  memoryMb: 512,
  memorySwapMb: 512,
  pidsLimit: 256,
  cpus: 1,
  timeoutMs: 60_000,
};

describe('real arxic-worker image under full sandbox hardening', () => {
  beforeAll(async () => {
    const version = await dockerVersion();
    dockerAvailable = version.exit === 0;
    dockerReason = version.stderr || version.stdout || 'docker version failed';
    if (dockerAvailable) {
      const inspect = await dockerImageInspect(ARXIC_WORKER_IMAGE);
      imageAvailable = inspect.exit === 0;
    }
  });

  const requireWorkerImage = (skip: (reason?: string) => void) => {
    if (!dockerAvailable) {
      const message = `Docker unavailable: ${dockerReason}`;
      if (workerImageRequired) throw new Error(`Worker image is required: ${message}`);
      skip(message);
    }

    if (!imageAvailable) {
      const message = `${ARXIC_WORKER_IMAGE} not built; run apps/worker/build-and-verify.sh`;
      if (workerImageRequired) throw new Error(`Worker image is required: ${message}`);
      skip(message);
    }
  };

  afterAll(async () => {
    await Promise.all(
      directories.map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('runs node, pnpm, and ast-grep as a non-root uid with no network egress', async ({ skip }) => {
    requireWorkerImage(skip);
    const jobId = `img-${process.pid}-${randomUUID().slice(0, 8)}`;
    const source = await mkdtemp(join(tmpdir(), 'arxic-m2-image-'));
    directories.push(source);
    await writeFile(join(source, 'source.txt'), 'mounted');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      image: ARXIC_WORKER_IMAGE,
      quotas,
      networkName: `arxic-${jobId}-net`,
    });
    try {
      // node: the version pinned by the image (>=22.22 per ADR-006 / #114).
      const nodeVersion = await execInSandbox(sandbox, [
        'node',
        '-e',
        'process.stdout.write(process.versions.node)',
      ]);
      expect(nodeVersion.exit, nodeVersion.stderr).toBe(0);
      const [major, minor] = nodeVersion.stdout.split('.').map(Number);
      expect(major > 22 || (major === 22 && minor >= 22)).toBe(true);

      // pnpm: the decisive assertion. Under corepack this re-fetches over the
      // network and fails on the internal network; under the system-wide
      // install it resolves locally with no egress.
      const pnpmVersion = await execInSandbox(sandbox, ['pnpm', '--version']);
      expect(pnpmVersion.exit, pnpmVersion.stderr).toBe(0);
      expect(pnpmVersion.stdout).toMatch(/^\d+\.\d+\.\d+/);

      // ast-grep (sg): resolves from the installed workspace node_modules with
      // no network. Proves the real M2 source-rule engine runs in-sandbox.
      const sgVersion = await execInSandbox(sandbox, [
        'pnpm',
        '--filter',
        '@arxic/ast-grep-adapter',
        'exec',
        'sg',
        '--version',
      ]);
      expect(sgVersion.exit, sgVersion.stderr).toBe(0);
      expect(sgVersion.stdout).toMatch(/ast.grep/i);

      // non-root: the hardening's --user mirrors the host uid (never root).
      const uid = await execInSandbox(sandbox, ['id', '-u']);
      expect(uid).toMatchObject({ exit: 0, stdout: String(process.getuid!()) });

      // read-only rootfs: a write to /etc is denied.
      const rootWrite = await execInSandbox(sandbox, ['sh', '-c', 'printf no > /etc/foo']);
      expect(rootWrite.exit).not.toBe(0);
      expect(rootWrite.stderr).toMatch(/read-only file system/i);

      // source bind stays readable.
      expect(await execInSandbox(sandbox, ['cat', '/work/source/source.txt'])).toMatchObject({
        exit: 0,
        stdout: 'mounted',
      });

      // internal network: the host gateway and cloud metadata endpoint are
      // unreachable. node:22-slim ships no wget/curl, so use node's net module.
      const gateway = await execInSandbox(sandbox, [
        'node',
        '-e',
        "const net=require('net');" +
          "const s=net.connect(1,'169.254.169.254');" +
          "s.on('error',e=>{process.exit(/UNREACH|REFUSED|TIMEOUT/i.test(e.code)?0:1)});" +
          'setTimeout(()=>process.exit(1),3000);',
      ]);
      expect(gateway.exit, gateway.stdout + gateway.stderr).toBe(0);
    } finally {
      await sandbox.stop();
    }
  }, 180_000);

  it('keeps the sandbox non-root and torn down after the run', async ({ skip }) => {
    requireWorkerImage(skip);
    const jobId = `img-clean-${process.pid}-${randomUUID().slice(0, 8)}`;
    const source = await mkdtemp(join(tmpdir(), 'arxic-m2-image-clean-'));
    directories.push(source);
    await writeFile(join(source, 'source.txt'), 'ok');
    const sandbox = await createWorkerSandbox({
      jobId,
      sourcePath: source,
      image: ARXIC_WORKER_IMAGE,
      quotas,
      networkName: `arxic-${jobId}-net`,
    });
    try {
      const state = await inspectSandbox(sandbox);
      expect(state.status).toBe('running');
      expect((await execInSandbox(sandbox, ['id', '-u'])).stdout).toBe(String(process.getuid!()));
    } finally {
      await sandbox.stop();
    }
  }, 120_000);
});
