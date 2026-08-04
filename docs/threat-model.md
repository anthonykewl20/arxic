# Arxic Worker Threat Model

## Status and scope

This document defines the M0 security boundary for executing Arxic against an
untrusted source repository and an untrusted application target. It turns ADR
§16 into concrete controls for the worker, target-attestation preflight, model
boundary, browser actions, and evidence handling.

The protected assets are host integrity, container infrastructure, source and
fixture confidentiality, credentials and personal data, target integrity,
decision provenance, and the trustworthiness of emitted evidence. The trusted
computing base is deliberately small: the configured control plane, static
policy, attestation verifier, sandbox launcher, deterministic validators, and
artifact gate. Repository files, application responses, browser content,
emails, model responses, generated plans, and generated code are untrusted.

The attacker may control repository bytes, package scripts, web pages,
redirects, network responses, accessibility content, fixture messages, and
text sent back by a model. The attacker may try to escape a worker, redirect a
run to production, induce unsafe actions, obtain secrets, control the container
daemon, exhaust resources, or forge evidence. Availability of the target
itself is not guaranteed. Arxic fails closed and records `blocked` diagnostics
when a required safety precondition cannot be established.

This M0 model specifies controls. M1 issue #26 validates live worker and
Testcontainers enforcement. A control that is specified here but not yet
enforced by that worker remains an implementation requirement, not an implied
security claim.

## Trust boundaries and data flow

1. A trusted operator supplies pinned source, a target origin, static policy,
   fixture references, and any recorded human approvals.
2. The trusted control plane validates policy and fetches the target's explicit
   attestation before creating an untrusted worker.
3. The control plane mounts source read-only and creates run-scoped writable
   directories for temporary state and artifacts.
4. The worker parses source and drives a browser under fixed origin, action,
   egress, filesystem, process, time, and resource constraints.
5. Models receive bounded, redacted evidence neighborhoods. Their output is
   validated data and cannot modify policy or approvals.
6. Deterministic gates validate evidence, diagnostics, artifacts, hashes, and
   dispositions before anything can be promoted.
7. Cleanup revokes leases, removes writable state, terminates descendants, and
   destroys the worker independently of run success.

## Threat-to-control map

| Threat                                               | Boundary and consequence                         | Required mitigation                                                                                 | Reference        |
| ---------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------- |
| Malicious repository executes on the host            | Worker/host; host takeover                       | Ephemeral non-root sandbox, no host shell, read-only source, scoped writes                          | ADR §16.1, §24   |
| Cross-run source or artifact access                  | Run/run; confidentiality and evidence corruption | One worker and writable namespace per run; no shared mutable workspace; deterministic cleanup       | ADR §16.1        |
| Package or browser process exhausts resources        | Worker/host; denial of service                   | CPU, memory, process, file, browser-frontier, and wall-clock quotas with bounded termination        | ADR §16.1, §21   |
| Worker reaches arbitrary external services           | Worker/network; data loss or unsafe mutation     | Default-deny egress, explicit target and fixture allowlists, redirect revalidation                  | ADR §16.1, §16.4 |
| Worker controls Docker or another container daemon   | Worker/control plane; host-equivalent compromise | Daemon access remains only in trusted control plane; no socket, endpoint, or CLI in worker          | ADR §16.1        |
| Target claims to be test while routing to production | Target/preflight; production mutation            | Exact origin checks, environment class, nonce or signed build receipt, production-looking heuristic | ADR §16.2        |
| Model or content overrides safety policy             | Content/model; unsafe action or exfiltration     | Content-is-data, immutable policy, fixed scope, tool allowlist, structured-output validation        | ADR §16.3, §24   |
| Redirect or generated URL escapes origin             | Browser/network; external side effect            | Exact attested origin and per-request origin enforcement; deny unapproved redirects                 | ADR §16.2, §16.3 |
| Read-only discovery triggers mutation                | Browser/application; corrupted fixture           | Action classification before execution; reversible writes require a lease                           | ADR §16.4        |
| External or destructive action runs autonomously     | Browser/application; irreversible harm           | Dedicated policy and recorded human approval; default refusal                                       | ADR §16.4        |
| Secret enters model prompt or evidence               | Secret/model/artifact; disclosure                | Opaque references, last-boundary injection, field-aware redaction, non-production sinks             | ADR §16.5, §24   |
| PII appears in logs, traces, or network bodies       | Runtime/artifact; privacy breach                 | Synthetic fixture identities, redaction before persistence, bounded artifact retention              | ADR §16.5        |
| Attestation or decision is not auditable             | Preflight/control plane; unsafe ambiguity        | Always emit decision record with policy version, timestamp, disposition, reason, and override       | ADR §16.2, §20.1 |
| Cleanup fails after timeout or crash                 | Worker/host; leaked state and processes          | Supervisor-owned kill and teardown, lease expiry, idempotent cleanup, leak detection                | ADR §16.1, §24   |

