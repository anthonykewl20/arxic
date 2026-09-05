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
configuration references and feature-flag member expressions. Markdown/text headings and
requirement language outside fenced code are declarations, not independently
accepted business rules. EJS, HTML, Vue, Svelte and MDX component syntax are
explicitly unsupported; arbitrary aliases, generated markup and hidden
requirements cannot be recovered completely. Conditions and declarations may also
come from server/test code; component-to-runtime reachability is not proven.
Environment variables are configuration references, not proven feature flags. Limits are 1 MiB per file, 5,000
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

## Provider connections and model IDs

Model IDs are provider-agnostic. The dashboard does not prescribe a GPT model or
translate an ID into a different model. **Model provider** selects an operator-owned
connection; **Model name** offers a catalog fetched from that provider and
accepts a custom ID. Screenshot review uses the same controls. Changing provider
clears the model field so an old provider's ID is not selected accidentally.
Catalogs have no built-in model IDs. A server-default HTTP connection configured
with `ARXIC_MODEL_BASE_URL` also supports discovery and appears in Models & accounts;
its configured API key is used only on the server. Without a default HTTP endpoint,
or with an opaque host/gateway default, choose a named provider for discovery.
Custom IDs remain available. Refresh explicitly or use the five-minute
automatic refresh while the connection is in use. Failures show the last successful
fetch time and leave stale models visibly identified. The **Models & accounts**
screen uses React and shadcn/ui, with setup guidance and searchable catalogs.
The navigation shell, overview, intent inventory, workflow selection, campaign history/details, schedules and administration
also use React/shadcn, with compact neutral styling and an expandable mobile menu.
Escape closes that menu and returns focus to its toggle. Intent-ledger rows display
their recorded line-anchored source references. New discoveries reset old workflow
selections; mobile source rows stack their evidence fields. Run details, capture
comparisons, image review and model fields also use React/shadcn. Review settings
stay disabled during submission even after navigation. Campaign selections use the
same pending guard. Logout and invalidated sessions clear unsent drafts and image
consent; late responses cannot redirect a newly authenticated workspace.
Project filtering hides details belonging to another project. The project form
retains native dialog behavior and shared API actions.

Set `ARXIC_MODEL_CONNECTIONS` to a JSON array before starting the server. For example:

```json
[
  {
    "id": "team-gateway",
    "label": "Team model gateway",
    "transport": "http",
    "baseUrl": "https://models.example.test/v1",
    "credentialRef": "ARXIC_SECRET_TEAM_MODEL",
    "models": [
      {
        "id": "vendor/model-id",
        "prices": { "promptPerMillion": 1, "completionPerMillion": 3 }
      }
    ]
  },
  {
    "id": "coding-agent",
    "label": "Local coding agent",
    "transport": "host-cli",
    "command": "/opt/arxic/agent-wrapper",
    "args": ["run"],
    "modelArgs": ["--model", "{model}"],
    "imageArgs": ["--image", "{image}"],
    "models": [{ "id": "provider/model-id" }]
  }
]
```

Replace the illustrative endpoint, IDs, rates and command with your installed
provider's values. Rates are USD per million input/output tokens, supplied by the
operator, not current price quotes. The `models` configuration is a rate table,
not a list of available models. HTTP profiles can use explicit per-model `prices`,
provider-advertised catalog prices (when present), or explicit `customModelPrices`
with the same keys. Missing rates block before inference. Subscription profiles
record subscription billing rather than estimating a per-token API charge. Local APIs still
use the existing bearer-credential contract; configure their accepted credential.
Host-agent costs remain operator-managed and are not inferred from zero token counts.

The HTTP transport requires the existing compatible chat-completions structured
output protocol (plus image content parts for review). This is not native support
for every vendor's API. The host transport accepts any installed wrapper that
reads the prompt on stdin and writes the JSON result on stdout. `modelArgs` is
required for named host profiles: the separate literal `{model}` becomes the exact
chosen ID, with no shell evaluation. Optional `imageArgs` similarly uses `{image}`.
The provider can still reject an unavailable model; suggestions do not establish
account access, image capability or semantic quality.

