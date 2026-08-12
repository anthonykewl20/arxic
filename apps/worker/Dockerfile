FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        g++ \
        git \
        make \
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

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY . .

RUN pnpm install --frozen-lockfile
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pnpm --filter @arxic/playwright-agent-adapter exec playwright install --with-deps chromium
RUN chmod -R a+rX /opt/ms-playwright

CMD ["node", "-e", "setInterval(() => {}, 60000)"]
