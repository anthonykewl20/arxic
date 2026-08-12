FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        g++ \
        git \
        make \
        python3 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
    && corepack prepare pnpm@11.17.0 --activate

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY . .

RUN pnpm install --frozen-lockfile
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pnpm --filter @arxic/playwright-agent-adapter exec playwright install --with-deps chromium
RUN chmod -R a+rX /opt/ms-playwright

CMD ["node", "-e", "setInterval(() => {}, 60000)"]
