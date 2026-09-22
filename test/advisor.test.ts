// The advisor (TS §8): three-valued evaluation, the abstention contract, the
// HTTP surface, the decision-point log, the replay, and the 500-rule p95.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Rule } from 'polyx-lens';
import { cmdCoverage, cmdMine } from '../src/cli/main.ts';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from 'polyx-lens';
import { Advisor, factsAt, parseRequest, type AdviseRequest } from '../src/serve/advisor.ts';
import { replay } from '../src/serve/coverage.ts';
import { startAdvisorServer } from '../src/serve/http.ts';
import { openStore } from '../src/store/db.ts';
import { adjudicate, loadRules } from '../src/store/rules.ts';
import { recordRun } from '../src/cli/main.ts';
import { capture, tempWorkspace } from './helpers.ts';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r',
  family: 'obligation',
  pattern: 'X-implies-prior-Y',
  bindings: { subject: 'action:quote_rate', guard: 'action:disclose_terms' },
  conditions: [],
  window: 'episode',
  support: { holds: 41, of: 47 },
  corpusSupport: { holds: 41, of: 47 },
  counterexamples: [],
  examples: [],
  provenance: { kind: 'own', level: 'team', scope: 't1' },
  status: 'real',
  predicates: { js: '' },
  alphabetVersion: 1,
  minedAt: 0,
  text: 'Before you quote a rate, disclose the terms.',
  evidence: 'held 41 of 47 times',
  corpus: 'synthetic',
  scope: 'op',
  ...over,
});

const req = (over: Partial<AdviseRequest>): AdviseRequest => ({ operator: 'op', episode: { events: [] }, ...over });

// Every action proposable. The ACV 6.4 gate's CLOSED state is exercised in
// recommend.test.ts; these tests are about evaluation semantics.
const ANY: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

test('F6.3 — the single most important test: removing a required fact produces abstain, not a changed answer', () => {
  const conditioned = rule({ id: 'c', conditions: [{ fact: 'product.type', op: 'eq', value: 'mortgage' }] });
  const advisor = new Advisor([conditioned], ANY);
  // fact present and true, guard absent → warn
  const withFact = advisor.advise(req({ facts: { 'product.type': 'mortgage' }, considering: 'action:quote_rate' }));
  assert.equal(withFact.verdict, 'warn');
  assert.equal(withFact.warnings[0]!.unsatisfied, 'action:disclose_terms');
  // fact present and false → the rule does not apply → uncovered
  const other = advisor.advise(req({ facts: { 'product.type': 'savings' }, considering: 'action:quote_rate' }));
  assert.equal(other.verdict, 'abstain');
  assert.equal(other.abstention!.reason, 'uncovered');
  // fact ABSENT → unknown_fact, naming it. Never a negative evaluation.
  const without = advisor.advise(req({ facts: {}, considering: 'action:quote_rate' }));
  assert.equal(without.verdict, 'abstain');
  assert.deepEqual(without.abstention, { reason: 'unknown_fact', missing: ['product.type'] });
  assert.equal(without.coverage.answered, false);
  // null is unknown too
  const nulled = advisor.advise(req({ facts: { 'product.type': null }, considering: 'action:quote_rate' }));
  assert.deepEqual(nulled.abstention, { reason: 'unknown_fact', missing: ['product.type'] });
});

