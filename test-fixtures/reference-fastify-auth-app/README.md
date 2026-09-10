# reference-fastify-auth-app

Real Fastify auth service used as the positive/negative fixture for the
`fastify-auth` rulepack (framework `fastify >=4 <6`): register/login/logout/me
routes with `@fastify/jwt` tokens, `@fastify/cookie` session cookies and
node:crypto scrypt password hashing. The negative files (`db.ts`, `mail.ts`)
carry the persistence and mail seams without auth-flow calls.