## Worker isolation

Every run receives a fresh worker identity and namespace. The worker runs as a
non-root user without privilege escalation, host namespaces, broad devices, or
ambient credentials. The source checkout is pinned before entry and mounted
read-only. Generated plans, browser state, reports, screenshots, and traces are
written only below explicit run-scoped paths. The worker cannot rewrite source,
the control-plane policy, approvals, or previously promoted bundles.

The network starts closed. The control plane opens only the attested target and
explicit fixture endpoints needed by the run. DNS answers and redirects do not
expand authority: every destination is rechecked against the origin policy.
Loopback inside a worker refers to that worker, not implicit host access. Proxy
configuration, if used, is injected by the trusted launcher and unavailable for
application-controlled mutation.

Quotas cover CPU, memory, child processes, open files, writable bytes, artifact
bytes, browser contexts, frontier size and depth, and elapsed time. Crossing a
quota terminates the active work and records `blocked`; it never relaxes a
limit, drops an assertion, or promotes partial output. The supervisor owns the
worker process tree so hostile descendants cannot outlive the run.

Cleanup is deterministic and runs for success, refusal, timeout, cancellation,
and crash. It closes browser contexts, revokes fixture leases, terminates the
process tree, removes run-scoped writable volumes, and records cleanup failure.
Reusable caches are content-addressed, immutable to the worker, and contain no
credentials or mutable browser profiles.

## Docker socket and Testcontainers isolation

The container daemon is a control-plane capability, not a worker capability.
A trusted control-plane process may use Testcontainers to create disposable
databases, mail sinks, or application dependencies. It passes the worker only
the minimum endpoint and scoped fixture reference needed to use a provisioned
service. Lifecycle ownership, image selection, port publication, network
attachment, logs, and teardown remain in the trusted process.

The untrusted application/browser worker never receives `/var/run/docker.sock`
or another daemon socket as a mount. It receives no `DOCKER_HOST`,
`DOCKER_CONTEXT`, daemon TLS material, or equivalent endpoint. Its sandbox image
contains no Docker CLI or container-management client. Egress policy denies
container API ports and host control-plane endpoints. A repository cannot ask a
model or browser tool to start, inspect, mount, exec in, or reconfigure a
container.

This separation matters because daemon control is commonly host-equivalent: a
worker with socket access could mount host files, create privileged containers,
join other networks, and defeat every filesystem and egress control above.
Socket filtering inside the worker is not accepted as the primary boundary.
The socket is absent, daemon addressing is absent, and control remains outside
the untrusted namespace.

Local development may degrade to trusted host-level services started by the
developer. The fixture apps' existing Mailpit `docker-compose` service is the
accepted example. The worker receives only Mailpit's test endpoint under an
explicit allowlist; it still receives no daemon access. Host services must use
test data, bind narrowly, and be cleaned up by the developer or test harness.
This mode is not evidence that worker/container isolation is enforced.

Live Testcontainers orchestration and the absence of daemon control in the
actual application/browser worker are validated in M1 #26. That test must
inspect the real worker environment and mounts, prove allowed dependency use,
prove daemon access is unavailable, and prove teardown after success and
failure.