Only profile ID, label, transport, billing classification, model IDs and catalog
status reach the dashboard, alongside public provider setup instructions.
Endpoints, executable arguments and credential bindings remain operator-side;
keys never enter project/run JSON. Jobs resolve only their selected connection,
clear inherited settings from other connections and pass only selected secrets.
Unknown/deleted profiles block; they never fall back to a different provider.

**Server default** preserves the existing `ARXIC_MODEL_*` configuration. For its
HTTP custom IDs, `ARXIC_MODEL_PRICES` can supply the same two numeric rate keys.
For its host CLI, configure `ARXIC_MODEL_HOST_CLI_MODEL_ARGS` as a JSON array such
as `["--model", "{model}"]`. Without it, the dashboard explicitly says the legacy
agent chooses its own model; the field alone cannot establish model selection.
File-configured jobs continue to use the server default connection.

## AI E2E configuration

In Project settings, enable **Configure AI execution in this dashboard**. Enter
a provider connection, an installed/available model ID, frameworks and domain declarations.
Model suggestions come from the selected connection; custom IDs remain editable. Set the
planning estimate, runtime/crawl limits and persona strategy. No configuration
file is needed for this path; the dashboard snapshots validated engine
configuration inside the run directory without editing the project.

- **Anonymous** clears inherited persona credentials for this job.
- **Test app seed API** uses the existing attested fixture/reset lifecycle.
- **Existing test account login** uses the engine's per-pass login declaration;
  configure the relative login path and accessible field/button labels under
  **Login and deployment declarations**.

Authenticated modes require email and password **reference names**, such as
`ARXIC_SECRET_TEST_EMAIL` and `ARXIC_SECRET_TEST_PASSWORD`. Set their values in
the server's environment or secret manager before starting Arxic. The optional
model reference binds a selected `ARXIC_SECRET_...` value to that job's model
credential; blank uses the selected connection's credential (or the existing
server credential for **Server default**). Raw credential
values and references to `ARXIC_ADMIN_TOKEN` are rejected. Only names are stored
in project/run settings. Missing selected secrets block execution before launch.
The guided child receives selected values in the engine's standard credential
variables; the generic `ARXIC_SECRET_...` environment is removed from that child.

The existing [model/agent connection](cli-reference.md), target attestation,
Docker/Mailpit prerequisites and replay policies still apply. The model's name
is selected in the form; the server operator configures the HTTP endpoint or
host agent executable. Guided settings do not expose arbitrary shell commands.
Domain declarations enable matching seeders and do not restrict route discovery.
Framework support is checked by the engine. Feature flags describe the actual
deployment; they do not toggle the app. Planning budgets are engine estimates,
not hard billing limits, especially when host agents do not report costs.
Runtime is capped at 1–30 minutes, crawl URLs at 1–500 and depth at 1–10.
Chromium, two verifier replays and the engine's fixed mutation/network policies
remain mandatory. Only the deterministic verifier may return `verified`.

