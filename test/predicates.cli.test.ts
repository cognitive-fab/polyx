// `polyx predicates <corpus>` (JT9). A predicate set is a reviewed artefact,
// and this is the surface that says what is declared and what is actually
// emitting — which, until somebody labels a sample, is nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { alphabetsDir, builtinPredicates, loadCorpus } from 'polyx-lens';
import { join } from 'node:path';
import { cmdPredicates, predicateFileFor, type Ctx } from '../src/cli/main.ts';
import { SYNTHETIC_ALPHABET, SYNTHETIC_SOURCE, tempWorkspace } from './helpers.ts';

function capture(ws: ReturnType<typeof tempWorkspace>): { ctx: Ctx; lines: string[] } {
  const lines: string[] = [];
  return { ctx: { config: ws.config, thresholds: ws.thresholds, out: (s) => lines.push(s), err: (s) => lines.push(s) }, lines };
}

/**
 * A corpus family that ships no predicate set. Made by renaming the synthetic
 * fixture's family, since every shipped family with text now has one.
 */
function familyWithoutPredicates(ws: ReturnType<typeof tempWorkspace>): void {
  const src = join(ws.dir, 'nopreds.json');
  writeFileSync(src, readFileSync(SYNTHETIC_SOURCE, 'utf8').replace('"corpus": "synthetic"', '"corpus": "nopreds"'));
  const alphabet = join(ws.dir, 'alphabet.nopreds.yaml');
  writeFileSync(alphabet, readFileSync(SYNTHETIC_ALPHABET, 'utf8').replace(/^corpus: synthetic$/m, 'corpus: nopreds'));
  ws.config.corpora.nopreds = { adapter: 'synthetic', source: src, alphabet };
}

test('a corpus with no predicate set says so, and says it changes nothing', async () => {
  const ws = tempWorkspace();
  try {
    familyWithoutPredicates(ws);
    const { ctx, lines } = capture(ws);
    // Observation is additive, and its absence is not an error (JF6.5).
    assert.equal(await cmdPredicates(ctx, 'nopreds', {}), 0);
    const out = lines.join('\n');
    assert.match(out, /no predicate set/);
    assert.match(out, /mines exactly as it does today/);
  } finally {
    ws.cleanup();
  }
});

test('the shipped synthetic set is STALE on the main fixture and real on the observable one', async () => {
  const ws = tempWorkspace();
  try {
    const { ctx, lines } = capture(ws);
    assert.equal(await cmdPredicates(ctx, 'synthetic', {}), 0);
    const main = lines.join('\n');
    // Calibrated against the observable fixture's revision, so inert here —
    // the staleness rule (JF3.5) doing what it is for, and saying so.
    assert.match(main, /STALE\s+states_double_charge/);
    assert.match(main, /declared 1, emitting 0, inert 1/);
    lines.length = 0;
    assert.equal(await cmdPredicates(ctx, 'synthetic-observable', {}), 0);
    const obs = lines.join('\n');
    assert.match(obs, /real\s+states_double_charge/);
    assert.match(obs, /declared 1, emitting 1, inert 0/);
  } finally {
    ws.cleanup();
  }
});

test('the predicate file is resolved by alphabet FAMILY, not by corpus name', async () => {
  const ws = tempWorkspace();
  try {
    const main = await loadCorpus(ws.config, 'synthetic');
    const obs = await loadCorpus(ws.config, 'synthetic-observable');
    // Two corpora, one family, one reviewed set — a second copy would exist
    // only to satisfy a filename, and two copies drift.
    assert.equal(predicateFileFor(main), join(alphabetsDir(), 'predicates.synthetic.yaml'));
    assert.equal(predicateFileFor(obs), predicateFileFor(main));
    assert.equal(builtinPredicates('cc'), join(alphabetsDir(), 'predicates.cc.yaml'));
    assert.equal(builtinPredicates('abcd'), null, 'nothing is declared for abcd yet');
  } finally {
    ws.cleanup();
  }
});
