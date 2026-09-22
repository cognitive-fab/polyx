// Recommendation rules (TS §7.3, F4.2): decision points, bounded antecedent
// search, the two figures, and the negative result when nothing clears.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Rule } from '@cognitive-fab/polyx-lens';
import { consequentialTypes } from '@cognitive-fab/polyx-lens';
import { mine } from '../src/mine/index.ts';
import { decisionPoints, synthesiseRecommendations } from '../src/mine/recommend.ts';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { naiveExtractor } from '@cognitive-fab/polyx-lens';
import { Advisor } from '../src/serve/advisor.ts';
import { tempWorkspace } from './helpers.ts';

test('decision points: one per episode, the first consequential action, with what was known before it', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
    const points = decisionPoints(subjects);
    assert.equal(points.length, 46);
    const p = points.find((x) => x.interactionId === 'syn-0001')!;
    assert.equal(p.action, 'action:issue_refund');
    assert.equal(p.facts['episode.intent'], 'intent:refund_request');
    assert.equal(p.facts['slot.order_id'], 'ORD-1000');
    assert.equal(p.good, true);
    const esc = points.find((x) => x.interactionId === 'syn-0037')!;
    assert.equal(esc.action, 'action:offer_credit', 'offer-credit comes before escalate');
    assert.equal(esc.good, false);
  } finally {
    ws.cleanup();
  }
});

test('the planted recommendations are found, with agreement and outcome as two separate figures', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const recs = result.rules.filter((r) => r.family === 'recommendation');
    assert.ok(recs.length >= 4);
    const refund = recs.find((r) => r.scope === 'op-alpha' && r.bindings.action === 'action:issue_refund' && r.conditions.length === 1 && r.conditions[0]!.fact === 'episode.intent')!;
    assert.ok(refund, 'intent:refund_request → issue a refund');
    assert.deepEqual(refund.support, { holds: 14, of: 14 });
    assert.deepEqual(refund.outcomeSupport, { holds: 14, of: 14 });
    assert.equal(refund.status, 'proposed');
    assert.match(refund.text, /^When episode\.intent = intent:refund_request, issue a refund\.$/);
    assert.equal(refund.window, 'episode');
    assert.equal(refund.pattern, 'antecedent-implies-action');
    // the faithfully mined mistake: complaint → offer credit is what was done (5/5), and it ended badly every time
    const credit = recs.find((r) => r.scope === 'op-alpha' && r.bindings.action === 'action:offer_credit')!;
    assert.deepEqual(credit.support, { holds: 5, of: 5 });
    assert.deepEqual(credit.outcomeSupport, { holds: 0, of: 5 });
    assert.match(credit.evidence, /good outcome 0 of 5 times/);
    // no rule sprouts a longer antecedent than it needs
    for (const r of recs) assert.ok(r.conditions.length <= 2, r.text);
    assert.ok(result.stats.recommendations >= 4);
    assert.equal(result.stats.decisionPoints, 46);
  } finally {
    ws.cleanup();
  }
});

test('the negative result is a finding: nothing clears the floor when no fact discriminates', () => {
  // Every action proposable. The gate's CLOSED state is exercised in its own
  // test below ('an action declared not recommendable...'); these tests are
  // about the search.
  const ALL: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

  const t = { minInstances: 5, recommendAgreement: 0.8, recommendGain: 0.05, antecedentMaxLength: 3 } as Parameters<typeof synthesiseRecommendations>[1];
  const points = Array.from({ length: 20 }, (_, i) => ({
    episodeId: `e${i}`,
    interactionId: `i${i}`,
    facts: { 'customer.tier': i % 2 ? 'a' : 'b' },
    action: i % 4 < 2 ? 'action:x' : 'action:y', // 50/50 within each tier
    instance: {} as never,
    good: null,
  }));
  assert.deepEqual(synthesiseRecommendations(points, t, (x) => x, ALL).rules, []);
  // and the shortest sufficient antecedent wins when one does discriminate
  const decisive = points.map((p, i) => ({ ...p, facts: { ...p.facts, 'episode.intent': i % 2 ? 'intent:p' : 'intent:q' }, action: i % 2 ? 'action:x' : 'action:y' }));
  const recs = synthesiseRecommendations(decisive, t, (x) => x, ALL).rules;
  assert.deepEqual(
    recs.map((r) => [r.conditions.map((c) => `${c.fact}=${String(c.value)}`).join('&'), r.action, r.agreement]),
    [
      ['customer.tier=a', 'action:x', { holds: 10, of: 10 }],
      ['customer.tier=b', 'action:y', { holds: 10, of: 10 }],
      ['episode.intent=intent:p', 'action:x', { holds: 10, of: 10 }],
      ['episode.intent=intent:q', 'action:y', { holds: 10, of: 10 }],
    ],
  );
});

