import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { HttpError } from './errors';
import { allowedFolder, inside } from './projects';

const run = promisify(execFile);

export type FolderCandidate = {
  path: string;
  name: string;
  framework: string | null;
  git: boolean;
  hasPackage: boolean;
};
export type Detection = {
  folder: string;
  name: string;
  framework: string | null;
  language: 'typescript' | 'javascript' | null;
  origin: string;
  paths: string[];
  configPath: string;
  git: { repository: boolean; clean: boolean | null; branch: string | null };
};

const frameworkPorts: Record<string, number> = {
  next: 3000,
  remix: 3000,
  nuxt: 3000,
  express: 3000,
  astro: 4321,
  vite: 5173,
  sveltekit: 5173,
  angular: 4200,
  'create-react-app': 3000,
};

async function packageJson(folder: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await readFile(join(folder, 'package.json'), 'utf8');
    if (text.length > 1024 * 1024) return null;
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function frameworkOf(pkg: Record<string, unknown> | null): string | null {
  if (!pkg) return null;
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  if (deps.next) return 'next';
  if (deps['@remix-run/react']) return 'remix';
  if (deps.nuxt) return 'nuxt';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.astro) return 'astro';
  if (deps['@angular/core']) return 'angular';
  if (deps['react-scripts']) return 'create-react-app';
  if (deps.vite) return 'vite';
  if (deps.express) return 'express';
  return null;
}
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
/** Shallow folder listing under the allowed roots, for the connect-project wizard. */
export async function listFolders(
  roots: readonly string[],
  query = '',
  limit = 40,
): Promise<FolderCandidate[]> {
  const needle = query.trim().toLowerCase();
  const found: FolderCandidate[] = [];
  const seen = new Set<string>();
  const visit = async (folder: string, depth: number) => {
    if (found.length >= limit) return;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules')
        continue;
      const path = join(folder, entry.name);
      if (seen.has(path)) continue;
      seen.add(path);
      const hasPackage = await exists(join(path, 'package.json'));
      const git = await exists(join(path, '.git'));
      if (!needle || entry.name.toLowerCase().includes(needle))
        found.push({
          path,
          name: entry.name,
          framework: hasPackage ? frameworkOf(await packageJson(path)) : null,
          git,
          hasPackage,
        });
      if (!hasPackage && !git && depth < 2) await visit(path, depth + 1);
    }
  };
  for (const root of roots) {
    const hasPackage = await exists(join(root, 'package.json'));
    if (hasPackage && (!needle || basename(root).toLowerCase().includes(needle)))
      found.push({
        path: root,
        name: basename(root),
        framework: frameworkOf(await packageJson(root)),
        git: await exists(join(root, '.git')),
        hasPackage,
      });
    await visit(root, 0);
  }
  return found.sort((a, b) => Number(b.hasPackage) - Number(a.hasPackage));
}

