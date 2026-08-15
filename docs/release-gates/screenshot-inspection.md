# Screenshot inspection release gate

Every promoted release that retains screenshots requires a human visual
inspection before tagging or publishing. This is a release gate, not a test
result: an LLM and automated checks cannot discharge it or certify arbitrary
pixels secret-free.

## Inspector procedure

1. Generate the complete screenshot census from the promoted bundle, run, or
   evidence root before opening any files:

   ```sh
   node scripts/inspection-manifest.mjs <promoted-bundle-or-evidence-root>
   ```

   The script writes `inspection-manifest.json`, a human-readable
   `inspection-manifest.txt`, and `inspection-sign-off.md` next to that root.
   The manifest is a review checklist, not pixel-safety certification.

   Caveats: outputs are written **into** the supplied root, so use a
   per-run/per-release root (or a copy), not a shared evidence tree you want
   kept pristine. Symlinked screenshot files are listed but not followed and
   require manual resolution; symlinked directories are not traversed.

2. Collect every retained, promoted PNG and its adjacent `.privacy.json`
   provenance from the release's promoted bundles. Reject raw captures and
   screenshots without provenance before review.
3. Use a **census, not a statistical sample**: inspect every retained
   screenshot from every clean verification run in every promoted bundle. This
   includes each screenshot kind/checkpoint, fixture/target, and repeat run;
   there is no smaller sample size that passes this gate.
4. Open each PNG at normal viewing size and inspect all visible pixels for
   credentials, email addresses, API keys/tokens, session or cookie data,
   personal information, and any other data not intended for public retention.
   Confirm that the adjacent provenance names the intended policy and capture.
5. **Fail** the gate if any secret or personal data is visible, provenance is
   missing/mismatched, or the inspector cannot make a confident determination.
   The bundle cannot be released. Remove or recapture the artifact under the
   capture-time privacy policy, then repeat the full inspection.
6. On pass, complete the generated `inspection-sign-off.md` and append a dated
   sign-off to
   `docs/evidence/<release>/inspection.md` (or the release notes) naming the
   reviewer and the exact bundle/run set reviewed. Use this format:

   ```text
   YYYY-MM-DD — Human screenshot inspection: PASS
   Reviewer: <name>
   Release: <version>
   Reviewed: <bundle IDs; run IDs; screenshot count and kinds>
   Provenance: <paths or manifest identifiers>
   ```

Run this gate for every promoted release, even when screenshot hashes are
unchanged. A prior sign-off does not certify a newly promoted bundle.

## Boundary

Capture-time masking and `.privacy.json` provenance are necessary prerequisites,
but they do not prove pixel secrecy; valid PNG image data can still contain
unexpected content. The human inspection complements those controls and is not
a substitute for them.

**Provenance:** screenshot retention and the irreducible visual-review boundary
are documented in `docs/evidence/README.md:17-27`,
`docs/evidence/M1-SCREENSHOT-PRIVACY/README.md:13-29`, and
`docs/threat-model.md:188-199`.
