import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { validateProject } from '../projects';
import { githubRepository } from '../workspace';

const folder = resolve(import.meta.dirname, '../../../..');

it('keeps omitted visual change ratio at the pixel-exact default', async () => {
  const project = await validateProject({ name: 'Ratio default', folder }, [folder]);
  expect(project.visualChangeRatio).toBe(0);
});

it.each([0, 0.005, 0.5])('admits visual change ratio %j', async (visualChangeRatio) => {
  const project = await validateProject({ name: 'Ratio', folder, visualChangeRatio }, [folder]);
  expect(project.visualChangeRatio).toBe(visualChangeRatio);
});

it.each([-0.1, 0.6, 1.5, 'abc', Number.NaN, null])(
  'refuses unsupported visual change ratio %j',
  async (visualChangeRatio) => {
    await expect(
      validateProject({ name: 'Ratio', folder, visualChangeRatio }, [folder]),
    ).rejects.toThrow('visualChangeRatio must be a number from 0 to 0.5');
  },
);

it('keeps the unknown-setting rejection for fields outside the whitelist', async () => {
  await expect(
    validateProject({ name: 'Ratio', folder, pixelTolerance: 0.2 }, [folder]),
  ).rejects.toThrow('Unknown project setting');
});

it('treats a project nobody has classified as development', async () => {
  // The safe assumption: never guess that an unlabelled target is production,
  // and never guess that a production one is safe to submit forms on.
  const project = await validateProject({ name: 'Unclassified', folder }, [folder]);
  expect(project.environment).toBe('development');
});

it.each(['development', 'staging', 'production'])('admits the %s environment', async (value) => {
  const project = await validateProject({ name: 'Env', folder, environment: value }, [folder]);
  expect(project.environment).toBe(value);
});

it('refuses an environment it does not know', async () => {
  await expect(
    validateProject({ name: 'Env', folder, environment: 'prod' }, [folder]),
  ).rejects.toThrow('Environment must be development, staging, or production');
});

it('keeps the environment when an edit does not mention it', async () => {
  const previous = await validateProject({ name: 'Env', folder, environment: 'production' }, [
    folder,
  ]);
  const edited = await validateProject({ name: 'Env renamed', folder }, [folder], previous);
  expect(edited.environment).toBe('production');
});

it.each([
  ['https://github.com/owner/repo', 'https://github.com/owner/repo'],
  ['https://github.com/owner/repo.git', 'https://github.com/owner/repo'],
  ['git@github.com:owner/repo.git', 'https://github.com/owner/repo'],
  ['ssh://git@github.com/owner/repo.git', 'https://github.com/owner/repo'],
  ['https://token@github.com/owner/repo.git\n', 'https://github.com/owner/repo'],
])('reads %s as a link a browser can open', (remote, expected) => {
  expect(githubRepository(remote)).toBe(expected);
});

it.each([
  'https://gitlab.com/owner/repo.git',
  '/srv/local/checkout',
  'git@github.com:owner',
  '',
  'https://github.com/owner/repo/tree/main',
])('returns nothing rather than guessing at %j', (remote) => {
  // A remote shape we do not recognise gets no link at all; the page names the
  // file instead. A wrong link is worse than no link.
  expect(githubRepository(remote)).toBeNull();
});

it('keeps a detected repository through an edit that does not mention it', async () => {
  const previous = await validateProject(
    { name: 'Linked', folder, repositoryUrl: 'https://github.com/owner/repo' },
    [folder],
  );
  expect(previous.repositoryUrl).toBe('https://github.com/owner/repo');
  const edited = await validateProject({ name: 'Renamed', folder }, [folder], previous);
  expect(edited.repositoryUrl).toBe('https://github.com/owner/repo');
});

it('refuses a repository that is not a GitHub repository URL', async () => {
  await expect(
    validateProject({ name: 'Linked', folder, repositoryUrl: 'https://example.com/x' }, [folder]),
  ).rejects.toThrow('Repository must be an https://github.com/owner/repository URL');
});

it('leaves the field off a project with no repository', async () => {
  expect(await validateProject({ name: 'Unlinked', folder }, [folder])).not.toHaveProperty(
    'repositoryUrl',
  );
});
