import { mkdir, mkdtemp, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';
import { cloneRepository, detectProject, listFolders } from '../workspace';
import { validateProject } from '../projects';
import { modelConnections } from '../model-connections';
import { Workbench } from '../workbench';

const run = promisify(execFile);
const cleanups: string[] = [];
afterEach(async () => {
  for (const path of cleanups.splice(0)) await rm(path, { recursive: true, force: true });
});
async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arxic-web-workspace-')));
  cleanups.push(root);
  return root;
}

it('rejects clone URLs that are not public GitHub repositories, before touching git', async () => {
  const root = await workspace();
  for (const url of [
    '',
    'git@github.com:owner/repo.git',
    'https://gitlab.com/owner/repo',
    'https://github.com/owner',
    'https://github.com/owner/repo?x=1',
    'https://github.com/../etc',
    42,
  ])
    await expect(cloneRepository(url, [root])).rejects.toThrow(
      /Repository URL required|owner\/repository URL|Invalid repository name/u,
    );
  await expect(cloneRepository('https://github.com/owner/repo', [])).rejects.toThrow(
    'No workspace root',
  );
});

it('refuses clone folders that escape the workspace or already exist', async () => {
  const root = await workspace();
  const outside = await workspace();
  await symlink(outside, join(root, 'arxic-clones'));
  // Existing directory ensures the regression never reaches a network clone.
  await mkdir(join(outside, 'repo'));
  await expect(cloneRepository('https://github.com/owner/repo', [root])).rejects.toThrow(
    'Clone directory escapes',
  );
  await rm(join(root, 'arxic-clones'));
  await mkdir(join(root, 'arxic-clones', 'repo'), { recursive: true });
  await expect(cloneRepository('https://github.com/owner/repo', [root])).rejects.toThrow(
    'already exists',
  );
});

it('refuses detection outside the allowed roots and reports git state inside them', async () => {
  const root = await workspace();
  const outside = await workspace();
  await expect(detectProject(outside, [root])).rejects.toThrow('outside the configured');
  const app = join(root, 'shop');
  await mkdir(join(app, 'app', 'pricing'), { recursive: true });
  await mkdir(join(app, 'app', 'api', 'orders'), { recursive: true });
  await mkdir(join(app, 'app', '[slug]'), { recursive: true });
  await mkdir(join(app, 'app', '(marketing)', 'about'), { recursive: true });
  await writeFile(join(app, 'app', '(marketing)', 'about', 'page.tsx'), '');
  for (let index = 0; index < 25; index++) {
    await mkdir(join(app, 'app', 'deep', `leaf-${String(index).padStart(2, '0')}`), {
      recursive: true,
    });
    await writeFile(
      join(app, 'app', 'deep', `leaf-${String(index).padStart(2, '0')}`, 'page.tsx'),
      '',
    );
  }
  await writeFile(join(app, 'app', 'page.tsx'), 'export default () => null;');
  await writeFile(join(app, 'app', 'pricing', 'page.tsx'), 'export default () => null;');
  await writeFile(join(app, 'app', 'api', 'orders', 'route.ts'), '');
  await writeFile(join(app, 'app', '[slug]', 'page.tsx'), '');
  await writeFile(join(app, 'tsconfig.json'), '{}');
  await writeFile(join(app, 'arxic.config.yaml'), 'version: 1\n');
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({ name: '@acme/shop', dependencies: { next: '15.0.0' } }),
  );
  const detected = await detectProject(app, [root]);
  expect(detected).toMatchObject({
    name: 'shop',
    framework: 'next',
    language: 'typescript',
    origin: 'http://localhost:3000',
    configPath: 'arxic.config.yaml',
    git: { repository: false, clean: null, branch: null },
  });
  expect(detected.paths.slice(0, 3)).toEqual(['/', '/about', '/pricing']);
  expect(detected.paths).toHaveLength(20);
  expect(detected.paths.some((path) => path.includes('('))).toBe(false);
  await run('git', ['init', '-q', '-b', 'main'], { cwd: app });
  const inRepo = await detectProject(app, [root]);
  expect(inRepo.git).toEqual({ repository: true, clean: false, branch: 'main' });
  const folders = await listFolders([root]);
  expect(folders.map((item) => [item.name, item.framework, item.hasPackage, item.git])).toEqual([
    ['shop', 'next', true, true],
  ]);
  expect(await listFolders([root], 'nothing-matches')).toEqual([]);
  const malformed = join(root, 'broken');
  await mkdir(malformed);
  await writeFile(join(malformed, 'package.json'), '{not json');
  expect((await listFolders([root], 'broken'))[0]).toMatchObject({
    name: 'broken',
    framework: null,
    hasPackage: true,
  });
});

