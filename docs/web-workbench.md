# Run the Arxic web workbench

The web workbench is an initial, usable self-hosted frontend for the existing
engine and a new visual comparison lane. The [product specification](web-product-spec.md)
lists what is implemented and what remains before the full web product release.
The dashboard displays `v0.0.200`; the CLI displays the same label and canonical package metadata uses `0.0.200`.

## Local setup

Use a checkout of this repository with Node 22.22 or newer and its pinned pnpm.

```bash
pnpm install --frozen-lockfile
pnpm --filter @arxic/web exec playwright install chromium
export ARXIC_ADMIN_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
export ARXIC_WEB_ROOTS='["/absolute/path/to/your/projects"]'
pnpm web
```

Open `http://127.0.0.1:4310` and sign in using the token you just configured.
Keep it in your local secret manager or environment; never commit it. The app
does not log the token. `ARXIC_WEB_ROOTS` is a JSON array of allowed folders on
the Arxic host. Without it, the launching pnpm working directory is the root.
Source indexing expects a Git repository with a resolvable, non-shallow HEAD;
dirty files are reported and can block provenance-dependent AI execution.

The state directory defaults to `~/.arxic/web` and should live outside the target
checkout. It contains SQLite, queued/run records, artifacts and the instance
lock. Use a private directory and a local persistent filesystem. Only one server
may use it at a time. No remote repository or local folder is uploaded by the
dashboard itself; configured AI providers still receive the existing engine's
scoped evidence according to its model/source-retention configuration.

## First project

1. Add a project with a name and an absolute **server-side** folder path. Symlink
   escapes from the allow-list are rejected.
2. Run **Discover intents**. This runs the actual source parser and shows its
   route/domain inventory, frontend declarations and evidence references. It is source discovery, not
   an assertion that all frontend business rules have been recovered.
3. For visual runs, enter the already-running test app's HTTP(S) origin, checkpoint
   paths, and viewport sizes. The initial lane captures the visible viewport,
   anonymously, at up to 20 paths × 3 viewports. It does not automatically scroll
   the whole page, log in, submit forms or explore every component state.
4. Authorize test-data screenshot capture and declare any additional privacy
   masks. Inputs, textareas and editable fields are always masked. Each additional
   selector must match at each configured checkpoint; a missing/invalid mask
   blocks capture rather than silently exposing the region.
5. Run **Visual test**, inspect the images and approve an intended baseline.
   Future runs compare actual pixels without updating it automatically. A changed
   screenshot is a review item; an unchanged one is not proof of business logic.
6. Use **AI E2E** after configuring the existing engine below. Review its outcome
   and the intent inventory; a single verified candidate is not complete coverage.

In **Intent inventory**, filter declarations by kind or search their labels and
source paths. Each row has a source revision, line range and SHA-256. Pages show
100 declarations; **Complete inventory JSON** contains all rows, per-file counts
and gaps. Active search text survives status polling. **Coverage gaps** exposes
unsupported templates, parsing failures, unsafe/symlinked paths, uncommitted or
changed bytes, and exhausted scan limits. These gaps stay visible alongside AI
ledger results.

Supported extraction is structural JS/TS/JSX/TSX: components, native controls,
action attributes, conditionals, state hooks/attributes, test declarations and
environment/feature-flag member expressions. Markdown/text headings and
requirement language outside fenced code are declarations, not independently
accepted business rules. EJS, HTML, Vue, Svelte and MDX component syntax are
explicitly unsupported; arbitrary aliases, generated markup and hidden
requirements cannot be recovered completely. Limits are 1 MiB per file, 5,000
eligible analyzed files and 20,000 declarations. Git-ignored and configured
source-policy exclusions are outside the manifest. Persona, flag value,
runtime route/state/action outcome and viewport coverage remains unobserved.

Stable visual captures require two consecutive identical PNG captures. Locale
`en-US`, timezone UTC, light color scheme, scale 1, reduced motion and browser
version are controlled. Baselines bind the target, path, viewport, masks,
platform, browser and capture policy. Keep the execution environment consistent;
a changed environment requires its own reviewed baseline. The pixel comparator
uses Pixelmatch's 0.1 per-pixel threshold and reports every differing pixel beyond
that threshold. It does not silently accept a percentage of changed pixels.

The read-only visual lane blocks cross-origin assets, non-GET/HEAD requests,
service workers and WebSockets. Apps that need these may render incompletely;
blocked requests are reported. Use an isolated test deployment. This lane does
not use the AI engine's fixture/attestation lifecycle and does not promote a
verified workflow bundle.

