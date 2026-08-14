# Screenshot inspection release gate

Every promoted release that retains screenshots requires a human visual
inspection before tagging or publishing. This is a release gate, not a test
result: an LLM and automated checks cannot discharge it or certify arbitrary
pixels secret-free.

## Inspector procedure

1. Collect every retained, promoted PNG and its adjacent `.privacy.json`
   provenance from the release's promoted bundles. Reject raw captures and
   screenshots without provenance before review.
2. Use a **census, not a statistical sample**: inspect every retained
   screenshot from every clean verification run in every promoted bundle. This
   includes each screenshot kind/checkpoint, fixture/target, and repeat run;
   there is no smaller sample size that passes this gate.
3. Open each PNG at normal viewing size and inspect all visible pixels for
   credentials, email addresses, API keys/tokens, session or cookie data,
   personal information, and any other data not intended for public retention.
   Confirm that the adjacent provenance names the intended policy and capture.
4. **Fail** the gate if any secret or personal data is visible, provenance is
   missing/mismatched, or the inspector cannot make a confident determination.
   The bundle cannot be released. Remove or recapture the artifact under the
   capture-time privacy policy, then repeat the full inspection.
5. On pass, append a dated sign-off to
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
