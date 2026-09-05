# @arxic/model-adapter

## Overview

M0-13 provides a source-only OpenAI-compatible structured-output adapter. It sends schema-bound requests, validates returned data with real AJV, records metadata without prompts, and fails closed with stable blocked diagnostics.

## Public API

`new ModelAdapter({ credentials: string | (() => string), baseUrl: string, timeoutMs?: number, canaries?: string[], providerMeta?: { retention?: string; region?: string; sourceSharing?: string }, now?: () => string })` creates an adapter. Credential resolvers may also return a promise.

`requestStructuredOutput({ model, messages, schema: object, schemaVersion: string, maxRetries?: number, images?: readonly ModelImage[] })` returns `{ ok: true, output, runRecord } | { ok: false, diagnostics, runRecord }` and never throws.

The default `maxRetries` is 2, meaning one initial request plus two retries. Invalid JSON, AJV-invalid output, or schema-version drift appends a system note that the prior output was invalid before each retry. Provider failures and provider timeouts are not retried. The client distinguishes `ARXIC-MODEL-PROVIDER-TIMEOUT` from `ARXIC-MODEL-PROVIDER-ERROR` and never throws.

## Host CLI transport

`createHostCliTransport` sends the prompt through stdin to a configured local
executable and parses structured JSON from stdout. It preserves UTF-8 across
pipe chunk boundaries, caps output at 8 MiB, handles early stdin closure, and
bounds provider execution with process cleanup. Provider stderr is drained and
never copied into diagnostics. Host CLI token counts are recorded as zero because
this transport has no provider usage receipt; that is not proof of zero cost.

## Image evidence

Callers may supply 1–4 `{mediaType: 'image/png', bytes: Uint8Array, sha256}` images.
The adapter copies and validates them before asynchronous credential resolution:
4 MiB per PNG, 8 MiB combined, dimensions at most 4096 per side and 4,194,304
pixels per image. It reuses the canonical PNG inspector (CRC, chunk structure,
bounded decompression, no metadata or trailing payloads). Invalid evidence blocks
before provider contact with `ARXIC-MODEL-IMAGE-INVALID`.

The wire format follows the official [image guide](https://developers.openai.com/api/docs/guides/images-vision). HTTP requests append one user message with ordered OpenAI-compatible `image_url`
content parts, inline PNG data URLs and `detail: high`. Host CLI image requests
require `imageArgs`, a string array containing a separate literal `{image}`
argument. The array is repeated for each image; each placeholder becomes a
private temporary PNG path. Files use mode 0600 inside a 0700 temporary directory
and are removed after completion, failure or timeout. Missing capability blocks
without spawning. Returned temporary paths and whole-image base64 echoes block.
Text-only requests preserve their existing wire shape and records. Supervising
jobs may supply a private `imageDirectory` and `inheritProcessGroup`; the
supervisor then owns group termination and cleanup after interruption. The web
supervisor uses this to prevent orphan providers and attachments on cancellation.

This capability does not authorize screenshot transmission or prove arbitrary
pixels secret-free. Application actions must own consent, masking, permitted
states and output grounding. Model findings remain hypotheses; this adapter does
not promote truth states. Actual host model selection remains operator-configured.

## Run record

The run record is flat and contains `requestId`, `schemaVersion`, deterministic `schemaSha256`, `model`, `tokens`, optional `cost`, optional `retention`, optional `region`, optional `sourceSharing`, and `timestamp`. Image requests also record ordered `images` metadata (media type, SHA-256, byte count, width and height); image bytes and temporary paths are excluded. It has no provider nesting and no `completedAt`. The schema hash is SHA-256 over recursively key-sorted canonical JSON. The adapter never sets `cost`.

## Content as data

Model output is untrusted data. The adapter owns no policy, allowlist, or action-class state and never interprets output as instructions. Credentials, complete input-message bytes, and optional additional canaries enforce the redaction boundary without promoting or mutating policy. Instruction-like content that does not reproduce protected prompt bytes remains inert data.

## Stable diagnostics

- `ARXIC-MODEL-STRUCTURED-OUTPUT-INVALID`
- `ARXIC-MODEL-SCHEMA-VERSION-DRIFT`
- `ARXIC-MODEL-RETRIES-EXHAUSTED`
- `ARXIC-MODEL-CREDENTIAL-LEAK-DETECTED`
- `ARXIC-MODEL-PROVIDER-ERROR`
- `ARXIC-MODEL-PROVIDER-TIMEOUT`
- `ARXIC-MODEL-IMAGE-INVALID`

`MODEL_DIAGNOSTIC_CODES` contains exactly these values. Every manufactured diagnostic is validated through `validateDiagnostic` before use.

## Redaction

`canonicalizeRecord` emits canonical sorted-key JSON for a run record. `redactionGate` checks the record, optional output, and diagnostic messages against credential and prompt canaries. `sanitizeRunRecord` redacts canaries. A leak blocks with `ARXIC-MODEL-CREDENTIAL-LEAK-DETECTED`, and the blocked run record is sanitized. Every provider-derived emission path, including success, retries exhausted, schema-version drift, AJV-invalid output, and provider error or timeout after a prior response, runs the redaction gate before emitting.

## Layering

`client.ts` is the provider wire service. `validator.ts` is the real-AJV schema service. `run-record.ts` is the metadata-only observability, deterministic schema-hash, and redaction service. `adapter.ts` orchestrates retries, fail-closed handling, and the credential-plus-canary boundary. `diagnostics.ts` owns stable diagnostic manufacturing and loop-close validation.

This spike does not modify the frozen `@arxic/contracts` capability boundary. The truth-state and no-promotion decision stays in orchestration for M1 #42.
