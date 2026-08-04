#!/usr/bin/env bash
set -euo pipefail

# gears/ is reference-only and gitignored. This script fetches upstream code at
# pinned commits for local study and refresh. It does not vendor anything into the
# repo; provenance + LICENSE texts are stored in docs/gears/.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEARS_DIR="${ROOT_DIR}/gears"
mkdir -p "$GEARS_DIR"

success_count=0
fail_count=0
skip_count=0

log() {
  printf '%s\n' "$*"
}

note_ok() {
  log "  [ok] $1"
  success_count=$((success_count + 1))
}

note_skip() {
  log "  [skip] $1"
  skip_count=$((skip_count + 1))
}

note_fail() {
  log "  [fail] $1"
  fail_count=$((fail_count + 1))
}

fetch_raw() {
  local owner=$1
  local repo=$2
  local ref=$3
  local path=$4
  local dest=$5

  mkdir -p "$(dirname "$dest")"
  if curl -fsSL "https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}" -o "$dest"; then
    return 0
  fi

  return 1
}

clone_shallow() {
  local owner=$1
  local repo=$2
  local dest=$3

  rm -rf "$dest"
  git clone --depth 1 "https://github.com/${owner}/${repo}.git" "$dest"
}

cleanup_clone() {
  local repo_dir=$1
  rm -rf "$repo_dir/.git" "$repo_dir/node_modules" "$repo_dir/dist" "$repo_dir/build"
}

fetch_src_files() {
  local owner=$1
  local repo=$2
  local ref=$3
  local gear_root=$4
  local -n paths=$5

  for path in "${paths[@]}"; do
    local dest="$gear_root/$path"
    if fetch_raw "$owner" "$repo" "$ref" "$path" "$dest"; then
      note_ok "${gear_root##*/}: ${path}"
    else
      note_fail "${gear_root##*/}: failed to fetch ${path}"
    fi
  done
}

fetch_tree_match() {
  local owner=$1
  local repo=$2
  local ref=$3
  local needle=$4

  local tree_json
  tree_json="$(curl -fsSL "https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1")"

  printf '%s\n' "$tree_json" \
    | grep -oE '"path":"[^"]+"' \
    | sed -E 's/"path":"(.*)"/\1/' \
    | grep -F "$needle" \
    | head -n 1
}

clone_gear_repo() {
  local name=$1
  local owner=$2
  local repo=$3
  local dest="$GEARS_DIR/$name/repo"

  if clone_shallow "$owner" "$repo" "$dest"; then
    cleanup_clone "$dest"
    note_ok "${name}: shallow clone"
  else
    note_fail "${name}: clone failed"
  fi
}

fetch_license_and_readme() {
  local owner=$1
  local repo=$2
  local ref=$3
  local name=$4

  local ok=true
  if ! fetch_raw "$owner" "$repo" "$ref" "LICENSE" "$GEARS_DIR/$name/LICENSE"; then
    note_fail "$name: LICENSE failed"
    ok=false
  else
    note_ok "$name: LICENSE"
  fi

  if ! fetch_raw "$owner" "$repo" "$ref" "README.md" "$GEARS_DIR/$name/README.md"; then
    note_fail "$name: README.md failed"
    ok=false
  else
    note_ok "$name: README.md"
  fi

  if [[ "$ok" = true ]]; then
    return 0
  fi
  return 1
}

fetch_understand_anything() {
  local name=understand-anything
  local owner=Egonex-AI
  local repo=Understand-Anything
  local ref=fe8c5bc591716aafd79b4765549328f08ef5a52e
  local gear_root="$GEARS_DIR/$name/src"

  local -a paths=(
    "understand-anything-plugin/skills/understand/scan-project.mjs"
    "understand-anything-plugin/skills/understand/extract-structure.mjs"
    "understand-anything-plugin/skills/understand/extract-structure-result.mjs"
    "understand-anything-plugin/skills/understand/compute-batches.mjs"
    "understand-anything-plugin/packages/core/src/plugins/tree-sitter-plugin.ts"
    "understand-anything-plugin/packages/core/src/extractors/typescript-extractor.ts"
    "understand-anything-plugin/packages/core/src/languages/framework-registry.ts"
    "understand-anything-plugin/agents/domain-analyzer.md"
    "understand-anything-plugin/skills/understand-domain/extract-domain-context.py"
  )

  fetch_src_files "$owner" "$repo" "$ref" "$gear_root" paths
}

