import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

// setup-node's full distribution already contains the matching build headers.
// Avoid another network fetch during concurrent native dependency installs.
const prefix = dirname(dirname(realpathSync(process.execPath)));
const include = join(prefix, 'include', 'node');
const header = readFileSync(join(include, 'node_version.h'), 'utf8');
const version = ['MAJOR', 'MINOR', 'PATCH']
  .map((part) => header.match(new RegExp(`#define NODE_${part}_VERSION\\s+(\\d+)`))?.[1])
  .join('.');
if (version !== process.versions.node || /[\r\n]/u.test(prefix))
  throw new Error('Installed Node headers do not match the active runtime');
readFileSync(join(include, 'config.gypi'));
readFileSync(join(include, 'common.gypi'));
const setting = `npm_package_config_node_gyp_nodedir=${prefix}\n`;
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, setting);
else process.stdout.write(setting);
