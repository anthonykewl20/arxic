# Playwright compiler

Compiles validated workflows and observations into portable Playwright suites, fixture code, a plan and hash-bound artifacts. Compile policy rejects unsupported actions, unsafe APIs, secret literals and unreviewed workflow locators.

Generated actions wait for the shared exploration settling service before evaluating assertions or recording screenshots/transition receipts. The service travels in the existing package-owned transition runtime, under its independent verifier source/hash binding and unchanged forbidden-API/secret gates. Workflow-specific locator permissions are unchanged.

Real reference-app regressions exercise generated login and reset flows, delayed actions, replay failures, origin containment and artifact integrity. The web selected-reset regression requires inbox counts 1, 2, 3 even when the first replay submission is delayed.
