import type { WorkbenchOptions } from '../server';

/** Run identical browser assertions against source or the installed public command. */
export async function startWorkbench(options: WorkbenchOptions): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const binary = process.env.ARXIC_TEST_INSTALLED_WEB_BIN;
  if (!binary) return (await import('../server')).startWorkbench(options);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARXIC_ADMIN_TOKEN: options.adminToken,
    ARXIC_WEB_ROOTS: JSON.stringify(options.roots),
    ARXIC_WEB_STATE_DIR: options.stateDirectory,
    ARXIC_WEB_PORT: String(options.port ?? 0),
    ARXIC_WEB_HOST: options.host ?? '127.0.0.1',
  };
  delete env.NODE_PATH;
  delete env.ARXIC_WEB_PUBLIC_ORIGIN;
  if (options.publicOrigin) env.ARXIC_WEB_PUBLIC_ORIGIN = options.publicOrigin;
  const { startInstalledWeb } = await import(
    new URL('../../../../scripts/installed-web-runtime.mjs', import.meta.url).href
  );
  return startInstalledWeb({ binary, env });
}
