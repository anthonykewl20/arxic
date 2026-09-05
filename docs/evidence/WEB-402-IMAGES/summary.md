# Model image transport proof — refs #402

Source: `925fb84a5b2bd2b5cf2e9cc46b14e21dcbb3fe5e`; 2026-09-05.

| Check | Result | Evidence |
| --- | --- | --- |
| Silent image omission | Reproduced before fix; real Chromium PNG now reaches HTTP content parts byte-for-byte | `images.real-world.test.ts` |
| Malformed, unsupported, oversized and mismatched image input | Blocked before credential resolution/provider contact | `images.test.ts`, real-world test |
| Caller buffer mutation during credential resolution | Provider receives the owned original bytes | Real-world test |
| Host attachment lifecycle | Private 0600 PNG in 0700 directory; removed after success, failure and timeout | Real subprocess assertions |
| Temporary-path output | Reproduced as accepted output before fix; blocked after fix | Real subprocess assertion, unchanged schema |
| Missing host image capability | Blocked without spawning | Real subprocess assertion |
| Live image reading, original order | Both headings and all button labels match independently read DOM text | `results.json`, first record |
| Live image reading, reversed order | Both headings and all button labels match the reversed images | `results.json`, second record |
| Retained artifacts | Two PNGs viewed by the agent; image/provenance/timeline/request hashes and byte counts pass | Adjacent provenance and metadata |

The live probe boots the actual Express vulnerable-auth-app and Next.js
reference-auth-app. Chromium captures anonymous states with every input and
textarea masked. The installed coding agent receives only those PNG attachments
and a generic schema/transcription instruction, with no expected labels, DOM or
source. Two separate requests use opposite image orders. Provider telemetry
records zero tool invocations and deletion of each newly created probe session.
Only the model boundary is stubbed in the committed HTTP test; the live probe
uses the actual installed agent. The adapter's zero token counters identify the
host transport's lack of usage receipts; separate provider telemetry is retained
and does not establish billing cost or the actual underlying model ID.

All **58 model tests in seven files pass** (6.78 s). Root/package type checks and
lint pass. Full format check: `All matched files use Prettier code style!`.
Current-head required CI is pending at authoring.

No raw trace, prompt, image base64 or temporary attachment path is retained in
JSON artifacts. The two PNGs and adjacent privacy files are byte-preserved;
`timeline.json` contains only allow-listed actions and comparison outcomes.
Human screenshot inspection has not been performed.

This proves bounded delivery and basic image reading. It does not establish
semantic defect detection, exhaustive visual coverage, arbitrary-pixel privacy,
or a completed dashboard review flow. Those remain under #402. No model assigns
`verified`.
