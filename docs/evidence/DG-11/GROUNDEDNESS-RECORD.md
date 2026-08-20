# DG-11 groundedness grading record — delegated spot-check (issue #255, AC-7 / C-4)

This document records the completion of the groundedness spot-check for the two
recorded DG-11 validation runs (`directus-g3-run3`, `koel-g3-run1`) under owner
decision **5358819617** (amendment to C-4/AC-7, posted 2026-08-20, recorded
before measurement). It is the attribution and method home for the
`groundednessSpotCheck` blocks filled in the run records — the run-record
schema (`dg11-validation-run-v1`) is closed (validator
`closedKeys(spotCheck, ['status','sampledAt','numerator','denominator','verdicts'])`),
so grader attribution lives here and only here.

## Method disclosure (decision 5358819617 constraints)

- **Independence (constraint 1):** each target was graded by a fresh-context
  agent that did not author, propose, review, or edit any proposal, record, or
  config in this program. Graders: **`reviewer-deepseek` → directus**,
  **`codex-reviewer` → koel**. The proposals under grade were authored by the
  external model (`openai/gpt-4o-mini` via OpenRouter), not by any agent of
  this program.
- **Quote-bound verdicts (constraint 2):** every verdict cites the
  load-bearing line(s) at the cited clone file/line (read-only). Verdicts
  whose quote cannot be mechanically verified are INVALID → replaced with
  `VERDICT-VOID` (excluded from numerator and denominator). No replacements
  are invented.
- **Mechanical reconciliation by a third agent (constraint 3):** a separate
  agent (opencode orchestrator, glm-5.3) re-verified every quoted string
  against the clone at the ratified pin using fixed-string grep (`grep -nF`)
  at the cited line ±2. Clone pins asserted before verification:
  directus `cb846b6a1ddc4811359bc52b74bb31a42eab33db`,
  koel `dfec91ff290509c622ff7cf392fb5e506841ee2b` (both clean trees).
- **Owner supersession (constraint 4):** this delegated grading does not
  prejudice the owner's standing right — a later human grading of the same or
  a widened sample SUPERSEDES these agent results. `SPOT-CHECK-SHEET.md`
  retains its empty verdict columns in-repo for that purpose.
- **Accepted-risk disclosure (from the decision):** agent grading substitutes
  independent-machine judgment for independent-human judgment — a measured
  weakening of the original control, accepted by the owner's explicit
  completion directive, mitigated by the constraints above.

**Truth-state boundary:** this grading assigns **no ADR-001 truth state**.
`verified` remains exclusively the deterministic verifier's output; these
verdicts are `grounded`/`ungrounded` spot-check judgments only.

## directus — directus-g3-run3 (grader: reviewer-deepseek)

