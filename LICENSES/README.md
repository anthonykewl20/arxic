# Licenses

Arxic is MIT-licensed (see root `LICENSE`). This directory is reserved for future
full-text third-party license files required by code that Arxic vendors into the
product (e.g. under `third_party/`, per ADR §18).

The upstream engines Arxic assembles are **reference-only** (not vendored into the
repo). Their license texts and provenance records live in
[`docs/gears/<name>/LICENSE`](../docs/gears/) + [`docs/gears/<name>/PROVENANCE.md`](../docs/gears/),
and the code itself is fetched locally on demand via `scripts/fetch-gears.sh`.