test('warn only when the guard is missing; recommend from a real recommendation; served rules are real only (F6.4)', () => {
  const rec = rule({ id: 'rec', family: 'recommendation', pattern: 'antecedent-implies-action', bindings: { action: 'action:offer_credit' }, conditions: [{ fact: 'episode.intent', op: 'eq', value: 'intent:complaint' }] });
  const proposedOnly = rule({ id: 'p', status: 'proposed', bindings: { subject: 'action:escalate', guard: 'action:offer_credit' } });
  const advisor = new Advisor([rule({}), rec, proposedOnly], ANY);
  assert.equal(advisor.served, 2);
  // guard present, and the recommendation's intent condition is known-false → the obligation held → clear
  const ok = advisor.advise(req({ episode: { events: [{ type: 'intent:other', kind: 'customer_intent' }, { type: 'action:disclose_terms' }] }, considering: 'action:quote_rate' }));
  assert.equal(ok.verdict, 'clear');
  assert.equal(ok.cleared.length, 1);
  assert.equal(ok.coverage.answered, true);
  // nothing applies at all → uncovered
  const none = advisor.advise(req({ episode: { events: [{ type: 'intent:other', kind: 'customer_intent' }] }, considering: 'action:unknown_thing' }));
  assert.deepEqual(none.abstention, { reason: 'uncovered', missing: [] });
  // guard present but the intent unknown → the recommendation cannot be ruled out → unknown_fact
  const unk = advisor.advise(req({ episode: { events: [{ type: 'action:disclose_terms' }] }, considering: 'action:quote_rate' }));
  assert.deepEqual(unk.abstention, { reason: 'unknown_fact', missing: ['episode.intent'] });
  const r = advisor.advise(req({ episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent' }] } }));
  assert.equal(r.verdict, 'recommend');
  assert.deepEqual(r.actions.map((a) => a.type), ['action:offer_credit']);
  assert.equal(r.actions[0]!.rules[0]!.support, '41/47');
  assert.equal(r.actions[0]!.rules[0]!.provenance, 'own@team');
  assert.match(r.actions[0]!.rules[0]!.evidence, /^\/rules\/rec\/evidence/);
  // a proposed rule never fires
  const p = advisor.advise(req({ episode: { events: [] }, considering: 'action:escalate' }));
  assert.equal(p.verdict, 'abstain');
  // warnings take precedence over recommendations
  const both = advisor.advise(req({ episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent' }] }, considering: 'action:quote_rate' }));
  assert.equal(both.verdict, 'warn');
  assert.equal(both.actions.length, 1);
  // at-most-one
  const once = new Advisor([rule({ id: 'o', pattern: 'at-most-one-X', bindings: { subject: 'action:quote_rate' } })], ANY);
  assert.equal(once.advise(req({ episode: { events: [{ type: 'action:quote_rate' }] }, considering: 'action:quote_rate' })).verdict, 'warn');
  assert.equal(once.advise(req({ episode: { events: [] }, considering: 'action:quote_rate' })).verdict, 'clear');
  // another operator's rules never fire
  assert.equal(advisor.advise({ operator: 'other', episode: { events: [] }, considering: 'action:quote_rate' }).verdict, 'abstain');
});

test('parseRequest refuses what the contract does not allow', () => {
  assert.throws(() => parseRequest(null), /must be an object/);
  assert.throws(() => parseRequest({ episode: { events: [] } }), /operator is required/);
  assert.throws(() => parseRequest({ operator: 'o' }), /episode.events/);
  assert.throws(() => parseRequest({ operator: 'o', episode: { events: [{}] } }), /type must be a string/);
  assert.throws(() => parseRequest({ operator: 'o', episode: { events: [] }, facts: { a: {} } }), /must be a scalar/);
  assert.deepEqual(parseRequest({ operator: 'o', episode: { events: [] }, facts: { a: 1 }, considering: 'x' }), { operator: 'o', episode: { events: [] }, facts: { a: 1 }, considering: 'x' });
});

test('F6.5 — 500 rules, p95 under 50ms', () => {
  const rules: Rule[] = [];
  for (let i = 0; i < 500; i++) {
    rules.push(
      rule({
        id: `r${i}`,
        family: i % 2 ? 'recommendation' : 'obligation',
        pattern: i % 2 ? 'antecedent-implies-action' : 'X-implies-prior-Y',
        bindings: i % 2 ? { action: `action:a${i % 20}` } : { subject: `action:s${i % 25}`, guard: `action:g${i % 7}` },
        conditions: [
          { fact: `f${i % 30}`, op: 'eq', value: i % 3 },
          { fact: `g${i % 11}`, op: 'eq', value: 'x' },
        ],
      }),
    );
  }
  const advisor = new Advisor(rules, ANY);
  const facts: Record<string, string | number> = {};
  for (let i = 0; i < 30; i++) facts[`f${i}`] = i % 3;
  for (let i = 0; i < 11; i++) facts[`g${i}`] = 'x';
  const events = Array.from({ length: 40 }, (_, k) => ({ type: `action:g${k % 7}` }));
  const times: number[] = [];
  for (let n = 0; n < 300; n++) {
    const t0 = process.hrtime.bigint();
    advisor.advise({ operator: 'op', episode: { events }, facts, considering: `action:s${n % 25}` });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)]!;
  assert.ok(p95 < 50, `p95 ${p95.toFixed(2)}ms`);
});

test('HTTP: POST /advise, evidence link, decision-point log and /coverage', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  let srv: Awaited<ReturnType<typeof startAdvisorServer>> | undefined;
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const store = openStore(ws.config.dbPath);
    const r1 = loadRules(store, { corpus: 'synthetic', scope: 'op-alpha' }).find((r) => r.family === 'obligation' && r.bindings.subject === 'action:issue_refund' && r.bindings.guard === 'action:verify_identity' && r.pattern === 'X-implies-prior-Y' && r.conditions.length === 0)!;
    adjudicate(store, r1.id, 'real', { scope: 'op-alpha' });
    const rec = loadRules(store, { corpus: 'synthetic', scope: 'op-alpha' }).find((r) => r.family === 'recommendation' && r.bindings.action === 'action:issue_refund')!;
    adjudicate(store, rec.id, 'real', { scope: 'op-alpha' });
    store.close();
    srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'synthetic', recommendable: new Set(['action:issue_refund']) });
    const post = async (body: unknown) => {
      const res = await fetch(srv!.url + 'advise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    const health = (await (await fetch(srv.url + 'health')).json()) as { served: number };
    assert.equal(health.served, 2);
    const warn = await post({ operator: 'op-alpha', episode: { events: [{ type: 'intent:refund_request', kind: 'customer_intent' }] }, considering: 'action:issue_refund' });
    assert.equal(warn.status, 200);
    assert.equal(warn.json.verdict, 'warn');
    const bad = await post({ operator: 'op-alpha' });
    assert.equal(bad.status, 400);
    const ok = await post({ operator: 'op-alpha', episode: { events: [{ type: 'intent:refund_request', kind: 'customer_intent' }, { type: 'action:verify_identity' }] }, considering: 'action:issue_refund' });
    assert.equal(ok.json.verdict, 'recommend');
    const actions = ok.json.actions as Array<{ type: string; rules: Array<{ evidence: string }> }>;
    assert.equal(actions[0]!.type, 'action:issue_refund');
    const ev = (await (await fetch(srv.url.replace(/\/$/, '') + actions[0]!.rules[0]!.evidence)).json()) as { id: string; support: { holds: number } ; examples: unknown[] };
    assert.equal(ev.id, rec.id);
    assert.ok(ev.examples.length > 0);
    const abstain = await post({ operator: 'op-alpha', episode: { events: [] } });
    assert.deepEqual(abstain.json.abstention, { reason: 'unknown_fact', missing: ['episode.intent'] });
    const cov = (await (await fetch(srv.url + 'coverage')).json()) as { decisionPoints: number; answered: number; abstained: { unknownFact: number }; missingFacts: Array<{ fact: string }> };
    assert.equal(cov.decisionPoints, 3);
    assert.equal(cov.answered, 2);
    assert.equal(cov.abstained.unknownFact, 1);
    assert.equal(cov.missingFacts[0]!.fact, 'episode.intent');
  } finally {
    await srv?.close();
    ws.cleanup();
  }
});

test('replay: coverage, agreement and outcome precision over the synthetic corpus', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    // nothing real yet → nothing served → 0 coverage
    const cold = await replay(corpus, result.rules);
    assert.equal(cold.served, 0);
    assert.equal(cold.decisionPoints, 46);
    assert.equal(cold.coverage, 0);
    // make every alpha recommendation real
    const real = result.rules.map((r) => (r.scope === 'op-alpha' && r.family === 'recommendation' && r.status === 'proposed' ? { ...r, status: 'real' as const } : r));
    const warm = await replay(corpus, real);
    // four alpha recommendations, one per planted intent; the fifth was a proxy
    // for the rate-enquiry flow and coverage pruning now suppresses it
    assert.ok(warm.served >= 4, String(warm.served));
    assert.ok(warm.answered > 0);
    assert.ok(warm.agreement.of > 0);
    assert.equal(warm.agreement.value, 1, 'every alpha recommendation reproduces what alpha did');
    // the complaint→offer-credit rule is followed and ends escalated: outcome precision < 1
    assert.ok(warm.outcomePrecision.value! < 1);
    assert.ok(warm.abstained.uncovered > 0, "beta's decision points are uncovered: nothing is real for beta");
    // the CLI writes the log and a report
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const store = openStore(ws.config.dbPath);
    for (const r of loadRules(store, { corpus: 'synthetic', scope: 'op-alpha', status: ['proposed'] })) if (r.family === 'recommendation') adjudicate(store, r.id, 'real', { scope: 'op-alpha' });
    recordRun(store, ctx, 'noop', corpus);
    store.close();
    const out = capture();
    await cmdCoverage({ ...ctx, out: out.out }, 'synthetic', {});
    assert.match(out.text(), /46 decision points replayed/);
    assert.match(out.text(), /agreement\s+100\.0%/);
    const s2 = openStore(ws.config.dbPath);
    const logged = (s2.prepare("SELECT COUNT(*) AS n FROM decision_points WHERE source = 'replay:synthetic'").get() as { n: number }).n;
    s2.close();
    assert.equal(logged, 46);
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// factsAt precedence (JT6.1), one test per pair. The caller's facts win over
// everything the episode implies, and the order is a MUST: the observation
// layer goes under all of these, and the safety invariant only holds if
// nothing lower can displace a fact that was already there.

test('factsAt: a caller fact beats a slot of the same name', () => {
  const f = factsAt({ operator: 'o', episode: { events: [{ type: 'action:x', slots: { reason: 'from-slot' } }] }, facts: { 'slot.reason': 'from-caller' } });
  assert.equal(f['slot.reason'], 'from-caller');
});

test('factsAt: a caller fact beats the inferred episode intent', () => {
  const f = factsAt({ operator: 'o', episode: { events: [{ type: 'intent:refund', kind: 'customer_intent' }] }, facts: { 'episode.intent': 'intent:complaint' } });
  assert.equal(f['episode.intent'], 'intent:complaint');
});

test('factsAt: a later slot beats an earlier one, and the intent is set only when there is exactly one', () => {
  const f = factsAt({ operator: 'o', episode: { events: [{ type: 'a', slots: { k: 1 } }, { type: 'b', slots: { k: 2 } }, { type: 'intent:x', kind: 'customer_intent' }, { type: 'intent:y', kind: 'customer_intent' }] } });
  assert.equal(f['slot.k'], 2);
  assert.equal('episode.intent' in f, false, 'two intents is not one');
});
