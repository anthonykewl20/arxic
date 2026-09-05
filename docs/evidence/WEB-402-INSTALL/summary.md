# Clean source installation and recovery proof — refs #402

Source: `00e14a88528d1f017cf62f490a7a0280fae26bfe`, merged by PR #411 as
`38bcabb13714d5b985b062e8fad96733c61e6a9b`. Node 22.22.0 on Linux, a fresh
project-local detached checkout, independent frozen dependency installation and
empty Playwright browser cache. The temporary worktree was removed after proof.

| Real check | Result |
| --- | --- |
| Install dependencies and Chromium, start the actual web entrypoint | Pass |
| Discover the actual Express reference source | Pass: 67 frontend declarations |
| Capture real pixels and approve a baseline | Pass |
| Graceful process restart with the same SQLite state | Pass: project and baseline retained |
| Reuse the pre-restart administrator session | Refused: HTTP 401 |
| Force server termination while a real browser request is in flight | Pass: interrupted run recovered as blocked |
| Preserve the approved baseline after crash recovery | Pass |

`results.json` records the measurements. The three named PNGs were agent-viewed;
their hashes and the allow-listed action timeline match adjacent provenance.
The timeline omits raw network/DOM/session payloads. No raw trace is retained.
This proves a clean Linux source checkout, not a container distribution, remote
TLS configuration, Windows crash cleanup or independent human release inspection.
