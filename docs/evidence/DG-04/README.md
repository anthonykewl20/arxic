# DG-04 evidence — model-driven intent proposal at scale

Real-endpoint artifacts produced on 2026-08-16 by
`packages/intent-proposal-spike/scripts/run-scale-matrix.ts` and the
env-gated real-model test. Endpoint: OpenRouter (OpenAI-compatible,
`https://openrouter.ai/api/v1`), model `openai/gpt-4o-mini`. The API key was
supplied via environment only; every artifact passed
`sanitizeArtifactJson` before writing, and a post-run scan for the live key
over this directory returned zero hits.

- `scale-matrix.json` — directus scale run: 272 route rows / 80 domain hints
  at commit `cb846b6a1ddc4811359bc52b74bb31a42eab33db` (cloned blobless to
  `/tmp/opencode/directus`, outside the repo). Both strategies (per-domain,
  one-shot) with per-call tokens/latency, coverage, dedupe, cost lines, and
  12 sanitized proposal samples per strategy.
- `inventory-summary.json` — first 400 stand-in inventory rows of the same
  scan (stable ids, domain hints, evidence ids).
- `real-model-probe.json` — fixture-scale single-call probe through the full
  ModelAdapter + proposer path (425 prompt / 245 completion tokens, 2
  grounded proposals).

Numbers and interpretation: `docs/spikes/dg-04-model-proposal.md` §5.
