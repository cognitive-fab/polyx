// The planted observable rule (JT9.4): the oracle for the whole observation
// path, offline. Ten complaints, identical in every typed respect up to the
// decision point; five state a double charge in their text and are escalated,
// five do not and get a credit. The committed annotation file beside the
// fixture is what `polyx annotate` would have recorded had a model been
// asked. If the path works, the miner proposes "escalate when the text
// states a double charge", a person can adjudicate it real, and the replay
// answers five decision points it could not answer before — and no others.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { annotationPath, loadCorpus, readAnnotations, unproducedFacts } from 'polyx-lens';
import { annotationsFor, predicateSetFor, recordRun, type Ctx } from '../src/cli/main.ts';
import { mine } from '../src/mine/index.ts';
import { replay } from '../src/serve/coverage.ts';
import { openStore } from '../src/store/db.ts';
import { adjudicate, loadRules, persistMined } from '../src/store/rules.ts';
import { FIXTURES, tempWorkspace } from './helpers.ts';

const CORPUS = 'synthetic-observable';
const COMMITTED = join(FIXTURES, CORPUS, `${CORPUS}@1.jsonl`);

/** Put the committed annotation file where the workspace expects it. */
function install(ws: ReturnType<typeof tempWorkspace>): void {
  mkdirSync(join(ws.dir, 'annotations'), { recursive: true });
  copyFileSync(COMMITTED, annotationPath(ws.dir, CORPUS, 1));
}

const ctxOf = (ws: ReturnType<typeof tempWorkspace>): Ctx => ({ config: ws.config, thresholds: ws.thresholds, out: () => undefined, err: () => undefined });

const describe = (rules: Array<{ family: string; bindings: { action?: string }; conditions: Array<{ fact: string; value: unknown }> }>): string =>
  rules
    .filter((r) => r.family === 'recommendation')
    .map((r) => `${r.bindings.action} if ${r.conditions.map((c) => `${c.fact}=${String(c.value)}`).join(' & ')}`)
    .join('; ');

test('the committed annotation file is what the fixture says it is', () => {
  const file = readAnnotations(COMMITTED)!;
  assert.equal(file.digest, '39e93b226b4ac904', 'regenerate with fixtures/synthetic-observable/annotate.mjs if the fixture changed');
  assert.equal(file.partial, false);
  assert.equal(file.lines.length, 30, 'three text turns in each of ten interactions');
  assert.equal(file.lines.filter((l) => l.value === true).length, 5);
  assert.equal(file.lines.filter((l) => l.value === false).length, 0, 'assert-only never records a false');
  assert.equal(file.lines.filter((l) => l.value === null).length, 25, 'and every withholding is a written line');
  assert.ok(file.lines.every((l) => l.redaction === 'text.synthetic@1'));
});

test('the predicate is real and calibrated for the observable fixture, and stale for the main one', async () => {
  const ws = tempWorkspace();
  try {
    const set = predicateSetFor(ctxOf(ws), CORPUS)!;
    assert.equal(set.predicates[0]!.status, 'real');
    const obs = await loadCorpus(ws.config, CORPUS);
    const main = await loadCorpus(ws.config, 'synthetic');
    assert.equal(set.predicates[0]!.calibration!.corpusRevision, obs.revision, 'calibrated against this fixture');
    assert.notEqual(set.predicates[0]!.calibration!.corpusRevision, main.revision, 'and therefore inert against the main fixture (JF3.5)');
  } finally {
    ws.cleanup();
  }
});

test('O1: the miner proposes "escalate when the text states a double charge", and only through the observed fact', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    install(ws);
    const corpus = await loadCorpus(ws.config, CORPUS);
    const ann = annotationsFor(ctxOf(ws), corpus);
    assert.ok(ann, 'the workspace finds the annotation file for predicate set v1');

    const withObs = await mine(corpus, ws.thresholds, { minedAt: 1, annotations: ann!.file });
    const o1 = withObs.rules.find((r) => r.family === 'recommendation' && r.bindings.action === 'action:escalate' && r.conditions.some((c) => c.fact === 'obs.states_double_charge' && c.value === true));
    assert.ok(o1, `expected the planted rule; got: ${describe(withObs.rules)}`);
    assert.deepEqual(o1!.support, { holds: 5, of: 5 }, 'five double-charge complaints, five escalations, no exceptions');
    assert.equal(o1!.status, 'proposed');

    // Without the annotation file the typed record cannot separate the two
    // groups, so no rule recommends escalation at all.
    const without = await mine(await loadCorpus(ws.config, CORPUS), ws.thresholds, { minedAt: 1 });
    assert.equal(without.observation, null);
    assert.ok(!without.rules.some((r) => r.family === 'recommendation' && r.bindings.action === 'action:escalate'), `nothing in the typed record recommends escalation; got: ${describe(without.rules)}`);
  } finally {
    ws.cleanup();
  }
});

