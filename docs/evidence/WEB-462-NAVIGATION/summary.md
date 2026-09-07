# Direct declaration navigation — #462

In progress, based on PR #461 head `702705954539ad22ff91db4a2969501b782dd793` with dirty navigation changes. This slice depends on #461; neither predecessor nor this slice is claimed merged or production-ready.

The real reference-source/dashboard journey showed declaration filters separated from their results by the complete route inventory and workflow controls. New per-project links report matching declaration counts and move keyboard/pointer users directly to a focused heading. Link counts and rendered rows use one selector. The zero-match link reaches the explicit empty result. Activation stays in the current view, avoiding the page-history refresh caused by the initial fragment-only approach.

Red tests preserve three failures: no navigation link; a focused heading still off-screen after the first fragment-only approach; and 3 pixels of mobile page overflow from the full revision hash. Firefox then exposed a heading top of 63.5 against the unchanged 64-pixel minimum. Wrapping the revision hash and adding visible scroll clearance address these defects. No assertion was widened. The new mobile width is tightened from 390 to 320; the desktop width remains 1440.

Final Firefox journey passes in 15.93 seconds and WebKit in 14.15 seconds. The same actual committed Express source and running reference page retain thirteen EJS controls, with source hashes and hypothesized truth. Keyboard Tab/Enter from the search field and pointer activation focus the visible declaration heading. Agent image inspection includes the top-level result link and corrected Firefox mobile clearance/hash wrapping. Final Chromium/full-workbench regression passed: three cases across two files, 113.48 s. TypeScript and lint passed; final format after the note is recorded in the slice handoff.

Named screenshots are capture-masked with adjacent privacy provenance and sanitized action timelines. Red audits remain failed records. No raw traces are retained. Light-theme desktop/mobile results do not establish wider theme/state coverage or human release inspection. Installed acceptance remains pending; the existing mandatory seventeenth journey carries these assertions into every installed dashboard mode.

## Historical duplicate-ID inventories render every declaration

The real committed Express source discovery contains seven declarations whose earlier persisted identity format (`sha256([source, kind, label])`) produced the same ID — nested syntax sharing one source line. The journey now restores that ID format over the actual source rows into a separate temporary historical database through the real Store, opens a second real workbench against it, and filters to the EJS controls.

Red (published head `1b79a623` plus the extended test, no rendering fix): the matching link reported 13 declarations but the table retained 20 rows — the seven duplicate IDs collided as React keys, so stale unfiltered rows survived the filter. The retained persisted inventory was unchanged; only rendering was wrong. `historical-red.txt` + `historical-red/` preserve the failed record (1 failed test, 15.15 s).

Fix: rendered rows are keyed by their position in the original immutable inventory combined with the source ID (`${index}:${row.id}`), never by the filtered or page-relative index, so keys stay unique and stable across filtering, paging and 2.5-second polling for the same finished run. No saved evidence is rewritten, no declaration is deduplicated or dropped, and no rediscollection is required.

Green: Chromium 13.93 s, Firefox 17.77 s, WebKit 15.56 s — the unchanged thirteen-row assertion passes in all three engines, and the persisted historical inventory remains object-equal after viewing and filtering. The earlier rediscovery-only workaround is no longer needed for historical inventories; newly generated inventories already received stable unique IDs from #460. Other pre-#460 historical inventories stored elsewhere still render through this same path; none beyond the reference source have been inspected.
