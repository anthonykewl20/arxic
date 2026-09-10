import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import { HttpError } from './errors';
import type { Project, RunMode, ProjectEnvironment } from './types';
import { secretRef, validateExecution } from './execution';
import { INDUCIBLE_STATUSES, isInducibleStatus } from './state-induction';

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
    throw new HttpError(
      400,
      'Project folder is outside the configured workspace roots; add its folder under Settings → Project roots',
    );
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
    'environment',
    'repositoryUrl',
    'paths',
    'stateCaptures',
    'componentCaptures',
    'viewports',
    'browsers',
    'colorSchemes',
    'deviceScaleFactors',
    'masks',
    'captureConsent',
    'pageMode',
    'recordVideo',
    'maxPages',
    'maxDepth',
    'visualChangeRatio',
    'login',
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
  // Unset means development: a project nobody has classified is treated as the
  // one where a mistake is cheapest, never as production.
  const environment = text('environment', previous?.environment ?? 'development', 20);
  if (!['development', 'staging', 'production'].includes(environment))
    throw new HttpError(400, 'Environment must be development, staging, or production');
  // Kept from the previous record when an edit does not mention it, the way
  // every other detected field is; validated so it can only ever be a link a
  // browser can follow to a repository.
  const repositoryUrl = text('repositoryUrl', previous?.repositoryUrl ?? '', 200);
  if (
    repositoryUrl &&
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositoryUrl)
  )
    throw new HttpError(400, 'Repository must be an https://github.com/owner/repository URL');
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
    if (!Array.isArray(value)) throw new HttpError(400, `Invalid ${key}`);
    if (value.length > max) throw new HttpError(400, `Use at most ${max} ${key}`);
    if (value.some((item) => typeof item !== 'string' || item.length > 500 || !item.trim()))
      throw new HttpError(400, `Each entry in ${key} must be non-empty text under 500 characters`);
    return [...new Set((value as string[]).map((item) => item.trim()))];
  };
  const paths = strings('paths', ['/'], 200);
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
    throw new HttpError(400, 'Use 1–200 relative page paths without query strings or fragments');
  const rawStateCaptures = input.stateCaptures;
  if (rawStateCaptures !== undefined) {
    if (
      !Array.isArray(rawStateCaptures) ||
      rawStateCaptures.length > 20 ||
      rawStateCaptures.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          Array.isArray(item) ||
          Object.keys(item).some(
            (name) => !['path', 'state', 'query', 'fault', 'submitEmptyForms'].includes(name),
          ),
      )
    )
      throw new HttpError(400, 'A project supports at most 20 state checkpoints');
    for (const item of rawStateCaptures as Array<Record<string, unknown>>) {
      const path = item.path;
      if (
        typeof path !== 'string' ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\s]/u.test(path) ||
        new URL(path, 'https://target.invalid').origin !== 'https://target.invalid' ||
        /[?#]/u.test(path)
      )
        throw new HttpError(400, 'State checkpoints use relative page paths without query strings');
      if (item.state === undefined)
        throw new HttpError(400, 'A state checkpoint requires a state name');
      if (typeof item.state !== 'string' || !/^[a-z0-9-]{1,40}$/u.test(item.state))
        throw new HttpError(400, 'State checkpoint names use lowercase letters, digits and dashes');
      if (item.query !== undefined && (typeof item.query !== 'string' || item.query.length > 500))
        throw new HttpError(400, 'State checkpoint queries are short URL query strings');
      if (item.fault !== undefined) {
        const fault = item.fault as Record<string, unknown> | null;
        if (
          !fault ||
          typeof fault !== 'object' ||
          Array.isArray(fault) ||
          Object.keys(fault).some((name) => !['status', 'path'].includes(name)) ||
          !isInducibleStatus(fault.status)
        )
          throw new HttpError(
            400,
            `An induced fault names one of these statuses: ${INDUCIBLE_STATUSES.join(', ')}`,
          );
        if (
          fault.path !== undefined &&
          (typeof fault.path !== 'string' || !fault.path.length || fault.path.length > 200)
        )
          throw new HttpError(400, 'An induced fault path is a short request-path fragment');
      }
      if (item.submitEmptyForms !== undefined && typeof item.submitEmptyForms !== 'boolean')
        throw new HttpError(400, 'Invalid state checkpoint form submission flag');
    }
    const identities = new Set(
      (
        rawStateCaptures as Array<{
          path: string;
          state: string;
          query?: string;
          fault?: { status: number; path?: string };
          submitEmptyForms?: boolean;
        }>
      ).map(
        (item) =>
          `${item.path}#${item.state}?${item.query ?? ''}` +
          `!${item.fault ? `${item.fault.status}:${item.fault.path ?? ''}` : ''}` +
          `+${item.submitEmptyForms ? 'forms' : ''}`,
      ),
    );
    if (identities.size !== rawStateCaptures.length)
      throw new HttpError(400, 'State checkpoints must be unique path, state and query triples');
  }
  const stateCaptures = (rawStateCaptures as Project['stateCaptures'])?.map((item) => ({
    path: item.path,
    state: item.state,
    ...(item.query ? { query: item.query } : {}),
    ...(item.fault
      ? {
          fault: {
            status: item.fault.status,
            ...(item.fault.path ? { path: item.fault.path } : {}),
          },
        }
      : {}),
    ...(item.submitEmptyForms ? { submitEmptyForms: true } : {}),
  }));
  const rawComponentCaptures = input.componentCaptures;
  if (
    rawComponentCaptures !== undefined &&
    (!Array.isArray(rawComponentCaptures) ||
      rawComponentCaptures.length > 20 ||
      rawComponentCaptures.some(
        (item) => typeof item !== 'string' || !item.trim() || item.length > 200,
      ))
  )
    throw new HttpError(400, 'A project isolates at most 20 component selectors');
  const componentCaptures = (rawComponentCaptures as string[] | undefined)
    ?.map((item) => item.trim())
    .filter((item, index, all) => all.indexOf(item) === index);

  const selection = (key: string, choices: readonly string[], fallback: string[]) => {
    const value = input[key] === undefined ? fallback : input[key];
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > choices.length ||
      value.some((item) => typeof item !== 'string' || !choices.includes(item)) ||
      new Set(value).size !== value.length
    )
      throw new HttpError(400, `Choose distinct supported visual ${key}`);
    return choices.filter((item) => value.includes(item));
  };
  const browsers = selection(
    'browsers',
    ['chromium', 'firefox', 'webkit'],
    ['chromium'],
  ) as NonNullable<Project['browsers']>;
  const colorSchemes = selection('colorSchemes', ['light', 'dark'], ['light']) as NonNullable<
    Project['colorSchemes']
  >;
  const masks = strings('masks', [], 20);
  const densities = input.deviceScaleFactors ?? [1];
  if (
    !Array.isArray(densities) ||
    !densities.length ||
    densities.length > 3 ||
    densities.some((value) => ![1, 2, 3].includes(value)) ||
    new Set(densities).size !== densities.length ||
    input.deviceScaleFactors === null
  )
    throw new HttpError(400, 'Choose distinct supported visual pixel ratios: 1, 2 or 3');
  const deviceScaleFactors = ([1, 2, 3] as const).filter((value) => densities.includes(value));
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
  if (
    viewports.some((view) =>
      deviceScaleFactors.some(
        (density) => view.width * view.height * density ** 2 > 16 * 1024 * 1024,
      ),
    )
  )
    throw new HttpError(
      400,
      'Viewport and pixel ratio exceed the retained PNG pixel limit; reduce either setting',
    );
  if (input.pageMode !== undefined && input.pageMode !== 'manual' && input.pageMode !== 'discover')
    throw new HttpError(400, 'Choose manual or discover page mode');
  if (input.recordVideo === true)
    throw new HttpError(
      400,
      'Unmasked video recording is unavailable. Named masked screenshots and the sanitized action timeline are recorded automatically.',
    );
  for (const key of ['captureConsent', 'paused', 'recordVideo'])
    if (input[key] !== undefined && typeof input[key] !== 'boolean')
      throw new HttpError(400, `Invalid ${key}`);
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const value = input[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
    return value;
  };
  const maxPages = bounded('maxPages', 50, 1, 200);
  const maxDepth = bounded('maxDepth', 3, 1, 5);
  // Unlike `bounded`, the visual change ratio is a fraction, not a whole number.
  const visualChangeRatio = input.visualChangeRatio === undefined ? 0 : input.visualChangeRatio;
  if (
    typeof visualChangeRatio !== 'number' ||
    !Number.isFinite(visualChangeRatio) ||
    visualChangeRatio < 0 ||
    visualChangeRatio > 0.5
  )
    throw new HttpError(400, 'visualChangeRatio must be a number from 0 to 0.5');
  let login: Project['login'];
  if (input.login !== undefined && input.login !== null) {
    const value = input.login;
    const keys = [
      'loginPath',
      'emailRef',
      'passwordRef',
      'emailLabel',
      'passwordLabel',
      'submitLabel',
      'emailPlaceholder',
      'passwordPlaceholder',
    ];
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))
    )
      throw new HttpError(400, 'Unknown or malformed login setting');
    const record = value as Record<string, unknown>;
    const field = (key: string, fallback: string) => {
      const item = record[key] ?? fallback;
      if (typeof item !== 'string' || item.length > 200)
        throw new HttpError(400, `Invalid login ${key}`);
      return item.trim();
    };
    const loginPath = field('loginPath', '/login');
    if (!loginPath.startsWith('/') || loginPath.startsWith('//') || /[\\?#\s]/u.test(loginPath))
      throw new HttpError(400, 'Login path must be a relative page path');
    const emailRef = secretRef(record.emailRef);
    const passwordRef = secretRef(record.passwordRef);
    if (!emailRef || !passwordRef)
      throw new HttpError(400, 'Sign-in requires email and password secret references');
    if (!origin) throw new HttpError(400, 'Sign-in requires a running test app origin');
    const optionalField = (key: string) => {
      if (record[key] === undefined || record[key] === null) return undefined;
      return field(key, '') || undefined;
    };
    const emailPlaceholder = optionalField('emailPlaceholder');
    const passwordPlaceholder = optionalField('passwordPlaceholder');
    login = {
      loginPath,
      emailRef,
      passwordRef,
      emailLabel: field('emailLabel', 'Email') || 'Email',
      passwordLabel: field('passwordLabel', 'Password') || 'Password',
      submitLabel: field('submitLabel', 'Sign in') || 'Sign in',
      ...(emailPlaceholder ? { emailPlaceholder } : {}),
      ...(passwordPlaceholder ? { passwordPlaceholder } : {}),
    };
  }
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
  if (execution?.checkpointCapture && input.captureConsent !== true)
    throw new HttpError(400, 'Workflow screenshots require capture consent');
  if (execution && configPath)
    throw new HttpError(400, 'Choose guided execution or a configuration file, not both');
  return {
    id: previous?.id ?? randomUUID(),
    name,
    folder,
    origin,
    environment: environment as ProjectEnvironment,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    paths,
    ...(stateCaptures?.length ? { stateCaptures } : {}),
    ...(componentCaptures?.length ? { componentCaptures } : {}),
    viewports,
    browsers,
    colorSchemes,
    deviceScaleFactors,
    masks,
    captureConsent: input.captureConsent === true,
    pageMode: input.pageMode === 'discover' ? 'discover' : 'manual',
    recordVideo: input.recordVideo === true,
    maxPages,
    maxDepth,
    visualChangeRatio,
    ...(login ? { login } : {}),
    configPath,
    ...(execution ? { execution } : {}),
    cron,
    scheduleMode: runMode(input.scheduleMode ?? 'discovery'),
    paused: input.paused !== false,
    nextRunAt: nextSlot(cron),
    createdAt: previous?.createdAt ?? new Date().toISOString(),
  };
}