## AI E2E configuration

Create an [Arxic configuration](configuration.md) within the project folder and
choose its relative or absolute path in Project settings. Commit it (or keep it
properly excluded from the source snapshot) before a provenance-dependent run.
Use `source.revision: HEAD` or the intended existing commit. Its resolved
`source.repository` and `target.origin` must match the dashboard project. Relative
source paths resolve from the project folder. The web action snapshots validated
configuration; it does not edit the project for you.

The existing [model/agent environment](cli-reference.md), fixture credentials,
target attestation, Docker/Mailpit prerequisites and replay policies still apply.
Set model/fixture secrets on the server process; they are not entered into the
browser form. Each job reuses the existing local executor with a 30-minute outer
deadline. Only the deterministic verifier may return `verified`.

Missing models, invalid configuration, mismatched source/target, fixture failure
or failed policy gates produce blocked results with diagnostics. Agent tools
inherit the operator's configured permissions. The dashboard token is removed
from child environments. This initial workbench is for trusted projects and
operators, not for running hostile user submissions or isolating tenants.

## Schedules and history

Project settings accept five-field cron in **UTC**, for example `0 9 * * *`
(daily at 09:00 UTC) or `0 9 * * 1` (Mondays). Pick discovery, visual or AI E2E
and uncheck **Pause scheduled runs** to enable it. The server must remain running.

Runs serialize through a persistent queue, capped at 20 active/queued jobs.
Source and visual jobs have a five-minute deadline; AI jobs have 30 minutes.
Repeated scheduler ticks cannot enqueue the same due slot twice. After downtime,
missed slots coalesce into one run, then the next future slot is scheduled.
Interrupted running jobs become blocked at restart; queued jobs resume. There is
no automatic retry of potentially mutating workflows.

The dashboard displays the latest 200 runs; full records remain in SQLite and
can be retrieved by ID through the authenticated run endpoint. The application
does not yet implement automatic retention or a disk quota. Monitor storage.
An administrator can cancel active jobs and delete terminal run artifacts;
approved baselines are protected from deletion. Back up the stopped instance's
entire state directory (including SQLite WAL/SHM if present), not just PNG files.

## Server deployment

Install the same checkout and dependencies on a dedicated host under a service
account, with project folders mounted and readable there. On Linux, install
Chromium system dependencies with the documented Playwright setup for your OS.
Use a service manager to keep `pnpm web` running and provide:

| Variable                  | Purpose                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `ARXIC_ADMIN_TOKEN`       | Required; at least 32 characters. Random secret recommended.       |
| `ARXIC_WEB_ROOTS`         | JSON array of allowed server-side project roots.                   |
| `ARXIC_WEB_STATE_DIR`     | Persistent private state directory; default `~/.arxic/web`.        |
| `ARXIC_WEB_PORT`          | Listener port; default `4310`.                                     |
| `ARXIC_WEB_HOST`          | Default `127.0.0.1`; remote binding requires HTTPS public origin.  |
| `ARXIC_WEB_PUBLIC_ORIGIN` | Exact externally served origin, e.g. `https://arxic.example.test`. |

Put a TLS reverse proxy in front of the listener. Preserve the public `Host`
header and browser `Origin` header. The public origin must contain no path,
credentials, query or fragment. Block direct public access to the HTTP backend.
TLS is terminated by your proxy; the Node listener does not provide TLS itself.
No CORS wildcard or proxy-header-derived authentication is enabled.

Sessions last eight hours, use HTTP-only/SameSite=Strict cookies and gain Secure
on HTTPS. Writes require same-origin JSON. Login attempts are rate limited.
Authentication changes discard stale dashboard responses: old anonymous errors cannot hide a new session, and late authenticated data cannot reopen a signed-out workspace. Restarting the server clears sessions. To rotate access, change the configured
token and restart. The admin UI exposes roots and audit history, not the token.

## Evidence and release status

Images have adjacent privacy provenance. Action timelines carry adjacent
sanitization provenance and include no raw DOM/network payloads. Neither the
visual lane nor its UI tests retain raw trace ZIPs. Engine jobs retain only the
existing managed sanitized evidence. Artifacts require an authenticated session;
there is no public share URL.

Inspect retained pixels before exporting/sharing. The standing human screenshot
inspection still applies before tagging or publishing a release. This workbench
does not implement semantic AI image review, comprehensive authenticated visual
state campaigns, multi-user roles, automatic project startup or notifications.
Those remain explicit requirements in [#402](https://github.com/anthonykewl20/arxic/issues/402).
