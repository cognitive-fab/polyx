// Phase 4: confounder controls, threshold sweep, cross-scope provenance, and
// the τ² adapter over a directory of backbones.
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdEvaluate, cmdMine } from '../src/cli/main.ts';
import { controls } from '../src/evaluate/controls.ts';
import { loadPolicy } from '../src/evaluate/policies/index.ts';
import { parseSweep, sweep } from '../src/evaluate/sweep.ts';
import { tau2Adapter } from 'polyx-lens';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from 'polyx-lens';
import { capture, FIXTURES, ROOT, tempWorkspace } from './helpers.ts';

const POLICY = join(FIXTURES, 'synthetic', 'synthetic-policy.yaml');

test('controls: violated-at-least-once and failed share are computed from the corpus', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const c = await controls(corpus, loadPolicy(POLICY));
    // refund→verify is violated once (syn-0008); refund→add-note is violated 16 times; quote→disclose 6 times (beta)
    assert.deepEqual(c.violatedAtLeastOnce.sort(), ['c-mortgage-disclose', 'c-quote-disclose', 'c-refund-note', 'c-refund-verify']);
    assert.deepEqual(c.neverExercised, []);
    // every synthetic interaction resolves except the 5 escalations
    assert.deepEqual(c.failedShare, { failed: 5, of: 46, value: 5 / 46 });
    const note = c.exercise.find((e) => e.clauseId === 'c-refund-note')!;
    assert.equal(note.exercised, 20);
    assert.equal(note.violated, 16);
    const mortgage = c.exercise.find((e) => e.clauseId === 'c-mortgage-disclose')!;
    assert.ok(mortgage.exercised < 16, 'the mortgage clause is exercised only where the condition holds');
  } finally {
    ws.cleanup();
  }
});

test('evaluate reports the violated-only recall beside the headline recall', async () => {
  const ws = tempWorkspace();
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const out = capture();
    await cmdEvaluate({ ...ctx, out: out.out }, 'synthetic', { json: true });
    const j = JSON.parse(out.text()) as { controls: { recallViolatedOnly: { lenient: { num: number; den: number } }; failedShare: { failed: number } } };
    assert.equal(j.controls.recallViolatedOnly.lenient.den, 4);
    assert.ok(j.controls.recallViolatedOnly.lenient.num >= 2);
    assert.equal(j.controls.failedShare.failed, 5);
    const text = capture();
    await cmdEvaluate({ ...ctx, out: text.out }, 'synthetic', {});
    assert.match(text.text(), /violated-at-least-once clauses only/);
    assert.match(text.text(), /failed \/ abandoned interactions kept in: 5 of 46/);
  } finally {
    ws.cleanup();
  }
});

test('sweep: a grid of thresholds, each point a full mine + evaluate', async () => {
  const ws = tempWorkspace();
  try {
    assert.deepEqual(parseSweep('minInstances=3,5;impliesSupport=0.9'), [
      { minInstances: 3, impliesSupport: 0.9 },
      { minInstances: 5, impliesSupport: 0.9 },
    ]);
    assert.throws(() => parseSweep('minInstances=abc'), /not a number/);
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const points = await sweep(corpus, ws.thresholds, parseSweep('minInstances=5,100'), POLICY);
    assert.equal(points.length, 2);
    assert.ok(points[0]!.proposed > 0);
    assert.equal(points[1]!.proposed, 0, 'a floor of 100 proposes nothing on 46 interactions');
    assert.equal(points[1]!.precision, null);
    const out = capture();
    await cmdEvaluate({ config: ws.config, thresholds: ws.thresholds, ...capture(), out: out.out }, 'synthetic', { sweep: 'minInstances=5,100' });
    assert.match(out.text(), /minInstances/);
    assert.match(out.text(), /100\s+0\s+0/);
  } finally {
    ws.cleanup();
  }
});

test('--scope-by: a hint becomes the operator, and borrowed evidence lands where it should', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    // scope the synthetic corpus by expected_episodes (every interaction says 1): one operator, so
    // the remap collapses alpha and beta — R3 then holds 10/16 across the merged operator
    const merged = await loadCorpus(ws.config, 'synthetic', { scopeBy: 'expected_episodes' });
    assert.deepEqual([...new Set(merged.interactions.map((i) => i.actor.operatorId))], ['1']);
    assert.ok(merged.interactions.every((i) => i.actor.teamId === undefined && i.actor.agentId === undefined));
    const result = await mine(merged, ws.thresholds, { minedAt: 1 });
    // merged, quote→disclose holds 10/16 = 0.625: below the 0.9 implication floor (so the episode
    // rule is not a candidate at all) but above own evidence, so the contact-window rule survives
    assert.ok(!result.rules.some((r) => r.pattern === 'X-implies-prior-Y' && r.bindings.subject === 'action:quote_rate' && r.bindings.guard === 'action:disclose_terms' && r.conditions.length === 0));
    const r3 = result.rules.find((r) => r.pattern === 'no-X-without-prior-Y' && r.bindings.subject === 'action:quote_rate' && r.bindings.guard === 'action:disclose_terms' && r.conditions.length === 0)!;
    assert.deepEqual(r3.support, { holds: 10, of: 16 });
    assert.equal(r3.scope, '1');
    assert.equal(r3.status, 'proposed');
    await assert.rejects(() => loadCorpus(ws.config, 'synthetic', { scopeBy: 'nope' }), /carries no such hint/);
  } finally {
    ws.cleanup();
  }
});

test('tau2 adapter over a directory pools backbones with distinct ids and names them in meta', async () => {
  const ws = tempWorkspace();
  try {
    const dir = join(ws.dir, 'retail-all');
    mkdirSync(dir);
    copyFileSync(join(FIXTURES, 'tau2', 'tau2_retail_sample.json'), join(dir, 'a.json'));
    copyFileSync(join(FIXTURES, 'tau2', 'tau2_retail_sample.json'), join(dir, 'b.json'));
    const all = await tau2Adapter.read(dir);
    assert.equal(all.length, 6);
    assert.equal(new Set(all.map((i) => i.id)).size, 3, 'same backbone twice: ids collide by design, as they should when a file is duplicated');
    assert.match(all[0]!.id, /-claude-3-7-sonnet-20250219$/);
    const meta = tau2Adapter.meta!(dir);
    assert.equal(meta.files, '2');
    assert.equal(meta.domain, 'retail');
  } finally {
    ws.cleanup();
  }
});
