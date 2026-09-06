import { join } from 'node:path';
import { readBoundedRegularFile } from '../../../packages/playwright-screenshot-privacy/src/safe-filesystem';
import { readEvidenceFile } from './evidence-files';
import { makeFrontendBundle } from './frontend-bundle';
import { assetDirectory, jobFile } from './runtime';
/** Byte validation mechanics; startup maps failures to one safe operator error. */
export async function packagedAssets() {
  try {
    const raw = await readBoundedRegularFile(join(assetDirectory, 'manifest.json'), {
      minimumBytes: 1,
      maximumBytes: 16384,
      onFailure: () => {
        throw new Error('Missing manifest');
      },
    });
    const manifest = JSON.parse(raw.toString('utf8'));
    if (
      !manifest ||
      typeof manifest !== 'object' ||
      Object.keys(manifest).sort().join(',') !== 'files,jobSha256,version' ||
      !/^[a-f0-9]{16}$/u.test(manifest.version) ||
      !manifest.files ||
      Object.keys(manifest.files).sort().join(',') !== 'app.css,app.js,index.html'
    )
      throw new Error('Invalid manifest');
    const assets = new Map<string, string | Uint8Array>();
    for (const name of ['app.js', 'app.css', 'index.html']) {
      const hash = manifest.files[name];
      if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash))
        throw new Error('Invalid hash');
      const file = await readEvidenceFile(join(assetDirectory, name), hash, 10 * 1024 * 1024);
      if (!file.ok) throw new Error('Invalid asset');
      assets.set(`/${name}`, file.bytes);
    }
    if (typeof manifest.jobSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.jobSha256))
      throw new Error('Invalid job hash');
    if (!(await readEvidenceFile(jobFile, manifest.jobSha256, 32 * 1024 * 1024)).ok)
      throw new Error('Invalid job');
    const bundle = makeFrontendBundle(assets);
    if (bundle.version !== manifest.version) throw new Error('Invalid version');
    return bundle;
  } catch {
    throw new Error('Packaged web assets are missing or invalid; reinstall the package');
  }
}