| #   | proposalId              | Verdict  | Grader note / quote                                                                 | Cited                                   | Verification (grep -nF, ±2)                              |
| --- | ----------------------- | -------- | ----------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| 1   | `prop:12a09cf6a26d1d83` | GROUNDED | `const runs = await runsService.readByQuery(query);`                                | `api/src/controllers/deployment.ts:431` | FOUND @431 (exact)                                       |
| 2   | `prop:3320b0fc6e75f77a` | GROUNDED | `const result = await fetchAccountabilityCollectionAccess(req.accountability, {`    | `api/src/controllers/permissions.ts:97` | FOUND @97 (exact)                                        |
| 3   | `prop:761a75ccacfc56e1` | GROUNDED | `await authService.login(providerName, extract.attributes, {`                       | `api/src/auth/drivers/saml.ts:199`      | FOUND @199 (exact)                                       |
| 4   | `prop:cee9ecb62c50255c` | GROUNDED | `await licenseManager.removeAddon(req.params['id']!);`                              | `api/src/controllers/license.ts:199`    | FOUND @199 (exact)                                       |
| 5   | `prop:fc378207cc988079` | GROUNDED | `payload = await list(query, options);`                                             | `api/src/controllers/extensions.ts:111` | FOUND @111 (exact) — see anomaly (a)                     |
| 6   | `prop:1eb176ca66b9b067` | GROUNDED | `app.get('/admin', sendHtml);`                                                      | `api/src/app.ts:305`                    | FOUND @305 (exact)                                       |
| 7   | `prop:86d1c8a89cd6ef0c` | GROUNDED | `router.get( '/callback',` (whitespace-collapsed across lines)                      | `api/src/auth/drivers/oauth2.ts:410`    | FOUND @410-411 (`router.get(` @410, `'/callback',` @411) |
| 8   | `prop:ac3f30f45f5c8d1d` | GROUNDED | `const data = await service.getDashboard(provider, sinceDate);`                     | `api/src/controllers/deployment.ts:284` | FOUND @284 (exact)                                       |
| 9   | `prop:3a327ed5bb537971` | GROUNDED | `await service.import(req.params['collection']!, mimetype, stream, {`               | `api/src/controllers/utils.ts:100`      | FOUND @100 (exact)                                       |
| 10  | `prop:dc3b566836a3bdcf` | GROUNDED | `await service.invite(req.body);`                                                   | `api/src/controllers/shares.ts:88`      | FOUND @88 (exact)                                        |
| 11  | `prop:149b9e9c54dfd9d1` | GROUNDED | `await service.requestPasswordReset(req.body.email, req.body.reset_url \|\| null);` | `api/src/controllers/auth.ts:214`       | FOUND @214 (exact)                                       |
| 12  | `prop:681baada304a2bff` | GROUNDED | `const id = await service.verifyRegistration(value);`                               | `api/src/controllers/users.ts:492`      | FOUND @492 (exact)                                       |
| 13  | `prop:fa0bc36cadad125a` | GROUNDED | `const data = await service.getRunWithLogs(provider, runId, value.since);`          | `api/src/controllers/deployment.ts:516` | FOUND @516 (exact)                                       |
| 14  | `prop:19acb8ff8f130ff1` | GROUNDED | `const chunk = req.params['chunk'] as string;`                                      | `api/src/controllers/extensions.ts:322` | FOUND @322 (exact) — see anomaly (b)                     |
| 15  | `prop:83aac7e4e0113247` | GROUNDED | `res.locals['payload'] = await service.oas.generate(req.headers.host);`             | `api/src/controllers/server.ts:28`      | FOUND @28 (exact)                                        |

All quotes fall inside the evidence ranges cited on the corresponding rows of
`SPOT-CHECK-SHEET.md`.

## koel — koel-g3-run1 (grader: codex-reviewer)

| #   | proposalId              | Verdict    | Grader note / quote                                                                                                                                                | Cited                     | Verification (grep -nF, ±2) |
| --- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------------------------- |
| 1   | `prop:bd1b2881ccb7ec17` | UNGROUNDED | `Route::match(['get', 'post'], "{$endpoint}{format?}", $controller)->where('format', '\.view');` — generic Subsonic endpoint loop, nothing song-discovery-specific | `routes/subsonic.php:116` | FOUND @116 (exact)          |
| 2   | `prop:ae9957122f24943f` | GROUNDED   | `Route::delete('songs', [SongController::class, 'destroy']);`                                                                                                      | `routes/api.base.php:172` | FOUND @172 (exact)          |
| 3   | `prop:f33a181cc2a00a74` | GROUNDED   | `Route::get('artist/{artist}', DownloadArtistController::class);`                                                                                                  | `routes/web.base.php:59`  | FOUND @59 (exact)           |
| 4   | `prop:e2ed96c4486a3a78` | GROUNDED   | `Route::delete('playlists/{playlist}/songs', [PlaylistSongController::class, 'destroy']);`                                                                         | `routes/api.base.php:223` | FOUND @223 (exact)          |
| 5   | `prop:6be4a456b3479e43` | GROUNDED   | `Route::apiResource('playlist-folders', PlaylistFolderController::class);`                                                                                         | `routes/api.base.php:211` | FOUND @211 (exact)          |
| 6   | `prop:f767b5ecbe204d62` | GROUNDED   | `Route::apiResource('albums.songs', AlbumSongController::class);`                                                                                                  | `routes/api.base.php:158` | FOUND @158 (exact)          |
| 7   | `prop:67d68672332ae23b` | GROUNDED   | `Route::apiResource('artists.songs', ArtistSongController::class);`                                                                                                | `routes/api.base.php:163` | FOUND @163 (exact)          |
| 8   | `prop:c86ac90585bb1048` | UNGROUNDED | `Route::delete('me', LogoutController::class);` — routes DELETE `me` to logout, not account deletion                                                               | `routes/api.base.php:112` | FOUND @112 (exact)          |
| 9   | `prop:f44d5e22ec6a84c3` | GROUNDED   | `Route::delete('podcasts/{podcast}/subscriptions', UnsubscribeFromPodcastController::class);`                                                                      | `routes/api.base.php:292` | FOUND @292 (exact)          |
| 10  | `prop:e83c42418a2caf69` | GROUNDED   | `Route::apiResource('stations', RadioStationController::class);`                                                                                                   | `routes/api.base.php:300` | FOUND @300 (exact)          |
| 11  | `prop:1fb74e6f29fd3ef2` | GROUNDED   | `Route::apiResource('users', UserController::class)->except('show');`                                                                                              | `routes/api.base.php:232` | FOUND @232 (exact)          |
| 12  | `prop:2d6b9443885d33c7` | GROUNDED   | `Route::delete('favorites', [FavoriteController::class, 'destroy']);`                                                                                              | `routes/api.base.php:200` | FOUND @200 (exact)          |
| 13  | `prop:007c58a1d26840d2` | GROUNDED   | `Route::get('genres/{genre?}/songs', PaginateSongsByGenreController::class);`                                                                                      | `routes/api.base.php:227` | FOUND @227 (exact)          |
| 14  | `prop:12e88063be31de01` | GROUNDED   | `Route::post('interaction/batch/unlike', UnlikeMultipleSongsController::class);`                                                                                   | `routes/api.base.php:195` | FOUND @195 (exact)          |
| 15  | `prop:b121daa68faeb1b0` | GROUNDED   | `Route::delete('invitations', [UserInvitationController::class, 'revoke']);`                                                                                       | `routes/api.base.php:275` | FOUND @275 (exact)          |

