# Evaluation input — the answer key

Policy clause sets and guideline files live here and **nowhere else**. This directory is evaluation input: the thing polyx is tested against, never something it may learn from.

`scripts/check-boundary.mjs` fails the build if any module outside `src/evaluate`, `src/diff` or `src/cli` imports from this directory or names a `guidelines`/`policies/` path. A failure there is a correctness bug, not hygiene — every number produced since the leak is suspect.

Hand-decomposed clause sets are committed under `/policies/` at the repository root (TS §9.1); this directory holds the loaders and the alignment tooling that read them.
