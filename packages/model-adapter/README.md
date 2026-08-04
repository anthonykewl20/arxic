# @arxic/model-adapter

## Overview

M0-13 provides a source-only OpenAI-compatible structured-output adapter. It sends schema-bound requests, validates returned data with real AJV, records metadata without prompts, and fails closed with stable blocked diagnostics.

## Public API

`new ModelAdapter({ credentials: string | (() => string), baseUrl: string, timeoutMs?: number, canaries?: string[], providerMeta?: { retention?: string; region?: string; sourceSharing?: string }, now?: () => string })` creates an adapter. Credential resolvers may also return a promise.

`requestStructuredOutput({ model, messages, schema: object, schemaVersion: string, maxRetries?: number })` returns `{ ok: true, output, runRecord } | { ok: false, diagnostics, runRecord }` and never throws.

The default `maxRetries` is 2, meaning one initial request plus two retries. Invalid JSON, AJV-invalid output, or schema-version drift appends a system note that the prior output was invalid before each retry. Provider failures and provider timeouts are not retried. The client distinguishes `ARXIC-MODEL-PROVIDER-TIMEOUT` from `ARXIC-MODEL-PROVIDER-ERROR` and never throws.

## Run record

The run record is flat and contains `requestId`, `schemaVersion`, deterministic `schemaSha256`, `model`, `tokens`, optional `cost`, optional `retention`, optional `region`, optional `sourceSharing`, and `timestamp`. It has no provider nesting and no `completedAt`. The schema hash is SHA-256 over recursively key-sorted canonical JSON. The adapter never sets `cost`.

## Content as data

Model output is untrusted data. The adapter owns no policy, allowlist, or action-class state and never interprets output as instructions. Credentials, complete input-message bytes, and optional additional canaries enforce the redaction boundary without promoting or mutating policy. Instruction-like content that does not reproduce protected prompt bytes remains inert data.

## Stable diagnostics

- `ARXIC-MODEL-STRUCTURED-OUTPUT-INVALID`
- `ARXIC-MODEL-SCHEMA-VERSION-DRIFT`
- `ARXIC-MODEL-RETRIES-EXHAUSTED`
- `ARXIC-MODEL-CREDENTIAL-LEAK-DETECTED`
- `ARXIC-MODEL-PROVIDER-ERROR`
- `ARXIC-MODEL-PROVIDER-TIMEOUT`

`MODEL_DIAGNOSTIC_CODES` contains exactly these values. Every manufactured diagnostic is validated through `validateDiagnostic` before use.

## Redaction

`redactAndSerialize` emits canonical sorted-key JSON for a run record. `redactionGate` checks the record, output, and diagnostic messages against credential and prompt canaries. A leak blocks with `ARXIC-MODEL-CREDENTIAL-LEAK-DETECTED`; emitted blocked run records are sanitized so they contain no canary.

## Layering

`client.ts` is the provider wire service. `validator.ts` is the real-AJV schema service. `run-record.ts` is the metadata-only observability, deterministic schema-hash, and redaction service. `adapter.ts` orchestrates retries, fail-closed handling, and the credential-plus-canary boundary. `diagnostics.ts` owns stable diagnostic manufacturing and loop-close validation.

This spike does not modify the frozen `@arxic/contracts` capability boundary. The truth-state and no-promotion decision stays in orchestration for M1 #42.
