# Improve admin interface responsiveness

Workflow: `prop:3e87733f06dba070`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| admin-page → admin-login-page | Submit improve admin interface responsiveness form via "Sign In" | url:/admin/login | required |

## Checkpoints

- admin-login-page

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