## Prompt-injection defense

Repository comments, filenames, documentation, page text, accessibility trees,
HTTP responses, email bodies, and model responses are content. They are never
instructions to the control plane. Text such as "ignore the origin policy" or
"run this command" cannot alter scope, tools, action class, approvals, egress,
or evidence requirements.

Each model call has a fixed task and receives the smallest redacted evidence
neighborhood needed for it. The model has no shell, broad filesystem access,
container API, credential store, policy writer, or approval writer. Tool calls
are selected from a narrow allowlist with typed arguments. Origin and action
checks execute outside the model before every runtime operation.

Model output must parse against a bounded structured schema. Unknown fields,
unknown tools, malformed origins, unsupported actions, and attempts to embed
executable policy are rejected. A valid model response can create only a
`hypothesized` candidate. Deterministic runtime and contract gates own later
truth-state transitions; a model cannot assign `verified` or create a human
approval.

## Origin and action boundaries

Target attestation is stage zero. The request origin must exactly equal the
attested origin, occur in the target's own `allowedOrigins`, and occur in static
policy. The environment class must be allowed. Production-named environments
and public hostnames outside loopback, RFC1918, `.test`, `.example`, and
`.local` are production-looking and refused by default.

A nonce binds the handshake to configured test intent. Production deployment
uses an HMAC-SHA256 receipt over `<buildDigest>.<nonce>` with a separately held
key. A production-looking target can proceed only when static configuration has
a complete recorded human approval for the exact origin. The decision record
captures approver, approval time, and reason. No runtime model path can populate
that configuration.

Actions are classified before execution:

| Class                  | Examples                                                    | Default handling                                               |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `read-only`            | Navigate, inspect controls, read a test inbox               | Allowed only inside attested origins and budgets               |
| `reversible-mutation`  | Create or update leased fixture state                       | Requires isolated lease plus reset and release                 |
| `external-side-effect` | Send outside a captured sink, invoke third-party API        | Refused unless dedicated policy explicitly permits it          |
| `destructive`          | Delete data, change privileges, irreversible administration | Refused without recorded human approval and dedicated controls |

Reclassification is monotonic toward caution. Unknown actions take the more
restrictive class. A tool failure, missing lease, ambiguous target, redirect,
or absent approval resolves to `blocked`, not to an autonomous workaround.

## Secrets and PII

Policies and generated workflows carry opaque references rather than secret
values. The trusted fixture or secret boundary resolves a reference immediately
before the specific operation that needs it. Values are scoped to one run and
one purpose, are not returned to a model, and are revoked or expire at cleanup.

Redaction occurs before persistence or transmission, not as a later cosmetic
pass. It covers structured logs, exception causes, URLs and headers, request and
response bodies, browser traces, screenshots where feasible, network captures,
model prompts and responses, and diagnostic messages. Redaction itself is
recorded without preserving the removed value. Artifacts that cannot be safely
redacted are blocked from promotion.

Fixture identities are synthetic and all mail, OTP, webhook, payment, and
similar effects terminate in non-production sinks. No real customer account,
production tenant, personal inbox, payment rail, or analytics destination is a
valid fixture. Least-privilege test credentials are stored outside source and
never inherited broadly by worker children.

## Verification obligations

M0 tests exercise the pure policy seam, frozen diagnostic contract, real HTTP
fetch, both canonical fixture attestation endpoints, default production refusal,
and recorded-approval behavior. These outcomes are deterministic policy
observations and blocked/allowed dispositions; they do not claim the future
worker itself is verified.

M1 #26 must provide real-environment evidence for non-root execution, read-only
source, scoped writes, egress denial, quotas, process-tree cleanup, cross-run
isolation, Testcontainers control-plane ownership, and absent daemon access.
Later verifier and artifact slices must prove redaction and action enforcement
against actual traces and network records. Any failed obligation remains
explicitly blocked and cannot be replaced with model confidence.
