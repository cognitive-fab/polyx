// The evaluation harness against the synthetic policy, whose answer key is
// known (test/fixtures/synthetic/synthetic-policy.yaml).
//
// The synthetic clause set is a FIXTURE and travels with these tests: its
// answers are already public in generate.mjs, so it gives nothing away. The
// real answer keys — ABCD, tau2, cc — are not in this repository at all
// (src/config.ts, `policyRoot`), so the one test that asserts on ABCD's
// decomposition skips when that checkout is absent rather than failing.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdEvaluate, cmdMine } from '../src/cli/main.ts';
import { loadConfig } from 'polyx-lens';
import { align, goldReport } from '../src/evaluate/align.ts';
import { evaluate, gate } from '../src/evaluate/index.ts';
import { metrics } from '../src/evaluate/metrics.ts';
import { loadPolicy, parsePolicy } from '../src/evaluate/policies/index.ts';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from 'polyx-lens';
import { FIXTURES, ROOT, capture, tempWorkspace } from './helpers.ts';

const POLICY = join(FIXTURES, 'synthetic', 'synthetic-policy.yaml');
const ABCD = loadConfig(ROOT).policyRoots.map((d) => join(d, 'abcd-guidelines.yaml')).find(existsSync) ?? '';

test('the synthetic policy parses, and a clause with no shape is refused', () => {
  const p = loadPolicy(POLICY);
  assert.equal(p.clauses.length, 6);
  assert.equal(p.clauses.filter((c) => c.expressible).length, 5);
  assert.throws(() => parsePolicy('policy: x\nversion: 1\nclauses:\n  - { id: a, text: t, expressible: true }\n'), /needs a shape/);
});

test('the ABCD clause set parses and counts expressibility', { skip: existsSync(ABCD) ? false : 'no polyx-eval checkout' }, () => {
  const abcd = loadPolicy(ABCD);
  assert.equal(abcd.clauses.length, 499);
  assert.equal(abcd.clauses.filter((c) => c.expressible).length, 155);
  assert.ok(abcd.clauses.every((c) => !c.expressible || (c.shape === 'precedence' && c.when?.fact === 'episode.intent')));
  // 48 of the 155 are steps the rulebook lists side by side; the rest are
  // transitively implied pairs, and recall is reported over both (human
  // ruling, 29 Aug 2026)
  assert.equal(abcd.clauses.filter((c) => c.expressible && c.adjacent).length, 48);
  // the four Troubleshoot Site subflows that say "in any order" contribute none
  const orderFree = abcd.clauses.filter((c) => c.reason?.startsWith('the guidelines free the order'));
  assert.equal(orderFree.length, 32);
  assert.ok(orderFree.every((c) => !c.expressible));
});

test('alignment and metrics on the synthetic corpus match the planted answer key', async () => {
  const ws = tempWorkspace(); // borrowedOperators=3: beta refuses R3
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const policy = loadPolicy(POLICY);
    const alignments = align(result.rules, policy);
    const m = metrics(result.rules, policy, alignments);

    // proposed rules at alpha: refund→verify, refund→lookup, quote→disclose (exact, unconditioned = global clauses),
    // plus escalate→offer_credit and the exactly-one family, which no clause states
    assert.ok(m.proposed >= 6);
    const exact = alignments.filter((a) => a.kind === 'exact');
    assert.ok(exact.some((a) => a.clauseId === 'c-refund-verify'));
    assert.ok(exact.some((a) => a.clauseId === 'c-refund-lookup'));
    assert.ok(exact.some((a) => a.clauseId === 'c-quote-disclose'));
    // the mortgage clause is the only scope in which quote_rate is governed, so the
    // unconditioned rule covers every scope of its subject and is exact, not general
    assert.ok(alignments.some((a) => a.clauseId === 'c-mortgage-disclose' && a.kind === 'exact'));
    // recall: 4 of 5 expressible clauses recovered (lenient); refund→add-note never followed → not recovered
    assert.deepEqual(m.recall.lenient, { num: 4, den: 5, value: 0.8 });
    assert.deepEqual(m.recall.strict, { num: 4, den: 5, value: 0.8 });
    // refusal correctness: beta's refused quote→disclose IS written → an incorrect refusal from the policy's
    // point of view (beta does not follow it; the policy still states it). alpha's refused rules are absent.
    assert.ok(m.refused >= 1);
    const betaRefused = result.rules.find((r) => r.scope === 'op-beta' && r.status === 'refused' && r.bindings.subject === 'action:quote_rate')!;
    assert.ok(betaRefused);
    assert.ok(m.refusalCorrectness.num < m.refusalCorrectness.den);
    assert.equal(m.clauses.inexpressible, 1);
    assert.deepEqual(m.clauses.byReason, { 'free-text instruction': 1 });
    // gate
    const g = gate(m);
    assert.ok(['target', 'between'].includes(g.verdict), g.notes.join('; '));
  } finally {
    ws.cleanup();
  }
});