Note provenance: grader notes are as transmitted by the owner's reconciliation
brief (compressed quote + parenthetical rationale); the two UNGROUNDED
rationales are minimally expanded to full sentences from those parentheticals —
no rationale beyond the transmitted content and the quoted lines themselves.

## Anomalies and resolutions

- **(a) directus ROW 5 — quote beyond the claimed excerpt window.** The
  verdict quotes `payload = await list(query, options);` at
  `api/src/controllers/extensions.ts:111`, but the excerpt reportedly given to
  the grader ended at line 97 of a 48-120 range. Mechanical verification: the
  line EXISTS at exactly `extensions.ts:111` in the clone at the pin (inside
  the sheet's cited range 48-120). Per the reconciliation rule, this is
  recorded **FOUND @111** — the grader read the real file (an invented quote
  matching the exact line and content is not plausible); the verdict stands
  (GROUNDED). Not QUOTE-INVALID.
- **(b) directus ROW 14 — transcribed proposalId slip.** The transmitted
  verdict line for ROW 14 mis-transcribed the proposalId as
  `prop:dc3b566836a3bdcf` (that is ROW 10's id); the verdict CONTENT (chunk
  param quote `const chunk = req.params['chunk'] as string;` @
  `extensions.ts:322`) belongs to **ROW 14 = `prop:19acb8ff8f130ff1`**. The
  quote verifies at exactly `extensions.ts:322`; the verdict is mapped to
  ROW 14's id. ROW 10 keeps its own (distinct, verified) verdict. The slip is
  transcription-only and affects no count.

## Final counts after verification

- **directus / directus-g3-run3:** 15 graded rows, 15 valid (0 VERDICT-VOID),
  15 GROUNDED → **15/15**.
- **koel / koel-g3-run1:** 15 graded rows, 15 valid (0 VERDICT-VOID),
  13 GROUNDED, 2 UNGROUNDED (rows 1 and 8) → **13/15**.
- Verification stats: 30/30 quotes FOUND at their cited locations (28 exact
  single-line matches; 1 whitespace-collapsed two-line match — directus row 7;
  1 exact match resolving anomaly (a) — directus row 5; all inside ±2).

Per decision 5358819617 constraint 3, these results landed in each run
record's `groundednessSpotCheck` (pending → completed) and the record
validator re-ran afterwards (see the PR landing this file).
