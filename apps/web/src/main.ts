import { homedir } from 'node:os';
import { join } from 'node:path';
import { startWorkbench } from './server';

const token = process.env.ARXIC_ADMIN_TOKEN ?? '';
let roots: unknown;
try {
  roots = JSON.parse(
    process.env.ARXIC_WEB_ROOTS ?? JSON.stringify([process.env.INIT_CWD ?? process.cwd()]),
  );
} catch {
  throw new Error('ARXIC_WEB_ROOTS must be a JSON array of absolute folder paths');
}
if (!Array.isArray(roots) || !roots.every((value) => typeof value === 'string'))
  throw new Error('ARXIC_WEB_ROOTS must be a JSON array of folder paths');
const port = Number(process.env.ARXIC_WEB_PORT ?? '4310');
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid ARXIC_WEB_PORT');
const app = await startWorkbench({
  adminToken: token,
  stateDirectory: process.env.ARXIC_WEB_STATE_DIR ?? join(homedir(), '.arxic', 'web'),
  roots,
  port,
  host: process.env.ARXIC_WEB_HOST,
  publicOrigin: process.env.ARXIC_WEB_PUBLIC_ORIGIN,
});
console.log(`Arxic workbench: ${app.origin}`);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