fetch_archify() {
  local name=archify
  local owner=tt-a1i
  local repo=archify
  local ref=2c1f8ac2ca28a26d0b68043ec80c9554e20ff0e3

  local -a paths=(
    "archify/renderers/shared/validator.mjs"
    "archify/renderers/shared/repository-evidence.mjs"
    "archify/references/delivery-contract.md"
  )

  fetch_src_files "$owner" "$repo" "$ref" "$GEARS_DIR/$name/src" paths
  if clone_shallow "$owner" "$repo" "$GEARS_DIR/$name/repo"; then
    cleanup_clone "$GEARS_DIR/$name/repo"
    note_ok "${name}: shallow clone of repository"
  else
    note_fail "${name}: clone failed"
  fi
}

fetch_playwright() {
  local name=playwright
  local owner=microsoft
  local repo=playwright
  local ref=1720c55cfaddfb01a5bb4c9ddf43e42053811a25

  local -a paths=(
    "packages/playwright/src/mcp/test/plannerTools.ts"
    "packages/playwright/src/mcp/test/generatorTools.ts"
    "packages/playwright/src/mcp/test/testTools.ts"
    "packages/playwright/src/mcp/test/testContext.ts"
    "packages/playwright/src/mcp/test/seed.ts"
    "packages/playwright/src/mcp/test/testBackend.ts"
    "packages/playwright/src/agents/playwright-test-healer.agent.md"
    "packages/playwright/src/agents/playwright-test-generator.agent.md"
    "packages/playwright/src/agents/playwright-test-planner.agent.md"
  )

  fetch_src_files "$owner" "$repo" "$ref" "$GEARS_DIR/$name/src" paths
}

