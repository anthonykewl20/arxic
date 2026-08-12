#!/usr/bin/env bash
set -euo pipefail

# The canonical worker image tag. The sandbox wires this tag via
# createLocalWorkerClient (apps/worker/src/worker-client.ts) and the real-image
# hardening test resolves it by the same name.
readonly IMAGE_TAG="arxic-worker:dev"

docker build -f apps/worker/Dockerfile -t "${IMAGE_TAG}" .

# Verify the toolchain runs as root (default) AND as a non-root uid. The
# non-root verify is the realistic sandbox condition (the sandbox runs under the
# host uid, never root).
docker run --rm "${IMAGE_TAG}" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { execFileSync } from "node:child_process";
  import { createRequire } from "node:module";

  const [major, minor] = process.versions.node.split(".").map(Number);
  assert(
    major > 22 || (major === 22 && minor >= 22),
    `Node >=22.22 required, found ${process.version}`,
  );
  console.log(`node: ${process.version}`);

  const run = (command, args) =>
    execFileSync(command, args, { encoding: "utf8" }).trim();

  console.log(`pnpm: ${run("pnpm", ["--version"])}`);
  console.log(`git: ${run("git", ["--version"])}`);
  console.log(
    `sg: ${run("pnpm", ["--filter", "@arxic/ast-grep-adapter", "exec", "sg", "--version"])}`,
  );

  const workerRequire = createRequire("/app/apps/worker/package.json");
  const contractsPath = workerRequire.resolve("@arxic/contracts");
  assert(contractsPath.startsWith("/app/packages/contracts/"));
  const workspacePackage = run("pnpm", [
    "--filter",
    "vulnerable-auth-app",
    "exec",
    "tsx",
    "-e",
    "import { PACKAGE_NAME } from \"@arxic/contracts\"; if (PACKAGE_NAME !== \"@arxic/contracts\") process.exit(1); process.stdout.write(PACKAGE_NAME)",
  ]);
  console.log(`workspace package: ${workspacePackage} (${contractsPath})`);

  const fixtureRequire = createRequire(
    "/app/test-fixtures/vulnerable-auth-app/package.json",
  );
  const Database = fixtureRequire("better-sqlite3");
  const database = new Database(":memory:");
  assert.equal(database.prepare("SELECT 1 AS value").get().value, 1);
  database.close();
  console.log("native module: better-sqlite3 loaded and queried");

  const sourceRequire = createRequire(
    "/app/packages/source-ua-adapter/package.json",
  );
  const Parser = sourceRequire("tree-sitter");
  const JavaScript = sourceRequire("tree-sitter-javascript");
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  assert.equal(parser.parse("const answer = 42;").rootNode.type, "program");
  console.log("native module: tree-sitter loaded and parsed JavaScript");

  const playwrightRequire = createRequire(
    "/app/packages/playwright-agent-adapter/package.json",
  );
  const { chromium } = playwrightRequire("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  console.log("playwright chromium: launched and closed headless");
'

docker run --rm --user 1000:1000 --tmpfs /tmp:rw,size=64m "${IMAGE_TAG}" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { execFileSync } from "node:child_process";
  import { createRequire } from "node:module";

  const [major, minor] = process.versions.node.split(".").map(Number);
  assert(
    major > 22 || (major === 22 && minor >= 22),
    `Node >=22.22 required, found ${process.version}`,
  );
  console.log(`non-root node: ${process.version}`);

  const run = (command, args) =>
    execFileSync(command, args, { encoding: "utf8" }).trim();

  console.log(`non-root pnpm: ${run("pnpm", ["--version"])}`);
  console.log(`non-root git: ${run("git", ["--version"])}`);
  console.log(
    `non-root sg: ${run("pnpm", ["--filter", "@arxic/ast-grep-adapter", "exec", "sg", "--version"])}`,
  );

  const workerRequire = createRequire("/app/apps/worker/package.json");
  const contractsPath = workerRequire.resolve("@arxic/contracts");
  assert(contractsPath.startsWith("/app/packages/contracts/"));
  const workspacePackage = run("pnpm", [
    "--filter",
    "vulnerable-auth-app",
    "exec",
    "tsx",
    "-e",
    "import { PACKAGE_NAME } from \"@arxic/contracts\"; if (PACKAGE_NAME !== \"@arxic/contracts\") process.exit(1); process.stdout.write(PACKAGE_NAME)",
  ]);
  console.log(`non-root workspace package: ${workspacePackage} (${contractsPath})`);

  const fixtureRequire = createRequire(
    "/app/test-fixtures/vulnerable-auth-app/package.json",
  );
  const Database = fixtureRequire("better-sqlite3");
  const database = new Database(":memory:");
  assert.equal(database.prepare("SELECT 1 AS value").get().value, 1);
  database.close();
  console.log("non-root native module: better-sqlite3 loaded and queried");

  const sourceRequire = createRequire(
    "/app/packages/source-ua-adapter/package.json",
  );
  const Parser = sourceRequire("tree-sitter");
  const JavaScript = sourceRequire("tree-sitter-javascript");
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  assert.equal(parser.parse("const answer = 42;").rootNode.type, "program");
  console.log("non-root native module: tree-sitter loaded and parsed JavaScript");

  const playwrightRequire = createRequire(
    "/app/packages/playwright-agent-adapter/package.json",
  );
  const { chromium } = playwrightRequire("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  await browser.close();
  console.log("non-root playwright chromium: launched and closed headless");
'

# Regression guard: the non-root toolchain must work under the sandbox's
# no-egress internal network. The B1 spike image installed pnpm through
# corepack, which re-fetches over the network per-uid and fails here; the
# system-wide install (npm i -g) has no such dependency. This block fails if a
# future Dockerfile change reintroduces a network-bound package-manager
# bootstrap.
noegress_net="arxic-verify-noegress-$$"
trap 'docker network rm "${noegress_net}" >/dev/null 2>&1 || true' EXIT
docker network create --internal "${noegress_net}" >/dev/null
docker run --rm --network "${noegress_net}" --user 1000:1000 "${IMAGE_TAG}" sh -c '
  pnpm --version &&
  pnpm --filter @arxic/ast-grep-adapter exec sg --version &&
  node -e "process.stdout.write(process.versions.node)" &&
  echo " no-egress toolchain OK"
'