test('gold: inter-rater and matcher agreement are computed, and missing gold is said plainly', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const policy = loadPolicy(POLICY);
    const alignments = align(result.rules, policy);
    const r1 = alignments.find((a) => a.clauseId === 'c-refund-verify' && a.kind === 'exact')!;
    const report = goldReport(
      [
        { rule: r1.ruleId, clause: 'c-refund-verify', verdict: 'confirmed', rater: 'a' },
        { rule: r1.ruleId, clause: 'c-refund-verify', verdict: 'confirmed', rater: 'b' },
        { rule: r1.ruleId, clause: 'c-polite', verdict: 'rejected', rater: 'a' },
        { rule: r1.ruleId, clause: 'c-polite', verdict: 'confirmed', rater: 'b' },
        { rule: 'nonexistent', clause: 'c-refund-note', verdict: 'confirmed', rater: 'a' },
      ],
      alignments,
    );
    assert.equal(report.pairs, 3);
    assert.equal(report.doubleRated, 2);
    assert.equal(report.interRater, 0.5);
    // matcher: proposed r1↔verify (majority confirmed ✓), not proposed r1↔polite (majority confirmed with tie → majority true, matcher false ✗), not proposed nonexistent (majority true ✗)
    assert.equal(report.matcherAgreement, 1 / 3);
    assert.equal(report.matcherMissed, 2);

    const e = await evaluate(result.rules, POLICY, join(ws.dir, 'no-gold.yaml'));
    assert.equal(e.gold.present, false);
    assert.equal(e.gold.report.pairs, 0);
  } finally {
    ws.cleanup();
  }
});

test('polyx evaluate: end to end, stamped, reproducible', async () => {
  const ws = tempWorkspace();
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await assert.rejects(() => cmdEvaluate(ctx, 'synthetic', {}), /run polyx mine/);
    await cmdMine(ctx, 'synthetic', {});
    const a = capture();
    const codeA = await cmdEvaluate({ ...ctx, out: a.out }, 'synthetic', { json: true });
    const b = capture();
    const codeB = await cmdEvaluate({ ...ctx, out: b.out }, 'synthetic', { json: true });
    assert.equal(codeA, codeB);
    const strip = (t: string) => {
      const j = JSON.parse(t) as { manifest: unknown; [k: string]: unknown };
      delete (j as { manifest?: unknown }).manifest;
      return JSON.stringify(j);
    };
    assert.equal(strip(a.text()), strip(b.text()));
    const j = JSON.parse(a.text()) as { manifest: { command: string; alphabetVersion: number }; policyRevision: string; metrics: { precision: { lenient: { value: number } } } };
    assert.equal(j.manifest.command, 'evaluate');
    assert.equal(j.manifest.alphabetVersion, 2);
    assert.match(j.policyRevision, /^[0-9a-f]{16}$/);
    assert.ok(j.metrics.precision.lenient.value > 0);
    const text = capture();
    await cmdEvaluate({ ...ctx, out: text.out }, 'synthetic', {});
    assert.match(text.text(), /precision\s+strict/);
    assert.match(text.text(), /gold: none/);
    assert.match(text.text(), /gate: (TARGET|BETWEEN)/);
  } finally {
    ws.cleanup();
  }
});