fetch_crawlee() {
  local name=crawlee
  local owner=apify
  local repo=crawlee
  local ref=5401ab9770bd2e2e5629316c8b2a7690c39e8096

  if ! fetch_license_and_readme "$owner" "$repo" "$ref" "$name"; then
    note_skip "$name: metadata fetch had errors"
  fi

  local tree_path
  local tree_json
  if ! tree_json="$(curl -fsSL "https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1")"; then
    note_fail "$name: tree API request failed"
    return
  fi

  local -a symbols=(PlaywrightCrawler RequestQueue SessionPool Router)
  for symbol in "${symbols[@]}"; do
    tree_path="$(printf '%s\n' "$tree_json" | grep -oE '"path":"[^"]+"' | sed -E 's/"path":"(.*)"/\1/' | grep -F "$symbol" | head -n 1)"
    if [[ -z "$tree_path" ]]; then
      note_skip "$name: no tree path found for ${symbol}"
      continue
    fi
    if fetch_raw "$owner" "$repo" "$ref" "$tree_path" "$GEARS_DIR/$name/src/$tree_path"; then
      note_ok "$name: src/${tree_path}"
    else
      note_fail "$name: failed to fetch ${tree_path}"
    fi
  done
}

fetch_ast_grep() {
  local name=ast-grep
  local owner=ast-grep
  local repo=ast-grep
  local ref=96c6792b51567ad7f35151027c0e5c0679270303

  if ! fetch_license_and_readme "$owner" "$repo" "$ref" "$name"; then
    note_skip "$name: metadata fetch had errors"
  fi

  local tree_json
  if ! tree_json="$(curl -fsSL "https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1")"; then
    note_fail "$name: tree API request failed"
    return
  fi

  mapfile -t napi_paths < <(
    printf '%s\n' "$tree_json" \
      | grep -oE '"path":"crates/napi/[^\"]+"' \
      | sed -E 's/"path":"(.*)"/\1/' \
      | grep -E '\.(ts|d\.ts|js)$' \
      | head -n 10
  )

  if (( ${#napi_paths[@]} == 0 )); then
    note_skip "$name: no crates/napi matches found in tree"
    return
  fi

  for file_path in "${napi_paths[@]}"; do
    if fetch_raw "$owner" "$repo" "$ref" "$file_path" "$GEARS_DIR/$name/src/$file_path"; then
      note_ok "$name: src/$file_path"
    else
      note_fail "$name: failed to fetch ${file_path}"
    fi
  done
}

fetch_clone_only() {
  local name=$1
  local owner=$2
  local repo=$3

  if ! clone_shallow "$owner" "$repo" "$GEARS_DIR/$name/repo"; then
    note_fail "$name: shallow clone failed"
    return
  fi
  cleanup_clone "$GEARS_DIR/$name/repo"
  note_ok "$name: shallow clone"
}

fetch_fetch_only() {
  local name=$1
  local owner=$2
  local repo=$3
  local ref=${4:-HEAD}

  if ! fetch_license_and_readme "$owner" "$repo" "$ref" "$name"; then
    note_skip "$name: metadata fetch had errors"
  fi
}

run_all() {
  fetch_understand_anything
  fetch_archify
  fetch_playwright
  fetch_crawlee
  fetch_ast_grep

  fetch_clone_only graphology graphology graphology
  fetch_clone_only langgraph langchain-ai langgraphjs
  fetch_clone_only ajv-validator ajv
  fetch_clone_only testcontainers testcontainers testcontainers-node
  fetch_clone_only mailpit axllent mailpit
  fetch_clone_only otplib yeojz otplib
  fetch_clone_only tree-sitter tree-sitter tree-sitter

  fetch_fetch_only midscene web-infra-dev midscene HEAD
  fetch_fetch_only stagehand browserbase stagehand HEAD
  fetch_fetch_only scip scip-code scip HEAD
  fetch_fetch_only scip-typescript sourcegraph scip-typescript HEAD
  fetch_fetch_only testzeus-hercules test-zeus-ai testzeus-hercules HEAD
}

print_summary() {
  log ""
  log "fetch summary"
  log "  fetched: ${success_count}"
  log "  skipped: ${skip_count}"
  log "  failed:  ${fail_count}"
}

main() {
  local target=${1:-all}

  case "$target" in
    all)
      run_all
      ;;
    understand-anything)
      fetch_understand_anything
      ;;
    archify)
      fetch_archify
      ;;
    playwright)
      fetch_playwright
      ;;
    crawlee)
      fetch_crawlee
      ;;
    ast-grep)
      fetch_ast_grep
      ;;
    graphology)
      fetch_clone_only graphology graphology graphology
      ;;
    langgraph)
      fetch_clone_only langgraph langchain-ai langgraphjs
      ;;
    ajv)
      fetch_clone_only ajv-validator ajv
      ;;
    testcontainers)
      fetch_clone_only testcontainers testcontainers testcontainers-node
      ;;
    mailpit)
      fetch_clone_only mailpit axllent mailpit
      ;;
    otplib)
      fetch_clone_only otplib yeojz otplib
      ;;
    tree-sitter)
      fetch_clone_only tree-sitter tree-sitter tree-sitter
      ;;
    midscene)
      fetch_fetch_only midscene web-infra-dev midscene HEAD
      ;;
    stagehand)
      fetch_fetch_only stagehand browserbase stagehand HEAD
      ;;
    scip)
      fetch_fetch_only scip scip-code scip HEAD
      ;;
    scip-typescript)
      fetch_fetch_only scip-typescript sourcegraph scip-typescript HEAD
      ;;
    testzeus-hercules)
      fetch_fetch_only testzeus-hercules test-zeus-ai testzeus-hercules HEAD
      ;;
    *)
      log "Usage: $0 [all|understand-anything|archify|playwright|crawlee|ast-grep|graphology|langgraph|ajv|testcontainers|mailpit|otplib|tree-sitter|midscene|stagehand|scip|scip-typescript|testzeus-hercules]"
      return 1
      ;;
  esac

  print_summary
}

main "$@"
