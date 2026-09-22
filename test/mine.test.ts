// The miner against the planted structure of the synthetic corpus.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Rule } from 'polyx-lens';
import { mine, type MineResult } from '../src/mine/index.ts';
import { loadCorpus } from 'polyx-lens';
import { polynessClassifier } from 'polyx-lens';
import { polynessExtractor } from 'polyx-lens';
import { ruleId } from '../src/store/identity.ts';
import { tempWorkspace } from './helpers.ts';

const find = (r: MineResult, scope: string, pattern: string, subject: string, guard?: string): Rule | undefined =>
  r.rules.find((x) => x.scope === scope && x.pattern === pattern && x.bindings.subject === subject && x.bindings.guard === guard && x.conditions.length === 0);

async function mined(minedAt = 1) {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    return { result: await mine(corpus, ws.thresholds, { minedAt }), thresholds: ws.thresholds, corpus };
  } finally {
    ws.cleanup();
  }
}

test('R1: refund implies prior verify-identity — proposed at alpha with its one counter-example', async () => {
  const { result } = await mined();
  const r1 = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:issue_refund', 'action:verify_identity')!;
  assert.ok(r1, 'R1 exists');
  assert.equal(r1.status, 'proposed');
  assert.deepEqual(r1.support, { holds: 13, of: 14 });
  assert.deepEqual(r1.provenance, { kind: 'own', level: 'operator', scope: 'op-alpha' });
  assert.equal(r1.counterexamples.length, 1);
  assert.equal(r1.counterexamples[0]!.interactionId, 'syn-0008');
  assert.ok(r1.examples.length >= 1);
  assert.match(r1.text, /Before you issue a refund, verify the customer's identity/);
  assert.match(r1.evidence, /held 13 of 14 times/);
  assert.equal(r1.window, 'episode');
  assert.equal(r1.family, 'obligation');
  assert.equal(r1.alphabetVersion, 2);
});

test('subsumption: the contact-window twin of a proposed episode rule is suppressed and says why', async () => {
  const { result } = await mined();
  const ep = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:issue_refund', 'action:lookup_order')!;
  const contact = find(result, 'op-alpha', 'no-X-without-prior-Y', 'action:issue_refund', 'action:lookup_order')!;
  assert.equal(ep.status, 'proposed');
  assert.equal(contact.status, 'suppressed');
  assert.equal(contact.suppressedBy, `implied by ${ep.id}`);
  // transitivity: refund→verify is NOT suppressed here because lookup→verify
  // is not a rule (lookup_order is not consequential, so never a subject)
  const r1 = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:issue_refund', 'action:verify_identity')!;
  assert.equal(r1.status, 'proposed');
});

test('R2: at-most-one refund per episode is vacuous on this corpus and is suppressed, not proposed', async () => {
  const { result } = await mined();
  const r2 = find(result, 'op-alpha', 'at-most-one-X', 'action:issue_refund')!;
  assert.equal(r2.status, 'suppressed');
  assert.match(r2.suppressedBy!, /vacuous/);
  assert.deepEqual(r2.support, { holds: 14, of: 14 });
});

test('R3: quote-rate implies disclose — own@operator at alpha, refused at beta (no own evidence, one borrower is not enough by default)', async () => {
  const ws = tempWorkspace(); // default borrowedOperators = 3
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const alpha = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:quote_rate', 'action:disclose_terms')!;
    const beta = find(result, 'op-beta', 'X-implies-prior-Y', 'action:quote_rate', 'action:disclose_terms')!;
    assert.equal(alpha.status, 'proposed');
    assert.deepEqual(alpha.support, { holds: 10, of: 10 });
    assert.equal(beta.status, 'refused');
    assert.deepEqual(beta.support, { holds: 0, of: 6 });
    assert.deepEqual(beta.provenance, { kind: 'neither' });
    assert.equal(beta.id, alpha.id, 'same rule, two scopes, one identity');
    assert.match(beta.evidence, /no own evidence anywhere/);
  } finally {
    ws.cleanup();
  }
});

test('R3 with borrowedOperators=1: beta sees the rule as borrowed from alpha, proposed on request only', async () => {
  const { result } = await mined();
  const beta = find(result, 'op-beta', 'X-implies-prior-Y', 'action:quote_rate', 'action:disclose_terms')!;
  assert.deepEqual(beta.provenance, { kind: 'borrowed', foundIn: ['op-alpha'] });
  assert.equal(beta.status, 'proposed');
  assert.match(beta.evidence, /1 other operator\(s\) keep this rule; this one does not \(0\/6 here\)/);
});

