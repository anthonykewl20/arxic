# Present a public landing page as the entry surface of the web application

Workflow: `prop:22e712143d7cb7e2`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| home → home | Submit present a public landing page as the entry surface of the web application form via "Log In" | url:/ | required |

## Checkpoints

- home

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
