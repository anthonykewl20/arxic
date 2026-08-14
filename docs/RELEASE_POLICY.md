# Release policy

Arxic follows the [Semantic Versioning baseline](../RELEASES.md). This document
defines the public-surface, support, and deprecation commitments that apply at
`1.0.0` and later; the pre-`1.0.0` convention remains the `0.MINOR.PATCH`
policy in `RELEASES.md`.

## Public surface and SemVer

The public surface is the `arxic` CLI (commands, flags, exit behavior, and
machine-readable output); the `arxic.yaml` configuration schema; promoted
bundle format and its schemas; published package APIs; and the frozen adapter
contracts. Documentation examples are not APIs unless they are incorporated
into one of those surfaces.

After `1.0.0`:

- **MAJOR** may remove or incompatibly change a public surface, including a
  required schema field, bundle interpretation, or adapter-contract behavior.
- **MINOR** adds a backwards-compatible public capability, optional schema or
  bundle fields, or a deprecated replacement path.
- **PATCH** fixes a backwards-compatible defect and does not add a required
  migration.

## Support and security fixes

Until a release is explicitly designated LTS, fixes are provided only for the
latest release. There is no LTS line during `0.x`; a future LTS designation
will name its supported versions and end date here. Security reports and their
best-effort response targets follow [`SECURITY.md`](../SECURITY.md#response-sla-best-effort).

## Deprecation

Deprecations are announced under `### Deprecated` in `CHANGELOG.md`, identify
the affected surface and replacement/migration path, and remain usable for at
least one MINOR release or 90 calendar days, whichever is longer. Removing the
deprecated surface requires a subsequent MAJOR release.

If a published npm version must be warned against, maintainers also run
`npm deprecate <package>@<version> "<migration message>"`; that notice does
not replace the changelog entry or the notice period.