async function routePaths(folder: string, framework: string | null): Promise<string[]> {
  const paths = new Set<string>(['/']);
  const scan = async (dir: string, prefix: string, kind: 'app' | 'pages', depth: number) => {
    if (depth > 4 || paths.size >= 200) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (paths.size >= 200) return;
      const name = entry.name;
      if (name.startsWith('_') || name.startsWith('.') || name === 'api') continue;
      if (entry.isDirectory()) {
        if (/[[\]@]/u.test(name)) continue;
        // Route groups "(group)" and parallel-route folders never appear in the URL.
        const segment = /^\(.*\)$/u.test(name) ? '' : `/${name}`;
        await scan(join(dir, name), `${prefix}${segment}`, kind, depth + (segment ? 1 : 0));
      } else if (kind === 'app' && /^page\.(t|j)sx?$/u.test(name)) paths.add(prefix || '/');
      else if (kind === 'pages' && /^[a-z0-9-]+\.(t|j)sx?$/u.test(name)) {
        const stem = name.replace(/\.(t|j)sx?$/u, '');
        paths.add(stem === 'index' ? prefix || '/' : `${prefix}/${stem}`);
      }
    }
  };
  if (framework === 'next') {
    for (const base of ['app', 'src/app']) await scan(join(folder, base), '', 'app', 0);
    for (const base of ['pages', 'src/pages']) await scan(join(folder, base), '', 'pages', 0);
  }
  // Shallow, top-level pages first so the 20-path cap keeps the app's main screens.
  return [...paths]
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, 20);
}
/** Inspect a folder and propose project settings; every value stays editable. */
export async function detectProject(folder: string, roots: readonly string[]): Promise<Detection> {
  const actual = await allowedFolder(folder, roots);
  const pkg = await packageJson(actual);
  const framework = frameworkOf(pkg);
  const language = (await exists(join(actual, 'tsconfig.json')))
    ? 'typescript'
    : pkg
      ? 'javascript'
      : null;
  const port = framework ? frameworkPorts[framework] : undefined;
  let configPath = '';
  for (const candidate of ['arxic.config.yaml', 'arxic.config.yml'])
    if (await exists(join(actual, candidate))) {
      configPath = candidate;
      break;
    }
  const git = { repository: false, clean: null as boolean | null, branch: null as string | null };
  try {
    const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: actual,
      timeout: 10_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    git.repository = inside.stdout.trim() === 'true';
  } catch {
    git.repository = false;
  }
  if (git.repository)
    try {
      const status = await run('git', ['status', '--porcelain', '--branch'], {
        cwd: actual,
        timeout: 10_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const lines = status.stdout.split('\n').filter(Boolean);
      git.branch = /^## (?:No commits yet on )?([^.\s]+)/u.exec(lines[0] ?? '')?.[1] ?? null;
      git.clean = lines.length <= 1;
    } catch {
      /* unreadable git state stays null */
    }
  const rawName = typeof pkg?.name === 'string' ? pkg.name : basename(actual);
  return {
    folder: actual,
    name: rawName.replace(/^@[^/]+\//u, '').slice(0, 100),
    framework,
    language,
    origin: port ? `http://localhost:${port}` : '',
    paths: await routePaths(actual, framework),
    configPath,
    git,
  };
}

const repository = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u;
/** Clone a public GitHub repository into the first workspace root; the folder then follows normal rules. */
export async function cloneRepository(
  input: unknown,
  roots: readonly string[],
): Promise<{ folder: string }> {
  if (typeof input !== 'string' || input.length > 300)
    throw new HttpError(400, 'Repository URL required');
  const match = repository.exec(input.trim());
  if (!match) throw new HttpError(400, 'Use an https://github.com/owner/repository URL');
  const [, owner, repo] = match;
  if (repo === '.' || repo === '..' || owner.startsWith('.'))
    throw new HttpError(400, 'Invalid repository name');
  const root = roots[0];
  if (!root) throw new HttpError(400, 'No workspace root is configured');
  const canonicalRoot = await realpath(root);
  let parent = join(canonicalRoot, 'arxic-clones');
  await mkdir(parent, { recursive: true });
  parent = await realpath(parent);
  if (!inside(canonicalRoot, parent))
    throw new HttpError(400, 'Clone directory escapes the workspace');
  const target = resolve(parent, repo);
  if (!inside(parent, target)) throw new HttpError(400, 'Invalid repository name');
  if (await exists(target))
    throw new HttpError(
      409,
      'Clone folder already exists. Connect the existing folder or choose another workspace.',
    );
  try {
    await run(
      'git',
      ['clone', '--quiet', '--single-branch', `https://github.com/${owner}/${repo}.git`, target],
      {
        timeout: 300_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      400,
      /not found|could not read|authentication|denied/iu.test(text)
        ? 'Repository not found or not public. Clone private repositories on the server, then connect the folder.'
        : 'Clone failed. Check the URL and the server network access.',
    );
  }
  return { folder: await realpath(target) };
}
