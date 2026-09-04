# Access the application's root entry point

Workflow: `prop:754355e865abdd2f`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| home → home | Submit access the application's root entry point form via "Log In" | url:/ | required |

## Checkpoints

- home

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
