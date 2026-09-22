#!/usr/bin/env node
// The shipping check (LICENSING.md). `check-boundary.mjs` proves no module
// READS an answer key; this proves the tree does not CONTAIN one.
//
// Those are different guarantees and only the second survives a `git archive`.
// The clause sets, the gold alignments and the decomposition scripts are the
// expensive half of the evaluation and the half a customer must never receive —
// so they live in a separate private checkout (`polyx-eval`), and their
// presence here is a packaging bug, not a preference.
//
// The one clause set that belongs in this tree is the synthetic fixture: its
// answers are already public in test/fixtures/synthetic/generate.mjs, so it
// gives nothing away and the tests need it to be self-contained.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', '.polyx', 'corpora', 'dist']);

/** A path that may hold an answer key, and what makes it one. */
const FORBIDDEN = [
  { test: (p) => p.split(sep)[0] === 'policies', why: 'the clause sets live in polyx-eval, not here' },
  { test: (p) => /-gold\.yaml$/.test(p), why: 'a gold alignment is a human-rated answer key' },
  { test: (p) => /-guidelines\.yaml$/.test(p), why: 'a decomposed rulebook is an answer key' },
  { test: (p) => /decompose-.*-guidelines\.mjs$/.test(p), why: 'the decomposition scripts live with what they produce' },
];

/**
 * Nothing in this tree may be a clause set any more. The synthetic oracle's
 * clause set went to polyx-lens with the corpus it describes, so the exception
 * that used to sit here has no file left to cover.
 */
const ALLOWED = [];

const found = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    const rel = relative(ROOT, full);
    if (statSync(full).isDirectory()) {
      const hit = FORBIDDEN.find((f) => f.test(rel));
      if (hit) found.push({ rel, why: hit.why });
      else walk(full);
      continue;
    }
    if (ALLOWED.includes(rel)) continue;
    const hit = FORBIDDEN.find((f) => f.test(rel));
    if (hit) found.push({ rel, why: hit.why });
  }
};
walk(ROOT);

if (found.length) {
  console.error('shippable check: this tree contains evaluation input and must not be distributed');
  for (const f of found) console.error(`  ${f.rel} — ${f.why}`);
  console.error('move it to the polyx-eval checkout, or add it to ALLOWED with a reason it is publishable');
  process.exit(1);
}
console.log('shippable ok — no answer key in the tree');