Alternatively, choose an [Arxic configuration](configuration.md) file inside
the project folder with guided settings disabled. Commit it (or keep it properly
excluded from the source snapshot) before provenance-dependent execution. Its
resolved `source.repository` and `target.origin` must match the dashboard project;
relative source paths resolve from that folder. File-based jobs retain the
existing server model/fixture environment and a 30-minute outer deadline. A
file may set `scope.inventoryRowIds` to select current source consumer rows;
see the [scope reference](configuration.md#scope). This is a single-candidate
execution control; the guided campaign interface below creates a separate run
for each selected row.

### On-demand workflow campaigns

Save guided AI settings, run **Discover intents**, then open **Intent inventory**.
**Select workflows** lists the complete discovered source-surface denominator,
50 rows per page. Choose 1–20 eligible rows and start the selected campaign.
Selection survives polling and pagination. Rows without usable source evidence
show their disposition/reason and cannot become proposal inputs. Existing discovery
records from before campaign support must be refreshed once to expose choices.

Each selected row creates one serialized engine job with its own two verifier
replays, saved project/persona settings and immutable selected-row/source-commit
binding. The queue reserves all required slots in one database transaction; if
capacity is insufficient, it inserts no partial campaign. Missing discovery,
stale selection, missing guided settings, dirty source or a changed source commit
refuse launch. Commit source changes and discover again before retrying.

The **Campaigns** page shows selected, verified, contradicted, blocked, uncovered
and pending counts, plus unselected and non-proposable source rows. Uncompiled
hypotheses remain uncovered. Campaign management state is separate from workflow
truth: even a completed campaign does not certify every frontend behavior.
Each row links to its individual engine result. Campaign children link back to
the campaign instead of offering an unscoped “Run again”; start a new selected
campaign to repeat the intended scope. The complete campaign JSON and
referenced discovery preserve the denominator and evidence; a route can still
have untested states, personas and flags.

Campaigns are durable across restarts. Queued children continue; an interrupted
running child becomes blocked and is never automatically retried. Cancellation
marks all unfinished children before terminating an active process. Source is
checked again before each child launches. A changed tree blocks queued children;
completed evidence remains intact. Campaign creation and evidence deletion share one mutation queue, so a deletion
already in flight cannot erase a newly referenced discovery. Referenced discovery
and child records cannot be deleted through individual run deletion. Campaign removal/retention controls
remain pending.

The displayed total planning estimate is the selected-row count times the saved
per-run estimate cap. It is not a hard billing limit for host agents. Campaigns
currently run on demand with guided local execution. Existing cron schedules
still enqueue individual discovery, visual or AI runs; recurring campaign
selection and worker controls remain in #402.

Missing models, invalid configuration, mismatched source/target, fixture failure
or failed policy gates produce blocked results with diagnostics. Agent tools
inherit the operator's configured permissions. The dashboard token is removed
from child environments. This initial workbench is for trusted projects and
operators, not for running hostile user submissions or isolating tenants.

## AI review of an inspected screenshot

Open a stable checkpoint's full current capture, then expand **Ask AI to review
this screenshot**. Choose the model, optional `ARXIC_SECRET_` model credential
reference, budget estimate and an independent criterion from your specification.
Confirm that you inspected and authorize sharing these pixels, then select
**Review these pixels**. This authorizes one retained screenshot, not new states.

A durable review job checks PNG integrity and privacy provenance at enqueue and
execution. Source evidence remains protected while referenced. Review jobs require
explicit authorization and cannot be created through ordinary run/cron routes.

Findings remain **hypothesized**, with numbered proposed regions, exact screenshot,
source-run reproduction, independent criterion (or an explicit gap), a separate
AI-suggested check and model metadata. Out-of-image regions block the result.
Valid coordinates do not prove a defect. Empty findings do not establish a
defect-free page. Authenticated and broader state coverage remain under #402.

One request uses the selected provider connection with no automatic retry.
HTTP estimates use the configured price table and a 20,000 input / 4,000 output
token allowance, not a billing ceiling. Unknown prices block. Host usage remains
operator-managed; the executable needs explicit image attachment arguments
([configuration](configuration.md#host-bound-model-binding-host-bound-model)).
Configure the trusted host executable with tools disabled for this lane; Arxic
does not sandbox the provider executable. Review jobs inherit an owned process
group. Cancellation stops providers and removes private attachments; interrupted
attachments are cleaned at restart.

## Schedules and history

Dashboard timestamps, including **Next due**, explicitly display UTC in every browser timezone.
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
does not implement comprehensive authenticated visual state campaigns, multi-user roles, automatic project startup or notifications.
Those remain explicit requirements in [#402](https://github.com/anthonykewl20/arxic/issues/402).

[Clean source-install/recovery proof](evidence/WEB-402-INSTALL/summary.md) covers
Node 22.22.0, a fresh dependency/browser installation, real reference discovery
and pixels, session invalidation, and forced termination during browser navigation.
[Provider/model proof](evidence/WEB-402-MODELS/summary.md) covers the configured
connections and real installed-agent selection. These are scoped checks; the
remaining [full product requirements](web-product-spec.md) stay open.

## Subscription accounts and provider catalogs

Arxic never copies a native CLI's credential cache. Sign in as the operating-system
user running the Arxic server; each CLI owns its account login and token refresh.
Select the connection in project settings or screenshot review, then choose a
provider-returned model ID or enter a custom ID. Install current CLI versions that
support the flags below. An unavailable command or incompatible CLI blocks the
operation; Arxic does not switch accounts or models.

| Connection             | Setup on the server                                        | Discovery and execution                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Pro / Max       | `claude auth login`                                        | Native initialization metadata; account-authenticated Claude Code with tools disabled, no persistent session and prompts/images on stdin. API-key overrides are removed for this invocation. |
| Codex / ChatGPT        | `codex login --device-auth`                                | Native app-server `model/list`; account-authenticated ephemeral Codex execution with selected model, private cwd and tools disabled.                                                         |
| OpenCode accounts      | `opencode auth login`                                      | `opencode models --refresh --pure`; native provider adapters, denied tools and cleanup of created sessions.                                                                                  |
| OpenCode Go            | Connect the Go plan using `opencode auth login`            | Refreshed Go catalog; native adapter handles each model's protocol. Only IDs returned under the Go provider prefix are accepted for this connection.                                         |
| Kimi Coding membership | Set `ARXIC_SECRET_KIMI_CODING_KEY`                         | Kimi Coding `/coding/v1/models` and compatible completion endpoint. This is separate from Moonshot API billing.                                                                              |
| Grok / SuperGrok       | `openclaw models auth login --provider xai --method oauth` | Eligible accounts use OpenClaw's xAI OAuth route. Configure a dedicated gateway agent and set `ARXIC_SECRET_OPENCLAW_TOKEN`. The local CLI supplies its provider-owned catalog.              |
| OpenRouter API         | Set `ARXIC_SECRET_OPENROUTER_KEY`                          | Authenticated `/models` catalog, provider-advertised rates and compatible structured completions.                                                                                            |

Native command paths can be overridden with `ARXIC_CODEX_COMMAND`,
`ARXIC_CLAUDE_COMMAND`, `ARXIC_OPENCODE_COMMAND` and `ARXIC_OPENCLAW_COMMAND`.
Operator profiles in `ARXIC_MODEL_CONNECTIONS` override a built-in profile with the
same ID. A native profile can declare `catalogAgent` as `codex`, `claude`,
`opencode`, `opencode-go` or `openclaw`; arbitrary wrappers without such an adapter
show discovery unavailable and retain custom-ID entry. API discovery uses the
configured base URL plus `/models`, with bounded response size, no redirects and
an opaque failure message. A provider/CLI catalog is metadata, not proof of paid
account entitlement or image capability.

The built-in Grok gateway uses `http://127.0.0.1:18789/v1` and agent `arxic`.
Override its connection to change these. Enable the gateway's compatible HTTP
endpoint and configure that dedicated agent to deny internal tools. The request's
`tool_choice: none` controls client tool calls; it does not disable OpenClaw's
internal agent tools. The HTTP body targets `openclaw/<agentId>` and the
`x-openclaw-model` header carries the exact selected provider/model ID. The local
OpenClaw CLI catalog must correspond to that gateway installation.

Subscription runs record `billing: subscription` and zero incremental API-token
estimate. This is not a free-usage claim or enforcement of account quotas. Provider
plan limits, routing and overages remain controlled by the provider. Runtime limits
and Arxic's job cancellation remain active.

Provider references: [Claude account plans](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan),
[Codex authentication](https://learn.chatgpt.com/docs/auth),
[Kimi Coding membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html),
[OpenCode Go](https://opencode.ai/docs/go/),
[OpenClaw xAI](https://docs.openclaw.ai/providers/xai),
[OpenClaw HTTP routing](https://docs.openclaw.ai/gateway/openai-http-api).

Visual review treats magenta privacy masks as unavailable evidence and excludes
unsupported design preferences. These prompt constraints do not establish a
zero-false-positive detector; findings remain hypotheses requiring independent checks.

Built-in native bridges receive `jsonInput: true`: a JSON envelope containing the
prompt and output schema on stdin. Claude uses its native JSON-schema result
control; Codex receives a private temporary output-schema file. Existing host
wrappers keep text input unless explicitly configured. The final output still
passes Arxic schema validation, including field-length limits.
