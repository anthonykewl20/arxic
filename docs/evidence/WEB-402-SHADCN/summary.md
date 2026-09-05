# Workspace presentation migration — refs #402

The workspace shell, overview, campaign history/details, schedules and
administration now render through React/shadcn. API/session/polling actions remain
shared with the existing dashboard. Models stay provider-owned and accept custom
IDs. The version remains the unreleased `v0.0.200`.

## Reproduced defects

- JSX conversion changed persona option values, preventing `seed-api` selection.
  Exact option values were restored; the original business assertion was retained.
- The new mobile menu initially remained open after Escape. A real Chromium
  keyboard assertion failed (`expected 0 to be 1` for the reopened toggle label).
  Closing the disclosure and restoring toggle focus passes the unchanged assertion.
- The mobile journey now explicitly opens the menu before selecting a screen.
  Those new interaction steps reflect the new disclosure; business assertions were
  not relaxed. An initial overly broad test edit also inserted mobile steps at two
  desktop positions; it was corrected before the passing committed run.
- Screenshot inspection at `bf9392ab084edb09e7cd4ca56bff8c91e464de63` found
  [oversized checkboxes](before/12-mobile-guided-settings.png) and an
  [unintended dark activity border](before/06-administration.png). The form now uses
  native checkbox inputs, and the shared shadcn Card explicitly uses the border
  theme color. Adjacent privacy records bind those original screenshots.

## Scope and limitations

The project form is rendered by React but keeps its native dialog and existing
submission actions. Inventory, workflow selection, run details, model fields and
image-review presentation remain imperative migration work. These tests establish
specific browser behaviors, not exhaustive business intent or visual detection.

The campaign test uses real Next.js, Mailpit, source indexing, compiler and two
verifier replays per selected workflow; only the external model response is a
boundary stub. Review/provider UI tests likewise isolate the external provider
boundary. Fresh paid-provider inference is not claimed by this UI slice; retained
native account proof is in [WEB-402-SUBSCRIPTIONS](../WEB-402-SUBSCRIPTIONS/summary.md).
No raw traces or credential caches are retained. Agent inspection is not human
release sign-off. Issue #402 remains open.

## Browser results and artifacts

| User-level test | Result | Source revision | Safe proof |
| --- | --- | --- | --- |
| Refuse invalid login/root/credentials; preserve exact custom IDs, real source inventory, baseline comparisons, schedules and audit; mobile fit and Escape/focus; late login/logout responses | PASS | `1d3aab1d82e0173e737c9a535c95357efbf4baa7` | [Core timeline](core/timeline.json), [provenance](core/timeline.sanitization.json), 13 named PNGs |
| Guided workflow selection, real Next/Mailpit two-workflow replay, full surface denominator and child-result navigation on mobile | PASS | `fa55326ff329acb213f24f3a155e0572441c6377` | [Campaign timeline](campaign/timeline.json), [provenance](campaign/timeline.sanitization.json), 4 named PNGs |
| Pixel-sharing consent, custom review model, draft persistence, screenshot-bound hypotheses and mobile display | PASS | `1d3aab1d82e0173e737c9a535c95357efbf4baa7` | [Review timeline](review/timeline.json), [provenance](review/timeline.sanitization.json), 3 named PNGs |
| Provider-owned catalog updates, search persistence, visible stale/error state and mobile fit | PASS | `1d3aab1d82e0173e737c9a535c95357efbf4baa7` | [Provider timeline](provider/timeline.json), [provenance](provider/timeline.sanitization.json), 3 named PNGs |

All 25 PNGs (23 final and two original styling defects) were agent-inspected;
[inspection.json](inspection.json) records matching hashes. All four timeline
hashes match their adjacent sanitization provenance. The final campaign rerun
scrolls to the child result before capture: the earlier screenshot only showed
the mobile run list. No behavioral assertion was changed by that proof correction.

The full web area passed **47 tests in 13 files, 229.24 s**, at `bf9392a` before
the final checkbox/border corrections. All four browser suites then passed at
`1d3aab1` (**85.78 s**). The final campaign capture correction passed at `fa55326`
(**46.23 s**). Root/package type checks, lint and the license gate pass locally.
Required PR-head CI and merge remain pending; local checks do not establish
completion of this slice or the wider release.
