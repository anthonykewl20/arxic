# `@arxic/source-ua-adapter`

Deterministic TypeScript/JavaScript source indexing behind the frozen
`SourceIndexer` contract. This package adapts a reviewed minimal scanner and
structural-extraction subset from
[Understand Anything](https://github.com/Egonex-AI/Understand-Anything/tree/fe8c5bc591716aafd79b4765549328f08ef5a52e),
rather than importing its internals or copying the project wholesale.

## Seams

- Git resolves a full commit, rejects shallow/no-commit inputs, reports dirty
  paths, and enumerates tracked plus non-ignored untracked files bytewise.
- The manifest hashes raw working-tree bytes and classifies language/category,
  binary files, and quota violations.
- Native `tree-sitter` with separately packaged TypeScript/TSX and
  JavaScript/JSX grammars extracts symbols, imports, calls, Next.js App Router
  file-convention routes, and Express route registrations.
- Every source claim is a frozen `EvidenceRef`; dirty-file bytes never receive
  committed provenance. Gaps are frozen-contract-valid, blocked diagnostics.

`SourceScanPolicy` owns fail-closed quotas, supported languages, extra ignores,
and failure classification. The adapter itself remains a service-layer
capability block; future Actions select policy and orchestrate dispositions.

`collect()` adds a manifest, resolved revision, pinned tool versions, and one
explicit `generatedAt` field. With that timestamp removed, canonical JSON uses
sorted object keys and stable event/file ordering, so identical repository
state and tool versions produce byte-identical normalized evidence.

The `ADR §23.14 SourceIndexer engine-upgrade contract gate` test must pass
before replacing or upgrading the parser engine. Integration tests run the real
native parser against both real fixture-app source trees. A separate test checks
that each installed grammar package declares MIT and ships its own `LICENSE`.