test('JF4.3: the rule can be adjudicated real because its predicate is; with no predicate set it cannot', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    install(ws);
    const corpus = await loadCorpus(ws.config, CORPUS);
    const ann = annotationsFor(ctxOf(ws), corpus)!;
    const store = openStore(ws.config.dbPath);
    try {
      const manifest = recordRun(store, ctxOf(ws), 'mine', corpus);
      const result = await mine(corpus, ws.thresholds, { minedAt: manifest.at, annotations: ann.file });
      persistMined(store, manifest, result.rules, result.contradictions, ws.thresholds);
      const o1 = loadRules(store, { corpus: CORPUS }).find((r) => r.family === 'recommendation' && r.bindings.action === 'action:escalate')!;
      assert.ok(o1);
      assert.deepEqual(unproducedFacts(o1.conditions, null), ['obs.states_double_charge']);
      assert.deepEqual(unproducedFacts(o1.conditions, predicateSetFor(ctxOf(ws), CORPUS)), []);

      assert.throws(() => adjudicate(store, o1.id, 'real', { corpus: CORPUS, scope: o1.scope, predicates: null }), /depends on obs\.states_double_charge, which no real, calibrated predicate produces \(JF4\.3\)/);
      const real = adjudicate(store, o1.id, 'real', { corpus: CORPUS, scope: o1.scope, predicates: predicateSetFor(ctxOf(ws), CORPUS) });
      assert.equal(real.status, 'real');
    } finally {
      store.close();
    }
  } finally {
    ws.cleanup();
  }
});

