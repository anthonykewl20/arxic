# DG-05 evidence — production PHP language pack on real Laravel apps

Produced by `packages/source-ua-adapter/scripts/measure-laravel-inventory.mts`
against local clones OUTSIDE the repository (`/tmp/opencode/koel`,
`/tmp/opencode/bookstack`; full-clone, non-shallow). Each interchange artifact
is the pack's own output (`arxic-langpack-php@1.0.0`, `standIn: false`), and
the emitting script validates every document with the REAL DG-02
`validateInterchange` before writing (`ok: true` recorded in each summary).

Aggregate data + repo identity + commit SHAs only — no source content.

| Corpus                 | Commit                                     | `laravel/framework` (composer.lock) | Routes (interchange) | Conditional | Middleware-carrier | Gaps                                                       | PHP parse failures |
| ---------------------- | ------------------------------------------ | ----------------------------------- | -------------------- | ----------- | ------------------ | ---------------------------------------------------------- | ------------------ |
| koel/koel              | `dfec91ff290509c622ff7cf392fb5e506841ee2b` | v13.24.0                            | 239                  | 7           | 239                | 2 (`unresolved-file`: provider includes)                   | 0 / 1,412          |
| BookStackApp/BookStack | `c813c1b3628c0b6bd757c12cadaa56f50724117d` | v12.64.0                            | 335                  | 0           | 225                | 3 (2 provider includes + 1 `parse-error`: blade-as-`.php`) | 1 / 1,770          |

Gap details (verified against the sources at the pinned commits):

- koel: `app/Providers/BroadcastServiceProvider.php:14` includes
  `routes/channels.php`; `app/Providers/RouteServiceProvider.php:16` includes a
  route file whose path is computed at runtime (`sprintf` version-aware loader).
- BookStack: `app/App/Providers/RouteServiceProvider.php:49` includes
  `routes/web.php` (with the including group's prefix/middleware not applied by
  the per-file scan — the DG-01 §5.4.1 limitation, now visible per file) and
  `:72` includes `routes/api.php` (prefix `api`).

CI-checked: `packages/source-ua-adapter/src/__tests__/koel-interchange.test.ts`
re-validates the committed koel artifact with the real validator and asserts
the recorded literal counts. DG-02's stand-in on the same koel commit produced
188 routes + 1 gap (`docs/evidence/DG-02/koel-interchange.json`); the
production pack resolves the subsonic literal `foreach` (the stand-in's gap),
merges `Route::match`/resource update verb pairs to `route:list` shape, and
adds provider-include accounting.
