// The conformance diff (F8.1–F8.3) against the synthetic answer key:
//   Q  escalate after offer-credit         followed, never written  → tribal knowledge
//   R1 R1' R3                              written and followed     → confirmed
//   Z  refund after add-note               written, violated 16/20  → compliance gap (violated)
//   C  apply/reverse credit                contradiction            → reported separately
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdDiff, cmdMine } from '../src/cli/main.ts';
import { diff } from '../src/diff/index.ts';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from 'polyx-lens';
import { FIXTURES, ROOT, capture, tempWorkspace } from './helpers.ts';

const POLICY = join(FIXTURES, 'synthetic', 'synthetic-policy.yaml');

test('the three regions and the contradictions match the planted answer key', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const d = await diff(corpus, result.rules, POLICY, result.contradictions);
    // 6 confirmed: with borrowedOperators=1 beta's borrowed quote→disclose is proposed and aligns too
    assert.deepEqual(d.counts, { tribal: 2, tribalExtended: 0, tribalNovel: 2, confirmed: 6, gap: { violated: 1, neverExercised: 0, keptNotMined: 0 }, contradictions: 2, inexpressible: 1 });
    // the synthetic policy states no pair for two different flows, so nothing is 'extended beyond the policy'
    assert.ok(d.tribal.every((f) => f.tribalKind === 'novel' && f.writtenElsewhere === undefined));
    assert.ok(d.tribal.some((f) => f.rule.text.startsWith('Before you escalate to a supervisor, offer a goodwill credit')));
    assert.ok(d.tribal.every((f) => f.alignments.length === 0));
    const r1 = d.confirmed.find((f) => f.rule.scope === 'op-alpha' && f.rule.text.startsWith('Before you issue a refund, verify'))!;
    assert.deepEqual(r1.alignments.map((a) => [a.clauseId, a.kind]), [['c-refund-verify', 'exact']]);
    assert.deepEqual(r1.contradicting.map((i) => i.interactionId), ['syn-0008']);
    const z = d.gap[0]!;
    assert.equal(z.clause.id, 'c-refund-note');
    assert.equal(z.kind, 'violated');
    assert.equal(z.violated, 16);
    assert.equal(z.exercised, 20);
    assert.ok(z.violations.length > 0 && z.violations.every((v) => v.interactionId.startsWith('syn-')));
    assert.ok(z.kept.length > 0);
    assert.match(d.contradictions[0]!.reason, /precedence cycle/);
    assert.deepEqual(d.inexpressible, [{ id: 'c-polite', text: 'Be polite and empathetic.', reason: 'free-text instruction' }]);
  } finally {
    ws.cleanup();
  }
});

test('never-exercised and kept-not-mined are told apart', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1, minInstances: 30 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const result = await mine(corpus, ws.thresholds, { minedAt: 1 });
    const d = await diff(corpus, result.rules, POLICY, result.contradictions);
    // at a floor of 30 nothing is mined: every clause is a gap, and the reason is named
    assert.equal(d.confirmed.length, 0);
    const kinds = Object.fromEntries(d.gap.map((g) => [g.clause.id, g.kind]));
    assert.equal(kinds['c-refund-lookup'], 'kept-not-mined');
    assert.equal(kinds['c-refund-note'], 'violated');
    assert.equal(kinds['c-mortgage-disclose'], 'violated'); // beta quotes mortgages without disclosing
  } finally {
    ws.cleanup();
  }
});

test('polyx diff writes the HTML report with every finding linked', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const out = join(ws.dir, 'report.html');
    const text = capture();
    await cmdDiff({ ...ctx, out: text.out }, 'synthetic', { out });
    assert.match(text.text(), /2 followed but never written \(0 the policy states for another flow, 2 it never states at all\) · 6 confirmed · 1 written but violated/);
    const html = readFileSync(out, 'utf8');
    assert.match(html, /<title>polyx conformance diff — synthetic<\/title>/);
    assert.match(html, /proposed for confirmation/);
    assert.match(html, /syn-0008#3/);
    assert.match(html, /your reps ignore this/);
    assert.match(html, /precedence cycle/);
    assert.doesNotMatch(html, /<script/);
    // the diff manifest carries the policy revision
    const json = capture();
    await cmdDiff({ ...ctx, out: json.out }, 'synthetic', { json: true, out: join(ws.dir, 'r2.html') });
    const j = JSON.parse(json.text()) as { manifest: { command: string; policyRevision: string } };
    assert.equal(j.manifest.command, 'diff');
    assert.match(j.manifest.policyRevision, /^[0-9a-f]{16}$/);
  } finally {
    ws.cleanup();
  }
});