test('C: the apply/reverse credit ping-pong is reported as a contradiction and neither side is proposed', async () => {
  const { result } = await mined();
  assert.equal(result.contradictions.length, 2); // episode window and contact window
  const a = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:apply_credit', 'action:reverse_credit')!;
  const b = find(result, 'op-alpha', 'X-implies-prior-Y', 'action:reverse_credit', 'action:apply_credit')!;
  assert.equal(a.status, 'contradicted');
  assert.equal(b.status, 'contradicted');
  assert.equal(a.suppressedBy, `contradicts ${b.id}`);
  assert.ok(result.contradictions.some((c) => (c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)));
  assert.match(result.contradictions[0]!.reason, /precedence cycle/);
  assert.ok(!result.rules.some((r) => r.status === 'proposed' && r.bindings.subject === 'action:apply_credit'));
});

test('F: free actions are never subjects or guards of proposed rules', async () => {
  const { result } = await mined();
  assert.ok(!result.rules.some((r) => r.bindings.subject === 'action:add_note'));
  assert.ok(!result.rules.some((r) => r.status === 'proposed' && r.bindings.guard === 'action:add_note'));
});

test('every proposed rule carries counter-examples whenever of > holds, and never when of == holds', async () => {
  const { result } = await mined();
  for (const r of result.rules) {
    if (r.support.of > r.support.holds) assert.ok(r.counterexamples.length > 0, `${r.id} has no counter-examples`);
    else assert.equal(r.counterexamples.length, 0);
    assert.ok(r.examples.length > 0 || r.support.holds === 0, `${r.id} has no examples`);
  }
});

test('determinism: mine twice, byte-identical', async () => {
  const a = await mined(1);
  const b = await mined(1);
  assert.equal(JSON.stringify(a.result), JSON.stringify(b.result));
});

test('identity: re-mining is stable; the polyness ports give the same rule set as the in-house ones', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const a = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const b = await mine(corpus, ws.thresholds, { minedAt: 1, extractor: polynessExtractor, classifier: polynessClassifier });
    assert.deepEqual(
      b.rules.map((r) => [r.id, r.scope, r.status, r.support]),
      a.rules.map((r) => [r.id, r.scope, r.status, r.support]),
    );
    assert.equal(b.extractor, 'polyness');
    assert.equal(b.classifier, 'polyness');
    // and identity is what the spec says it is
    const r1 = a.rules.find((r) => r.bindings.subject === 'action:issue_refund' && r.bindings.guard === 'action:verify_identity' && r.pattern === 'X-implies-prior-Y')!;
    assert.equal(r1.id, ruleId({ family: 'obligation', pattern: 'X-implies-prior-Y', bindings: r1.bindings, conditions: [], window: 'episode' }));
  } finally {
    ws.cleanup();
  }
});

test('identity: adding an interaction changes support, not identity', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const before = await mine(corpus, ws.thresholds, { minedAt: 1 });
    // one more alpha refund, verified like the rest
    const donor = corpus.interactions.find((i) => i.id === 'syn-0001')!;
    const extra = { ...donor, id: 'syn-9999', startedAt: donor.startedAt + 1, events: donor.events.map((e) => ({ ...e, episode: e.episode.replace('syn-0001', 'syn-9999') })) };
    const after = await mine({ ...corpus, interactions: [...corpus.interactions, extra] }, ws.thresholds, { minedAt: 1 });
    const key = (r: Rule) => `${r.id}|${r.scope}`;
    const ids = (m: MineResult) => new Set(m.rules.map(key));
    for (const id of ids(before)) assert.ok(ids(after).has(id), `${id} vanished`);
    const r1b = before.rules.find((r) => r.scope === 'op-alpha' && r.bindings.subject === 'action:issue_refund' && r.bindings.guard === 'action:verify_identity' && r.pattern === 'X-implies-prior-Y')!;
    const r1a = after.rules.find((r) => key(r) === key(r1b))!;
    assert.deepEqual(r1b.support, { holds: 13, of: 14 });
    assert.deepEqual(r1a.support, { holds: 14, of: 15 });
  } finally {
    ws.cleanup();
  }
});

test('the stats add up and name the pruning', async () => {
  const { result } = await mined();
  const s = result.stats;
  assert.equal(s.subjects, 6);
  assert.equal(s.proposed + s.refused + s.suppressed + s.contradicted, result.rules.length);
  assert.ok(s.vacuous > 0);
  assert.ok(s.suppressed > s.vacuous, 'subsumption suppressed something beyond the vacuous rules');
  assert.equal(s.byOperator['op-alpha']!.proposed + s.byOperator['op-beta']!.proposed, s.proposed);
});
