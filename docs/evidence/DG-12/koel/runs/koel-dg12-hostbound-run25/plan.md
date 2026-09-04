# Steer first-time visitors into an entry or signup flow

Workflow: `prop:08ab5475ccc5ff5e`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| home → home | Submit steer first-time visitors into an entry or signup flow form via "Log In" | url:/ | required |

## Checkpoints

- home

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