test('an action declared not recommendable is never proposed, and the loss is counted (ACV 6.4)', () => {
  const t = { minInstances: 5, recommendAgreement: 0.8, recommendGain: 0.05, antecedentMaxLength: 3 } as Parameters<typeof synthesiseRecommendations>[1];
  const points = Array.from({ length: 20 }, (_, i) => ({
    episodeId: `e${i}`,
    interactionId: `i${i}`,
    facts: { 'episode.intent': i % 2 ? 'intent:p' : 'intent:q' },
    action: i % 2 ? 'action:x' : 'action:y',
    instance: {} as never,
    good: null,
  }));
  const open = new Set(['action:x', 'action:y']);
  const shut = new Set(['action:x']); // action:y is not recommendable

  const both = synthesiseRecommendations(points, t, (x) => x, open);
  assert.deepEqual(both.rules.map((r) => r.action).sort(), ['action:x', 'action:y']);
  assert.deepEqual(both.withheld, []);

  const gated = synthesiseRecommendations(points, t, (x) => x, shut);
  assert.deepEqual(gated.rules.map((r) => r.action), ['action:x'], 'the withheld action is not proposed');
  // …and it is not simply dropped: a policy decision that removes a rule has
  // to leave a record, the way every other suppression in the miner does.
  assert.deepEqual(gated.withheld, [{ action: 'action:y', candidates: 1 }]);
});

test('the advisor withholds a real recommendation whose action stopped being recommendable (ACV 8.3)', () => {
  const rec: Rule = {
    id: 'r',
    family: 'recommendation',
    pattern: 'antecedent-implies-action',
    bindings: { action: 'action:quote_rate' },
    conditions: [],
    window: 'episode',
    support: { holds: 9, of: 10 },
    corpusSupport: { holds: 9, of: 10 },
    counterexamples: [],
    examples: [],
    provenance: { kind: 'own', level: 'operator', scope: 'op' },
    status: 'real', // adjudicated real by a human
    predicates: { js: '(facts) => "action:quote_rate"' },
    alphabetVersion: 2,
    minedAt: 0,
    text: '',
    evidence: '',
    corpus: 'c',
    scope: 'op',
  };
  // The alphabet, not the stored verdict, is the authority: a rule a human
  // approved is still withheld once the policy declaration says otherwise.
  const served = new Advisor([rec], new Set(['action:quote_rate']));
  assert.equal(served.served, 1);
  assert.equal(served.withheld, 0);

  const gated = new Advisor([rec], new Set<string>());
  assert.equal(gated.served, 0, 'not served');
  assert.equal(gated.withheld, 1, 'and the conflict between the human verdict and the policy is counted');
  const answer = gated.advise({ operator: 'op', episode: { events: [] }, facts: {} });
  assert.notEqual(answer.verdict, 'recommend');
});

test('--no-recommend leaves the obligation set unchanged and reports zero decision points', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const withRecs = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const without = await mine(corpus, ws.thresholds, { minedAt: 1, recommend: false });
    assert.equal(without.rules.filter((r) => r.family === 'recommendation').length, 0);
    assert.deepEqual(
      without.rules.map((r) => r.id + r.scope),
      withRecs.rules.filter((r) => r.family === 'obligation').map((r) => r.id + r.scope),
    );
    assert.equal(without.stats.decisionPoints, 0);
  } finally {
    ws.cleanup();
  }
});
