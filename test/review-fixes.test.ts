// Regression tests for the Phase 1–6 review findings.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Rule } from '@cognitive-fab/polyx-lens';
import { evalCondition } from '@cognitive-fab/polyx-lens';
import { bpicAdapter } from '@cognitive-fab/polyx-lens';
import { cmdMine, cmdReview, recordRun } from '../src/cli/main.ts';
import { synthesiseRecommendations } from '../src/mine/recommend.ts';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { Advisor } from '../src/serve/advisor.ts';
import { openStore } from '../src/store/db.ts';
import { adjudicate, adjudications, loadRules } from '../src/store/rules.ts';
import { capture, tempWorkspace } from './helpers.ts';

test('a free-text note that starts with a brace is a note, not a narrowing', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const store = openStore(ws.config.dbPath);
    const r = loadRules(store, { corpus: 'synthetic', scope: 'op-alpha', status: ['proposed'] })[0]!;
    adjudicate(store, r.id, 'real', { scope: 'op-alpha', corpus: 'synthetic', note: '{see ticket 42}' });
    const a = adjudications(store, r.id, 'op-alpha', 'synthetic');
    assert.equal(a[0]!.note, '{see ticket 42}');
    assert.equal(a[0]!.condition, undefined);
    store.close();
    const out = capture();
    await cmdReview({ ...ctx, out: out.out }, 'synthetic', ['pace'], {});
    assert.match(out.text(), /1 verdict/);
  } finally {
    ws.cleanup();
  }
});

test('a typed condition value matches a string fact of the same form', () => {
  assert.equal(evalCondition({ fact: 'order.num_products', op: 'eq', value: 1 }, { 'order.num_products': '1' }), true);
  assert.equal(evalCondition({ fact: 'order.num_products', op: 'eq', value: '1' }, { 'order.num_products': 1 }), true);
  assert.equal(evalCondition({ fact: 'order.num_products', op: 'neq', value: 1 }, { 'order.num_products': '1' }), false);
  assert.equal(evalCondition({ fact: 'order.num_products', op: 'eq', value: 2 }, { 'order.num_products': '1' }), false);
  assert.equal(evalCondition({ fact: 'x', op: 'eq', value: 1 }, {}), 'unknown');
});

test('the advisor refuses a real rule whose pattern it cannot check, rather than clearing it', () => {
  const r: Rule = {
    id: 'weird',
    family: 'obligation',
    pattern: 'response(X, Y)',
    bindings: { subject: 'a', guard: 'b' },
    conditions: [],
    window: 'episode',
    support: { holds: 1, of: 1 },
    corpusSupport: { holds: 1, of: 1 },
    counterexamples: [],
    examples: [],
    provenance: { kind: 'own', level: 'operator', scope: 'op' },
    status: 'real',
    predicates: { js: '' },
    alphabetVersion: 1,
    minedAt: 0,
    text: '',
    evidence: '',
    corpus: 'c',
    scope: 'op',
  };
  assert.throws(() => new Advisor([r], new Set(['action:quote_rate'])), /cannot evaluate pattern/);
  assert.doesNotThrow(() => new Advisor([{ ...r, status: 'proposed' }], new Set(['action:quote_rate'])));
});

test('a longer antecedent never survives beside a strictly better subset the search skipped', () => {
  // Every action proposable. The gate's CLOSED state is exercised in its own
  // test below ('an action declared not recommendable...'); these tests are
  // about the search.
  const ALL: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

  const t = { minInstances: 5, recommendAgreement: 0.8, recommendGain: 0.05, antecedentMaxLength: 3 } as Parameters<typeof synthesiseRecommendations>[1];
  // c=1 alone explains X at 19/20; a=0 ∧ b=0 ∧ c=1 would be 5/6 without the subset check
  const points = Array.from({ length: 40 }, (_, i) => ({
    episodeId: `e${i}`,
    interactionId: `i${i}`,
    facts: { a: i % 4 === 0 ? 0 : 1, b: i % 4 === 0 ? 0 : 1, c: i % 2 },
    action: i % 2 === 1 ? (i === 39 ? 'action:y' : 'action:x') : i % 8 === 0 ? 'action:x' : 'action:y',
    instance: {} as never,
    good: null,
  }));
  const recs = synthesiseRecommendations(points, t, (x) => x, ALL).rules;
  const texts = recs.map((r) => r.conditions.map((c) => `${c.fact}=${c.value}`).join('&') + '→' + r.action);
  assert.ok(texts.includes('c=1→action:x'), texts.join(', '));
  assert.ok(!texts.some((x) => x.includes('c=1') && x.includes('&')), `no extension of c=1 survives: ${texts.join(', ')}`);
});

test('a missing gz source rejects cleanly instead of crashing the process', async () => {
  await assert.rejects(() => bpicAdapter.read(join('C:/', 'no', 'such', 'file.xes.gz')), /ENOENT/);
});

test('the persisted manifest carries the policy revision for evaluate and diff runs', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const store = openStore(ws.config.dbPath);
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    const m = recordRun(store, ctx, 'evaluate', corpus, { policyRevision: 'abc' });
    const row = store.prepare('SELECT manifest_json FROM runs WHERE id = ?').get(m.runId) as { manifest_json: string };
    assert.equal((JSON.parse(row.manifest_json) as { policyRevision?: string }).policyRevision, 'abc');
    store.close();
  } finally {
    ws.cleanup();
  }
});
