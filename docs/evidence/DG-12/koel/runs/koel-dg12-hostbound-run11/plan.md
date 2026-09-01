# Access the application's primary entry page

Workflow: `prop:ef0ef0407dff6287`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| home → home | Submit access the application's primary entry page form via "Log In" | url:/ | required |

## Checkpoints

- home

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
