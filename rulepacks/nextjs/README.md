# Next.js auth rule pack

Pack `nextjs-auth@0.1.0` declares framework metadata `nextjs` with version range `>=15 <17`; callers select it with `framework: 'nextjs'`. **Since DG-10 (#254, ADR-008 Decision 9) the range is normative**: framework+version are detected from source evidence (pnpm-lock/package-lock/npm-shrinkwrap/yarn.lock lockfiles first, then package.json manifests, then imports), and a detected version outside the range blocks rule selection with `ARXIC-RULES-FRAMEWORK-REJECTED`. The range was widened from `>=15 <16` to `>=15 <17` with evidence: every rule in this pack is CI-verified against the reference app on `next@16.3.0` (`test-fixtures/reference-auth-app`, `real-world.test.ts` in both `@arxic/ast-grep-adapter` and `@arxic/orchestrator-langgraph`). A deliberate operator override is a recorded waiver in the target repository's `arxic.waivers.json` (`ARXIC-RULES-FRAMEWORK-WAIVED`), never an implicit compatibility claim. All rules are original Arxic work, MIT licensed, with provenance `original-arxic`. App Router routes are connected by the deterministic `app/<feature>/page.tsx|route.ts` path convention; this path interpretation is not regex discovery.

| Rule id                 | Category       | Language   | Semver | Precision / fallback note                                                           |
| ----------------------- | -------------- | ---------- | ------ | ----------------------------------------------------------------------------------- |
| `nextjs-page-route`     | route          | TSX        | 1.0.0  | Async page export; path convention supplies route, other exports need another rule. |
| `nextjs-route-handler`  | route          | TypeScript | 1.0.0  | Named HTTP export in an App Router `route.ts`; re-exports are deferred.             |
| `nextjs-auth-form`      | form           | TSX        | 1.0.0  | Structural JSX form and captured children; composed controls are deferred.          |
| `nextjs-server-action`  | handler        | TypeScript | 1.0.0  | Exported async function accepted only in a `'use server'` module.                   |
| `nextjs-auth-guard`     | guard          | TypeScript | 1.0.0  | Named CSRF/rate/session/bcrypt calls; aliases are deferred.                         |
| `nextjs-password-hash`  | password-hash  | TypeScript | 1.0.0  | Direct bcrypt hash/compare operands.                                                |
| `nextjs-token-create`   | token-create   | TypeScript | 1.0.0  | Direct `randomBytes(...).toString(...)`.                                            |
| `nextjs-token-persist`  | token-persist  | TypeScript | 1.0.0  | Prepared write call with SQL/value captures; ORM writes are deferred.               |
| `nextjs-token-verify`   | token-verify   | TypeScript | 1.0.0  | Direct `timingSafeEqual` operands.                                                  |
| `nextjs-mail-transport` | mail-transport | TypeScript | 1.0.0  | Direct nodemailer transport/send; wrappers need reconciliation.                     |
| `nextjs-session-cookie` | session-cookie | TypeScript | 1.0.0  | Cookie store set with name/value/options, including `httpOnly`.                     |
| `nextjs-totp-verify`    | totp-verify    | TypeScript | 1.0.0  | Direct otplib `verify`/`check`.                                                     |

Each rule has synthetic positive/negative fixtures under `tests/<rule-id>/`; the adapter harness also registers real reference-app files.
