import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { HttpError } from './errors';
import type { Project, RunMode } from './types';
import { validateExecution } from './execution';

export function nextSlot(cron: string, now = new Date()): string | null {
  if (!cron) return null;
  if (cron.trim().split(/\s+/u).length !== 5)
    throw new HttpError(400, 'Use a five-field cron expression in UTC');
  try {
    return CronExpressionParser.parse(cron, { currentDate: now, tz: 'UTC' }).next().toISOString();
  } catch {
    throw new HttpError(400, 'Invalid cron expression');
  }
}

export async function allowedFolder(folder: string, roots: readonly string[]): Promise<string> {
  if (!folder || !isAbsolute(folder))
    throw new HttpError(400, 'Project folder must be an absolute server path');
  let actual: string;
  try {
    actual = await realpath(folder);
    if (!(await stat(actual)).isDirectory()) throw new Error();
  } catch {
    throw new HttpError(400, 'Project folder must exist on this server');
  }
  if (!roots.some((root) => inside(root, actual)))
    throw new HttpError(400, 'Project folder is outside the configured workspace roots');
  return actual;
}
export function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return (
    part === '' ||
    (!isAbsolute(part) &&
      part !== '..' &&
      !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
  );
}
export function runMode(value: unknown): RunMode {
  if (value !== 'discovery' && value !== 'visual' && value !== 'agent')
    throw new HttpError(400, 'Choose discovery, visual, or agent');
  return value;
}
export async function validateProject(
  input: Record<string, unknown>,
  roots: readonly string[],
  previous?: Project,
): Promise<Project> {
  const allowed = [
    'name',
    'folder',
    'origin',
    'paths',
    'viewports',
    'masks',
    'captureConsent',
    'configPath',
    'execution',
    'cron',
    'scheduleMode',
    'paused',
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new HttpError(400, 'Unknown project setting');
  const text = (key: string, fallback = '', limit = 2048) => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'string' || value.length > limit)
      throw new HttpError(400, `Invalid ${key}`);
    return value.trim();
  };
  const name = text('name', '', 100);
  if (!name) throw new HttpError(400, 'Project name is required');
  const folder = await allowedFolder(text('folder'), roots);
  const origin = text('origin');
  if (origin) {
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== origin ||
        url.username ||
        url.password
      )
        throw new Error();
    } catch {
      throw new HttpError(
        400,
        'Target must be an HTTP(S) origin without credentials, path, or query',
      );
    }
  }
  const strings = (key: string, fallback: string[], max: number): string[] => {
    const value = input[key] ?? fallback;
    if (
      !Array.isArray(value) ||
      value.length > max ||
      value.some((item) => typeof item !== 'string' || item.length > 500 || !item.trim())
    )
      throw new HttpError(400, `Invalid ${key}`);
    return [...new Set(value as string[])];
  };
  const paths = strings('paths', ['/'], 20);
  if (
    paths.length < 1 ||
    paths.some(
      (path) =>
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\?#\s]/u.test(path) ||
        new URL(path, 'https://target.invalid').origin !== 'https://target.invalid',
    )
  )
    throw new HttpError(400, 'Use 1–20 relative page paths without query strings or fragments');
  const masks = strings('masks', [], 20);
  const viewports = input.viewports ?? [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ];
  if (
    !Array.isArray(viewports) ||
    viewports.length < 1 ||
    viewports.length > 3 ||
    viewports.some(
      (view) =>
        !view ||
        !Number.isInteger(view.width) ||
        view.width < 320 ||
        view.width > 1920 ||
        !Number.isInteger(view.height) ||
        view.height < 320 ||
        view.height > 1200,
    )
  )
    throw new HttpError(400, 'Choose 1–3 viewports, width 320–1920 and height 320–1200');
  for (const key of ['captureConsent', 'paused'])
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new HttpError(400, `Invalid ${key}`);
  let configPath = text('configPath');
  if (configPath) {
    try {
      configPath = await realpath(resolve(folder, configPath));
      if (!inside(folder, configPath) || !(await stat(configPath)).isFile()) throw new Error();
    } catch {
      throw new HttpError(400, 'AI configuration must be a file inside the project folder');
    }
  }
  const cron = text('cron', '', 100);
  const execution = validateExecution(input.execution, folder, origin);
  if (execution && configPath)
    throw new HttpError(400, 'Choose guided execution or a configuration file, not both');
  return {
    id: previous?.id ?? randomUUID(),
    name,
    folder,
    origin,
    paths,
    viewports,
    masks,
    captureConsent: input.captureConsent === true,
    configPath,
    ...(execution ? { execution } : {}),
    cron,
    scheduleMode: runMode(input.scheduleMode ?? 'discovery'),
    paused: input.paused !== false,
    nextRunAt: nextSlot(cron),
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
}
