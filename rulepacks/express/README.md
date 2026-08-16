# Express auth rule pack

Pack `express-auth@0.1.0` declares framework metadata `express` with version range `>=4 <6`; callers select it with `framework: 'express'`. **Since DG-10 (#254, ADR-008 Decision 9) the range is normative**: framework+version are detected from source evidence (lockfiles first, then package.json manifests — a declared range like `^5.1.0` accepts only when every installable version lies inside the pack range — then imports), and an out-of-range detection blocks rule selection with `ARXIC-RULES-FRAMEWORK-REJECTED`. A deliberate operator override is a recorded waiver in the target repository's `arxic.waivers.json` (`ARXIC-RULES-FRAMEWORK-WAIVED`), never an implicit compatibility claim. All rules are original Arxic work, MIT licensed, with provenance `original-arxic`.

| Rule id                  | Category       | Language   | Semver | Precision / fallback note                                                        |
| ------------------------ | -------------- | ---------- | ------ | -------------------------------------------------------------------------------- |
| `express-route`          | route          | TypeScript | 1.0.0  | Direct app HTTP method, literal path, and complete callback range.               |
| `express-form-fields`    | form           | TypeScript | 1.0.0  | Captured `request.body` field; dynamic keys are deferred.                        |
| `express-inline-handler` | handler        | TypeScript | 1.0.0  | Direct inline route callback; referenced middleware needs data flow.             |
| `express-auth-guard`     | guard          | TypeScript | 1.0.0  | Direct credential lookup/compare/session access.                                 |
| `express-password-hash`  | password-hash  | TypeScript | 1.0.0  | Direct bcrypt hash/compare operands.                                             |
| `express-token-create`   | token-create   | TypeScript | 1.0.0  | Direct `randomBytes(...).toString(...)`.                                         |
| `express-token-persist`  | token-persist  | TypeScript | 1.0.0  | Prepared write call with SQL/value captures; ORM writes are deferred.            |
| `express-token-verify`   | token-verify   | TypeScript | 1.0.0  | Direct reset-token lookup with token capture.                                    |
| `express-mail-transport` | mail-transport | TypeScript | 1.0.0  | Direct nodemailer transport/send; wrappers need reconciliation.                  |
| `express-session-cookie` | session-cookie | TypeScript | 1.0.0  | Direct response cookie set/clear with captured fields.                           |
| `express-totp-verify`    | totp-verify    | TypeScript | 1.0.0  | Direct otplib verification; fixture-only because the vulnerable app has no TOTP. |

Each rule has synthetic positive/negative fixtures under `tests/<rule-id>/`; the adapter harness also registers real vulnerable-app files where that behavior exists.
