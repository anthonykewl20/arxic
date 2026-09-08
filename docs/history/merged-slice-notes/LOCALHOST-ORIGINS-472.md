# LOCALHOST-ORIGINS-472 — staged doc updates (charter §10.2)

Issue: #472 · PR: #<PR> · Disposition: verified

## 1. `docs/SYNC.md` — tracker row (replace the existing row verbatim)

```
| #472 | [LOCALHOST-ORIGINS-472] *.localhost origins are misclassified production-looking; local reverse-proxy stacks cannot be targeted | ☑ done — `classifyTarget` treats `.localhost`-suffixed hostnames (RFC 6761 §6.3, the Traefik/dokploy `<name>.localhost` convention) as loopback-safe; red-first unit pins + a real `*.localhost` origin accepted through the real handshake |
```

## 2. `docs/SYNC.md` — session-log row (append to the table)

```
| 2026-09-09 | **#472 (LOCALHOST-ORIGINS-472) *.localhost target origins unblocked DONE.** `classifyTarget` (`packages/environment/src/attestation.ts`) adds `localhost` to the reserved-suffix alternation, so any hostname ending `.localhost` — RFC 6761 §6.3, the standard reverse-proxy local-stack convention that blocked the owner's live Mightybox campaign — is loopback-safe instead of production-looking; `localhost.evil.com` / `evil-localhost.com` stay production-looking (anchored suffix). Proven red-first: unit pins (`mightybox.localhost:8080`, `foo.bar.localhost:3000`, `stack.localhost` not production-looking; two negative pins) were red on main, and a real journey — real Node server on an ephemeral loopback port serving a valid `local-test` attestation for `http://stack.localhost:<port>`, fetched through the real resolver — was refused before the fix and is accepted after (`runPreflightAttestation` → allowed). CI's test shards pin the RFC 6761 probe host in /etc/hosts (runner resolvers are not guaranteed to synthesize `*.localhost`); the dev-host run additionally exercised real resolver synthesis. No matcher widened, no assertion loosened; every pre-existing classification pin is byte-identical. Next: #473 attestation-redirect hint, #474 placeholder secrecy sweep. |
```

## 3. `CHANGELOG.md` — entry under `## [Unreleased]` → `### <added|changed|fixed|security|internal>`

```
### Fixed

- LOCALHOST-ORIGINS-472 `*.localhost` target origins unblocked (#472): target-attestation classification treats hostnames ending `.localhost` (RFC 6761 §6.3 — the Traefik/dokploy reverse-proxy local-stack convention) as loopback-safe instead of production-looking, so a valid `local-test` attestation served on `<name>.localhost` passes the handshake; public hostnames merely containing `localhost` (`localhost.evil.com`) stay refused. Red-first unit pins plus a real `*.localhost` origin accepted through the real fetch/verify path.
```

## 4. `VERSION` bump required?

no (integrator folds; user-observable fix — candidate patch +1 at fold time per the #448 precedent, integrator's call)

## 5. Evidence pointers

- Real-world proof: `packages/environment/src/__tests__/localhost-origins.real-world.test.ts` — a real Node HTTP server on an ephemeral loopback port served a valid `local-test` attestation for `http://stack.localhost:<port>`; the real `runPreflightAttestation` fetch (real resolver → loopback) refused it on main (red, retained) and accepts it after the fix. The journey asserts up front that the resolver maps `*.localhost` to loopback only, so a non-synthesizing resolver fails with an explicit environment message instead of an unrelated network error.
- Unit pins: `packages/environment/src/__tests__/contract-gate.test.ts` — new `it` block (no existing assertion edited): `mightybox.localhost:8080`, `foo.bar.localhost:3000`, `stack.localhost` → not production-looking; `localhost.evil.com`, `evil-localhost.com` → production-looking `['public-hostname']`.
- Artifacts: `docs/evidence/LOCALHOST-ORIGINS-472/red.txt` (both lanes failing on main), `green.txt` (9/9 after the one-line alternation change).
- Gates: typecheck ☑ (root + `typecheck:packages`) · lint ☑ · format ☑ (full repo, `All matched files use Prettier code style!`) · test ☑ (packages/environment 102/102) · license gate — CI `package` job on the PR.

## 6. Sad paths proved (each mapped to a truth state, charter §4)

| Trigger                                                   | Expected disposition                                                                                                  | Test                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `https://localhost.evil.com` attestation target           | refused — `public-hostname` (suffix is end-anchored; a public domain containing `localhost` is not loopback)          | `contract-gate.test.ts` negative pin                    |
| `https://evil-localhost.com` attestation target           | refused — `public-hostname` (substring `localhost` is not a suffix)                                                   | `contract-gate.test.ts` negative pin                    |
| resolver maps `stack.localhost` to a non-loopback address | journey fails loudly with the explicit resolver-capability message (environment property, not a silent network error) | `localhost-origins.real-world.test.ts` `beforeAll`      |
| malformed origin (`not-a-web-origin`) with human approval | refused (pre-existing, untouched)                                                                                     | `contract-gate.test.ts`                                 |
| production environment class / production stub origin     | refused (pre-existing, untouched)                                                                                     | `contract-gate.test.ts`, `preflight-real-world.test.ts` |
