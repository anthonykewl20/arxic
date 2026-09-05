# stream-json compatibility hardening — #406

Public advisory: [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x).
Tracker: [#406](https://github.com/anthonykewl20/arxic/issues/406).

Dependabot alert 223 reports stream-json 1.9.1, reached only through Crawlee
3.18.1's runtime dependency. The affected Pick/Ignore/Filter/Replace path filters
rejoin the nesting stack for each checked token, so deep unmatched paths cost
quadratic work. The installed API accepted a 2,048-level crafted document before
the fix: the rejection assertion failed because the pipeline resolved.

Crawlee's only import is `stream-json/streamers/StreamArray` in its serialization
module. The advisory explicitly excludes this streamer from the affected path.
The patched upstream line starts at 3.5.0; current 3.6.0 is ESM with different
exports. Replacing Crawlee's required CommonJS 1.x dependency with 3.x is not a
compatible security override.

## Resolution

A four-line pnpm patch limits the depth of paths evaluated by FilterBase to
1,024. A deeper path reports a RangeError through the stream callback before
joining it. Match pass/skip states do not construct paths and are unchanged;
this is a bound on evaluated filter paths, not a universal JSON nesting limit.
No bypass option is added. Parser/assembler/StreamArray behavior is unchanged.

The patch is pinned by hash in `pnpm-lock.yaml` and selected in
`pnpm-workspace.yaml`. Frozen-lockfile installs apply it. The worker Docker build
copies the patches directory before installation. Package versions stay 1.9.1,
so scanners that consider version ranges alone may continue reporting the stock
upstream vulnerability. No blanket audit ignore or major-version override is added.

## Validation

- PASS: all four affected filters reject over-depth object and array paths with
  both string and regular-expression selectors through the installed stream API.
- PASS: 1,024 levels are accepted and 1,025 are rejected with a RangeError.
- PASS: ordinary Pick/Ignore/Filter/Replace output matches independent literals,
  including Unicode values. The test uses paired packed-token parser/stringer
  modes. An initial mixed-token setup produced duplicate Ignore output; correcting
  that setup preserved the exact expected-output assertions.
- PASS: actual Crawlee compressed-request serialization and StreamArray decoding
  round-trip a request record without API changes.
- PASS: the existing real Next.js/Crawlee/Chromium breadth-discovery test retains
  route/form, crawl-budget, same-origin and no-mutation assertions.

The final combined run passes all 11 tests across the dependency and real-app
files in 7.31 s (9.06 s including startup). The initial combined run had one
filter-output test failure from the token setup described above; its exact
expected output is unchanged. No internal Arxic mocks, skipped
assertions or weakened expected values are used. Required current-head CI,
packaging, license and worker-image results remain the merge gate.

This patch bounds the advisory's nesting dimension. It is not a general memory,
byte-volume, arbitrary RegExp or custom-filter execution limit. Stock unpatched
stream-json 1.9.1 remains affected. Reassess the patch when Crawlee migrates to a
compatible fixed upstream API; do not remove it based solely on a scanner dismissal.
