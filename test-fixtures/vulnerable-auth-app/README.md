# Vulnerable Auth App

This real Express + EJS fixture is deliberately insecure. It exists only on the isolated local-test surface so Arxic can diagnose concrete authentication weaknesses.

## Vulnerability catalog

- **Account-enumerating login:** unknown-email and wrong-password responses are intentionally distinct.
- **Reusable reset tokens:** successful password resets intentionally do not consume their token.
- **Long-lived reset tokens:** reset links remain valid for seven days.
- **No rate limiting:** login and reset endpoints accept unlimited attempts.
- **No CSRF protection:** state-changing forms have no CSRF token or origin validation.
- **Verbose errors:** responses reveal whether an account and reset token exist.
- **Unsigned session cookie:** successful login stores the email directly in a client-controlled cookie.

Never deploy this application or expose it to a non-test network.
