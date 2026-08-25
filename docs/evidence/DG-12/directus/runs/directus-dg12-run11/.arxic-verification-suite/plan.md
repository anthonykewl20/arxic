# Enhance access control for admin routes

Workflow: `prop:01bd473959a92326`

## Preconditions

- None

## Transitions

| Transition | Action | User-visible assertions | Requirement |
| --- | --- | --- | --- |
| admin-page → admin-login-page | Submit enhance access control for admin routes form via "Sign In" | url:/admin/login | required |

## Checkpoints

- admin-login-page

## Verification policy

- Required clean runs: 2
- Browser: chromium
- Trace: retain
- Unexpected network errors forbidden: true
- Fixture reset: before and after each independent test
- Persona mutations: serial within the persona lease
