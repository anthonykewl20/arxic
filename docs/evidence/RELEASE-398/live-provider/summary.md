# Fresh live-provider proof

Arxic source `e046590`, packed CLI 0.1.0; real reference Next.js 16.3.3 application,
Chromium and an isolated Mailpit container; fixture personas only. The provider is
the authenticated OpenCode CLI with its unchanged default configuration. A
structured smoke probe identified `zai-coding-plan / glm-5.3-flash`. These are
actual provider responses, not the deterministic HTTP stub. Provider tools were
denied; all 13 pipeline request records report zero tool calls, and the temporary
provider sessions were deleted. Token counts are provider-CLI reports; zero
reported CLI cost is not a claim about subscription pricing.

| Test | Result |
| --- | --- |
| Missing Mailpit: model-selected reset-email workflow | Expected blocked result; HTTP 500 on all three verifier passes; no promotion |
| Fully provisioned Mailpit: model-selected reset-email workflow | PASS; CLI exit 0; verifier reports three clean passes; bundle promoted |
| Independent real mail observation | PASS; four messages, one exploration + three replays |
| Grounded provider calls | 7 on the blocked run, 6 on the provisioned run; no model tools invoked |
| Human screenshot sign-off | NOT PERFORMED |

The generated workflow characterizes the observed UI; it does not itself assert
mailbox delivery or account reset completion. The independent mailbox count
supplies the additional observation above. The broader Directus/Koel campaign
matrix was not rerun. All retained screenshots are masked and have adjacent
privacy provenance. Only sanitized timelines and their provenance are retained.
