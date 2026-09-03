# `node:22-slim` multi-architecture index digest. Refresh this pin by running
# `docker buildx imagetools inspect node:22-slim`, confirming the reported
# `Digest` belongs to the multi-architecture index, then updating this value.
# Pinned: 2026-08-14.
# Rebuild and prove the refreshed image with `bash apps/worker/build-and-verify.sh`.
FROM node:22-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        g++ \
        git \
        make \
        procps \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm SYSTEM-WIDE via npm (NOT corepack). Corepack caches the prepared
# package per-uid under ~/.cache/node/corepack and re-fetches it over the
# network when a different uid runs the shim; the worker sandbox runs non-root
# (host uid) under an internal Docker network with no internet egress (ADR
# §16), so corepack's fetch fails and the toolchain is unavailable. A global
# npm install puts a real pnpm binary in /usr/local/bin that every uid can
# execute with no network dependency and no per-user cache. The version is
# pinned here and matches package.json "packageManager"; corepack is never
# enabled, so its shim never shadows this binary.
RUN npm install -g pnpm@11.17.0
# pnpm global dir. Pre-created world-writable-with-sticky (like /tmp) so a
# non-root uid under a writable rootfs can populate it; under the read-only
# sandbox rootfs pnpm exec resolves from the already-installed
# /app/node_modules/.pnpm virtual store and never needs to write here. Adding
# it to PATH keeps pnpm's own "PNPM_HOME is not set" warning quiet.
ENV PNPM_HOME=/opt/pnpm
ENV PATH=/opt/pnpm:$PATH
RUN mkdir -p /opt/pnpm && chmod 1777 /opt/pnpm

WORKDIR /app

# Manifest-first layer order (issue #377, CI-efficiency follow-up from the
# 2026-08-13(7) session): the dependency + Chromium layers used to rebuild on
# every source change because `COPY . .` preceded `pnpm install`. Copying only
# the workspace manifests first lets those layers survive source-only changes
# (buildx type=gha cache in ci.yml). BuildKit wildcard COPY flattens
# directories (`packages/*/package.json` collapses to one file — verified), so
# every workspace manifest is listed explicitly; pnpm fails closed under
# --frozen-lockfile if a workspace package is added without a line here.
# patches/ must exist before install: pnpm applies patchedDependencies at
# resolve time. The final image content is identical to the previous
# single-`COPY . .` ordering — only layer boundaries moved.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY patches ./patches
COPY apps/cli/package.json apps/cli/
COPY apps/worker/package.json apps/worker/
COPY packages/ast-grep-adapter/package.json packages/ast-grep-adapter/
COPY packages/auth-domain-pack/package.json packages/auth-domain-pack/
COPY packages/bundle-promoter/package.json packages/bundle-promoter/
COPY packages/contracts/package.json packages/contracts/
COPY packages/crawlee-adapter/package.json packages/crawlee-adapter/
COPY packages/domain-inventory-spike/package.json packages/domain-inventory-spike/
COPY packages/environment/package.json packages/environment/
COPY packages/evidence-graph/package.json packages/evidence-graph/
COPY packages/fixture-mailpit/package.json packages/fixture-mailpit/
COPY packages/fixture-otplib/package.json packages/fixture-otplib/
COPY packages/fs-safe/package.json packages/fs-safe/
COPY packages/intent/package.json packages/intent/
COPY packages/intent-proposal-spike/package.json packages/intent-proposal-spike/
COPY packages/m0-pipeline/package.json packages/m0-pipeline/
COPY packages/model-adapter/package.json packages/model-adapter/
COPY packages/orchestrator-langgraph/package.json packages/orchestrator-langgraph/
COPY packages/playwright-agent-adapter/package.json packages/playwright-agent-adapter/
COPY packages/playwright-compiler/package.json packages/playwright-compiler/
COPY packages/playwright-screenshot-privacy/package.json packages/playwright-screenshot-privacy/
COPY packages/playwright-trace-sanitizer/package.json packages/playwright-trace-sanitizer/
COPY packages/policy-engine/package.json packages/policy-engine/
COPY packages/real-world-testkit/package.json packages/real-world-testkit/
COPY packages/reconciler/package.json packages/reconciler/
COPY packages/source-ua-adapter/package.json packages/source-ua-adapter/
COPY packages/verification-spike/package.json packages/verification-spike/
COPY packages/verifier/package.json packages/verifier/
# test-fixtures/dg12-fabrication-audit is data-only (no package.json) — it is
# not a pnpm workspace member and needs no manifest line.
COPY test-fixtures/reference-auth-app/package.json test-fixtures/reference-auth-app/
COPY test-fixtures/vulnerable-auth-app/package.json test-fixtures/vulnerable-auth-app/
RUN pnpm install --frozen-lockfile
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pnpm --filter @arxic/playwright-agent-adapter exec playwright install --with-deps chromium
RUN chmod -R a+rX /opt/ms-playwright

COPY . .
RUN pnpm --filter @arxic/worker build

CMD ["node", "/app/apps/worker/dist/main.js"]
