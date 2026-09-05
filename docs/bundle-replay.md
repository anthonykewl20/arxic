# Replay a generated bundle independently

Version: 0.1.0. The release audit executes this path against the installed
reference app, including a wrong-password failure. See the
[proof report](./reviews/release-0.1.0-398.md).

Copy the assembled `.bundle` directory to a separate working directory. Keep the
original immutable. Install the pinned runner in the copy (or an enclosing directory):

```sh
npm install --no-save @playwright/test@1.62.1
npx playwright install chromium
```

Start the same attested test build at the origin recorded in the generated spec.
Provision its fixture persona and set `ARXIC_INPUT_PERSONA_EMAIL` and
`ARXIC_INPUT_PERSONA_PASSWORD` through your environment. Do not put credentials
into the spec. For workflows requiring preauthenticated state, provision a fresh
state through the application's own login flow; the managed verifier's replay
persona setup is not executed by an independent Playwright invocation.

Named screenshots require an explicit capture policy. The following example is
for the reference app, whose main landmark contains the persona. Choose and
review a policy appropriate to your target. Save this as `replay.mjs` in the copy:

```js
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const timestamp = new Date().toISOString();
const policy = JSON.stringify(
  canonical({
    schemaVersion: 1,
    id: 'reference-app-independent-replay',
    authority: {
      kind: 'repository-policy',
      reference: 'docs/bundle-replay.md',
      recordedAt: timestamp,
    },
    capture: {
      mode: 'masked-page',
      fullPage: true,
      masks: [{ kind: 'role', role: 'main', exact: true }],
    },
  }),
);
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ARXIC_SCREENSHOT_PRIVACY_POLICY: policy,
    ARXIC_SCREENSHOT_PRIVACY_POLICY_SHA256: createHash('sha256').update(policy).digest('hex'),
    ARXIC_SCREENSHOT_CAPTURE_CORRELATION: randomUUID(),
    ARXIC_SCREENSHOT_CAPTURED_AT: timestamp,
  },
});
process.exitCode = result.status ?? 1;
```

Run `node replay.mjs`. Direct replay defaults to trace capture **off**, including
failed tests. The managed verifier explicitly enables capture, sanitizes the
result, validates provenance, and removes raw captures. Enabling raw tracing
manually does not make those files eligible for retention or sharing.

Independent execution produces untrusted screenshot capture receipts. A passing
Playwright exit does not assign a new Arxic truth state or promotion provenance.
Use the managed pipeline for fresh promotion and its required repeated runs.
The bundle's sanitized CycloneDX SBOM describes the Arxic build workspace,
including bundled adapters and development/fixture dependencies; it is not an
SBOM of the target application or an exact production-only install graph.
