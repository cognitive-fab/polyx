// Two corpora that share an operator name (τ² retail under two backbones)
// must keep separate rows for the same rule identity: the row key is
// (id, corpus, scope), not (id, scope).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Manifest, type Rule } from 'polyx-lens';
import { openStore } from '../src/store/db.ts';
import { adjudicate, loadRule, loadRules, persistMined } from '../src/store/rules.ts';
import { THRESHOLDS } from 'polyx-lens';

const rule = (corpus: string, holds: number): Rule => ({
  id: 'same-identity',
  family: 'obligation',
  pattern: 'X-implies-prior-Y',
  bindings: { subject: 'action:x', guard: 'action:y' },
  conditions: [],
  window: 'episode',
  support: { holds, of: 10 },
  corpusSupport: { holds, of: 10 },
  counterexamples: [],
  examples: [],
  provenance: { kind: 'own', level: 'operator', scope: 'op' },
  status: 'proposed',
  predicates: { js: '' },
  alphabetVersion: 1,
  minedAt: 0,
  text: 'x after y',
  evidence: '',
  corpus,
  scope: 'op',
});

const manifest = (corpus: string, runId: string): Manifest => ({
  runId,
  command: 'mine',
  at: 1,
  corpus,
  corpusRevision: 'r',
  alphabetVersion: 1,
  alphabetFile: 'a.yaml',
  thresholds: THRESHOLDS,
  seed: 1,
  codeCommit: null,
  segmenter: 'null',
});

test('the same rule for two corpora sharing an operator is two rows with independent status', () => {
  const store = openStore(':memory:');
  const insertRun = store.prepare("INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json) VALUES (?, 'mine', 1, ?, 'r', 1, '{}', 1, NULL, '{}')");
  insertRun.run('run-a', 'corpus-a');
  insertRun.run('run-b', 'corpus-b');
  persistMined(store, manifest('corpus-a', 'run-a'), [rule('corpus-a', 10)], [], THRESHOLDS);
  persistMined(store, manifest('corpus-b', 'run-b'), [rule('corpus-b', 6)], [], THRESHOLDS);
  assert.equal(loadRules(store, { corpus: 'corpus-a' }).length, 1);
  assert.equal(loadRules(store, { corpus: 'corpus-b' }).length, 1);
  assert.deepEqual(loadRule(store, 'same-identity', 'op', 'corpus-a')!.support, { holds: 10, of: 10 });
  assert.deepEqual(loadRule(store, 'same-identity', 'op', 'corpus-b')!.support, { holds: 6, of: 10 });
  assert.throws(() => loadRule(store, 'same-identity', 'op'), /2 rows/);
  adjudicate(store, 'same-identity', 'real', { scope: 'op', corpus: 'corpus-a' });
  assert.equal(loadRule(store, 'same-identity', 'op', 'corpus-a')!.status, 'real');
  assert.equal(loadRule(store, 'same-identity', 'op', 'corpus-b')!.status, 'proposed');
  // re-mining corpus-a leaves corpus-b's row untouched
  const stats = persistMined(store, manifest('corpus-a', 'run-a'), [rule('corpus-a', 9)], [], THRESHOLDS);
  assert.equal(stats.kept, 1);
  assert.equal(stats.retired, 0);
  assert.deepEqual(loadRule(store, 'same-identity', 'op', 'corpus-b')!.support, { holds: 6, of: 10 });
  store.close();
});