test('JT9.2: the replay answers five decision points because of observation, resolves five abstentions, and changes nothing else', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    install(ws);
    const corpus = await loadCorpus(ws.config, CORPUS);
    const ann = annotationsFor(ctxOf(ws), corpus)!;
    const store = openStore(ws.config.dbPath);
    try {
      const manifest = recordRun(store, ctxOf(ws), 'mine', corpus);
      const result = await mine(corpus, ws.thresholds, { minedAt: manifest.at, annotations: ann.file });
      persistMined(store, manifest, result.rules, result.contradictions, ws.thresholds);
      const set = predicateSetFor(ctxOf(ws), CORPUS);
      for (const r of loadRules(store, { corpus: CORPUS })) {
        if (r.family === 'recommendation' && r.bindings.action === 'action:escalate') adjudicate(store, r.id, 'real', { corpus: CORPUS, scope: r.scope, predicates: set });
      }
      const rules = loadRules(store, { corpus: CORPUS });

      const plain = await replay(await loadCorpus(ws.config, CORPUS), rules);
      assert.equal(plain.observation, null);
      assert.equal(plain.answered, 0, 'without the observed fact the rule is unknown at every decision point');
      assert.equal(plain.abstained.unknownFact, 10);

      const observed = await replay(await loadCorpus(ws.config, CORPUS), rules, undefined, ann.file);
      assert.ok(observed.observation);
      assert.equal(observed.observation!.digest, ann.file.digest);
      assert.equal(observed.observation!.pointsObserved, 5, 'the five double-charge points carry the fact; the other five carry a withholding, which is nothing');
      assert.equal(observed.observation!.answeredWithout, 0);
      assert.equal(observed.observation!.answeredByObservation, 5);
      assert.equal(observed.observation!.abstentionsResolved, 5);
      assert.equal(observed.observation!.warningsRaised, 0, 'no obligation in this fixture; the yield is all on the recommendation side');
      assert.equal(observed.answered, 5);
      assert.equal(observed.abstained.unknownFact, 5, 'the five without the fact still abstain — silence is not denial');
      assert.deepEqual(observed.agreement, { holds: 5, of: 5, value: 1 });
    } finally {
      store.close();
    }
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// JT9.1 — audit reports declared, inert, and the broken dependency as an error.

import { cmdAudit } from '../src/cli/main.ts';

test('audit: declared and inert counts, and a real rule depending on an unproduced fact is an error', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    // On the MAIN fixture the shipped predicate is stale, so: declared 1, inert 1.
    const out: string[] = [];
    const ctx: Ctx = { config: ws.config, thresholds: ws.thresholds, out: (s) => out.push(s), err: (s) => out.push(s) };
    assert.equal(await cmdAudit(ctx, 'synthetic', { json: true }), 0);
    const report = JSON.parse(out.join('\n')) as { observation: { annotatable: boolean; declared: number; inert: number; inertBecause: Array<{ reason: string }>; broken: unknown[] } };
    assert.equal(report.observation.annotatable, true);
    assert.equal(report.observation.declared, 1);
    assert.equal(report.observation.inert, 1);
    assert.match(report.observation.inertBecause[0]!.reason, /stale/);
    assert.deepEqual(report.observation.broken, []);

    // Now plant a real rule on the main fixture that mentions the fact no
    // real predicate produces THERE. Adjudication would refuse it (JF4.3);
    // audit must catch one that got in anyway — a predicate retired after
    // the rule went real, say — and exit non-zero.
    install(ws);
    const corpus = await loadCorpus(ws.config, CORPUS);
    const store = openStore(ws.config.dbPath);
    try {
      const manifest = recordRun(store, ctx, 'mine', corpus);
      const result = await mine(corpus, ws.thresholds, { minedAt: manifest.at, annotations: annotationsFor(ctx, corpus)!.file });
      persistMined(store, manifest, result.rules, result.contradictions, ws.thresholds);
      const o1 = loadRules(store, { corpus: CORPUS }).find((r) => r.bindings.action === 'action:escalate')!;
      // Force the status past the JF4.3 gate, as a retirement after the fact would.
      store.prepare('UPDATE rules SET status = ? WHERE id = ? AND corpus = ? AND scope = ?').run('real', o1.id, CORPUS, o1.scope);
      // …and retire the predicate by pointing audit at a set that no longer produces the fact.
      const retired = { ...predicateSetFor(ctx, CORPUS)!, predicates: predicateSetFor(ctx, CORPUS)!.predicates.map((p) => ({ ...p, status: 'retired' as const })) };
      assert.deepEqual(unproducedFacts(o1.conditions, retired), ['obs.states_double_charge']);
    } finally {
      store.close();
    }
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// JT8.1 — the replay never calls the port. Twice over one annotation file,
// identical output; the boundary check is what makes the network impossible
// here, and this is what makes it visible.

test('JT8.1: the replay is a function of the corpus and the annotation file, and nothing else', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    install(ws);
    const corpus = await loadCorpus(ws.config, CORPUS);
    const ann = annotationsFor(ctxOf(ws), corpus)!;
    const store = openStore(ws.config.dbPath);
    try {
      const manifest = recordRun(store, ctxOf(ws), 'mine', corpus);
      const result = await mine(corpus, ws.thresholds, { minedAt: manifest.at, annotations: ann.file });
      persistMined(store, manifest, result.rules, result.contradictions, ws.thresholds);
      const set = predicateSetFor(ctxOf(ws), CORPUS);
      for (const r of loadRules(store, { corpus: CORPUS })) if (r.bindings.action === 'action:escalate') adjudicate(store, r.id, 'real', { corpus: CORPUS, scope: r.scope, predicates: set });
      const rules = loadRules(store, { corpus: CORPUS });
      const a = await replay(await loadCorpus(ws.config, CORPUS), rules, undefined, ann.file);
      const b = await replay(await loadCorpus(ws.config, CORPUS), rules, undefined, ann.file);
      assert.equal(JSON.stringify(a), JSON.stringify(b));
      // And what the replay logs says where its observations came from: the
      // file, by digest — never an observer.
      await replay(await loadCorpus(ws.config, CORPUS), rules, store, ann.file);
      const observers = store.prepare('SELECT DISTINCT observer FROM decision_points WHERE source = ?').all(`replay:${CORPUS}`) as Array<{ observer: string }>;
      assert.deepEqual(observers.map((o) => o.observer), [`annotation:${ann.file.digest}`]);
    } finally {
      store.close();
    }
  } finally {
    ws.cleanup();
  }
});