it('validates page mode and video flags and merges discovered GET routes only', async () => {
  const root = await workspace();
  await expect(
    validateProject({ name: 'x', folder: root, pageMode: 'auto' }, [root]),
  ).rejects.toThrow('manual or discover');
  await expect(
    validateProject({ name: 'x', folder: root, recordVideo: 'yes' }, [root]),
  ).rejects.toThrow('Invalid recordVideo');
  await expect(
    validateProject({ name: 'x', folder: root, recordVideo: true }, [root]),
  ).rejects.toThrow('Unmasked video recording is unavailable');
  const project = await validateProject({ name: 'x', folder: root }, [root]);
  expect(project).toMatchObject({ pageMode: 'manual', recordVideo: false });
  const workbench = await Workbench.open(join(root, 'state'), [root]);
  try {
    const saved = await workbench.saveProject({
      name: 'Discover',
      folder: root,
      pageMode: 'discover',
      paths: ['/start'],
    });
    expect(workbench.discoveredPaths(saved)).toEqual(['/start']);
    const discovery = workbench.store.enqueue(saved, 'discovery')!;
    workbench.store.finish(discovery, {
      outcome: 'observed',
      summary: 'test',
      workflowRows: [
        { key: 'a', method: 'GET', path: '/pricing', disposition: 'x', reason: '' },
        { key: 'b', method: 'POST', path: '/checkout', disposition: 'x', reason: '' },
        { key: 'c', method: 'GET', path: '/users/:id', disposition: 'x', reason: '' },
        { key: 'd', method: 'GET', path: '/api/orders', disposition: 'x', reason: '' },
        { key: 'e', method: 'get', path: '/start', disposition: 'x', reason: '' },
        { key: 'f', method: 'GET', path: '/about', disposition: 'x', reason: '' },
      ],
    });
    expect(workbench.discoveredPaths(saved)).toEqual(['/start', '/pricing', '/about']);
    const visual = workbench.enqueue(saved.id, 'visual');
    expect(visual.project.paths).toEqual(['/start', '/pricing', '/about']);
    expect(workbench.store.project(saved.id)?.paths).toEqual(['/start']);
  } finally {
    await workbench.close();
  }
});

it('exposes only secret state to the browser, never the variable name', () => {
  const env = {
    ARXIC_MODEL_CONNECTIONS: JSON.stringify([
      {
        id: 'set',
        label: 'Configured',
        transport: 'http',
        baseUrl: 'https://models.example.test/v1',
        credentialRef: 'ARXIC_SECRET_SET',
        models: [],
      },
      {
        id: 'unset',
        label: 'Missing',
        transport: 'http',
        baseUrl: 'https://models.example.test/v1',
        credentialRef: 'ARXIC_SECRET_UNSET',
        models: [],
      },
    ]),
    ARXIC_SECRET_SET: 'value',
  } as NodeJS.ProcessEnv;
  const connections = modelConnections(env).filter((item) =>
    ['', 'set', 'unset'].includes(item.id),
  );
  expect(connections.map((item) => [item.id, item.secret])).toEqual([
    ['', 'none'],
    ['set', 'configured'],
    ['unset', 'missing'],
  ]);
  expect(JSON.stringify(connections)).not.toMatch(/ARXIC_SECRET|value/u);
});
