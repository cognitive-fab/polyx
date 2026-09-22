// Mining over observed facts (JF6.3, section 5.1, G2). The miner reads the
// annotation store as data and never calls the port; here the store is
// produced by a stub observer so the whole path runs offline.
//
// G2 is the reason this file exists. An assert-only predicate emits `true`
// or nothing, so its fact never takes a second value, and the candidate
// filter that drops single-valued facts would drop every one of them before
// the instance floor was ever consulted. That would make section 5.1 of the
// spec — the entire mining gain — unreachable, silently.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachObservations, instanceFacts, loadCorpus, naiveExtractor, consequentialTypes, withThresholds, type AnnotationFile, type FactBase, type Observer } from 'polyx-lens';
import { candidateConditions } from '../src/mine/facts.ts';
import { mine } from '../src/mine/index.ts';
import { annotate } from '../src/ports/jev/annotate.ts';
import { loadTextProfile, builtinTextProfile, parsePredicateSet } from 'polyx-lens';
import { tempWorkspace } from './helpers.ts';

const t = withThresholds({ minInstances: 5 });

// ---------------------------------------------------------------------------
// G2, as a unit.

test('G2: an assert-only obs fact present on some instances is a candidate; a slot with one value is not', () => {
  // Ten instances; the observed fact is true on six and absent (withheld, or
  // no text) on four. A slot with the same shape is a constant.
  const facts: FactBase[] = Array.from({ length: 10 }, (_, i) => (i < 6 ? { 'obs.stated': true, 'slot.kind': 'x' } : { 'slot.kind': 'x' }));
  const out = candidateConditions(facts, t);
  assert.deepEqual(out, [{ fact: 'obs.stated', op: 'eq', value: true }]);
});

test('G2: an obs fact present on EVERY instance is still a constant, and still not a candidate', () => {
  const facts: FactBase[] = Array.from({ length: 10 }, () => ({ 'obs.stated': true }));
  assert.deepEqual(candidateConditions(facts, t), [], 'present everywhere partitions nothing');
});

test('G2: the instance floor still applies to the value that is present', () => {
  const facts: FactBase[] = Array.from({ length: 10 }, (_, i) => (i < 3 ? { 'obs.stated': true } : {}));
  assert.deepEqual(candidateConditions(facts, t), [], 'three instances is below the floor of five');
});

test('G2: a refuting predicate that emits both values is a candidate on the ordinary rule', () => {
  const facts: FactBase[] = Array.from({ length: 12 }, (_, i) => ({ 'obs.q': i < 6 }));
  assert.deepEqual(candidateConditions(facts, t), [
    { fact: 'obs.q', op: 'eq', value: false },
    { fact: 'obs.q', op: 'eq', value: true },
  ]);
});

// ---------------------------------------------------------------------------
// The memo hazard (W5.3).

test('observations attached AFTER a fact base was read are not seen — which is why the miner attaches first', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
    const inst = subjects[0]!.instances[0]!;
    const before = instanceFacts(inst); // memoised now
    const file: AnnotationFile = {
      path: '',
      digest: 'x',
      partial: false,
      lines: [{ i: inst.interactionId, e: inst.episodeId, seq: inst.seq - 1, pred: 'p', p: 0.99, fact: 'obs.p', value: true, pv: 1, redaction: 'r', sha: 's', at: 0 }],
    };
    attachObservations(subjects, file);
    assert.equal(inst.observed?.['obs.p'], true, 'attached');
    assert.equal(instanceFacts(inst), before, 'the memo still serves the pre-observation fact base');
    assert.equal('obs.p' in instanceFacts(inst), false, 'and it does not carry the fact — this is the bug the ordering in mine() prevents');
  } finally {
    ws.cleanup();
  }
});

test('observations are lifted from EARLIER sites in the episode, never from the action itself', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
    const inst = subjects.find((s) => s.instances.some((i) => i.seq >= 2))!.instances.find((i) => i.seq >= 2)!;
    const at = (seq: number, pred: string, value: boolean | null, p: number) =>
      ({ i: inst.interactionId, e: inst.episodeId, seq, pred, p, fact: `obs.${pred}`, value, pv: 1, redaction: 'r', sha: 's', at: 0 });
    const file: AnnotationFile = {
      path: '',
      digest: 'x',
      partial: false,
      lines: [
        at(0, 'a', null, 0.5), // withheld at the first turn
        at(1, 'a', true, 0.96), // emitted at the second: later wins
        at(0, 'b', false, 0.02), // emitted early…
        at(1, 'b', null, 0.5), // …then withheld: a withholding never retracts
        at(inst.seq, 'c', true, 0.99), // AT the action: excluded, as its own slots are
        at(inst.seq + 1, 'd', true, 0.99), // after it: not yet known
      ],
    };
    const r = attachObservations(subjects, file);
    assert.ok(r.sites >= 1);
    assert.deepEqual(inst.observed, { 'obs.a': true, 'obs.b': false });
    const facts = instanceFacts(inst);
    assert.equal(facts['obs.a'], true);
    assert.equal(facts['obs.b'], false);
    assert.equal('obs.c' in facts, false, 'a rule may not condition on the arguments of the action it governs');
    assert.equal('obs.d' in facts, false, 'the future is not a fact');
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// End to end: annotate with a stub, then mine over what was recorded.

const SET = (rev: string, alpha: number) => `corpus: synthetic
version: 1
model: jev-latest
redaction: text.synthetic@1
predicates:
  - id: states_double_charge
    fact: obs.states_double_charge
    status: real
    quadrant: text-unknown
    source: event.text
    window: event
    question: Does this message state that the customer was charged twice?
    bands: { assertAt: 0.85, refuteAt: -1 }
    calibration:
      at: '2026-09-19'
      corpusRevision: ${rev}
      alphabetVersion: ${alpha}
      n: 60
      labels: { true: 30, false: 30 }
      assertPrecision: 0.97
      refutePrecision: null
      withheldFraction: 0.5
      reviewer: test
`;

/** Reads the text for real: "charged twice" is what the escalation flow's complaints say. */
const stub: Observer = {
  name: 'stub',
  version: 1,
  async observe(text, predicates) {
    const hit = /charged twice/i.test(text);
    return predicates.map((p) => ({ predicate: p.id, fact: p.fact, value: hit ? true : null, p: hit ? 0.96 : 0.05 }));
  },
};

test('the miner reads the annotation file and reports it as a pinned input; without one it mines as before', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const { set } = parsePredicateSet(SET(corpus.revision, corpus.alphabet.version));
    const profile = loadTextProfile(builtinTextProfile('synthetic')!);
    const r = await annotate(corpus, set, profile, stub, ws.dir);
    assert.ok(r.file);

    const plain = await mine(corpus, ws.thresholds, { minedAt: 1 });
    assert.equal(plain.observation, null);

    // A fresh load, because attachObservations mutates instances and the
    // fact base memo is per instance: a second mine over the SAME corpus
    // object would see the first run's state. The CLI loads once per run.
    const corpus2 = await loadCorpus(ws.config, 'synthetic');
    const observed = await mine(corpus2, ws.thresholds, { minedAt: 1, annotations: r.file! });
    assert.ok(observed.observation);
    assert.equal(observed.observation!.digest, r.file!.digest);
    assert.equal(observed.observation!.partial, false);
    assert.ok(observed.observation!.sites > 0, 'decision points in the escalation flow carry the observation');

    // Every rule the plain run proposed is still proposed: observation only
    // adds candidates, it never removes a rule mined over typed state.
    const key = (x: { id: string; scope: string }) => `${x.id}|${x.scope}`;
    const plainKeys = new Set(plain.rules.map(key));
    for (const k of plainKeys) assert.ok(observed.rules.some((x) => key(x) === k), `${k} was lost by observing`);
  } finally {
    ws.cleanup();
  }
});

test('an obs.* fact from the customer turn reaches the fact base of the action that followed it', async () => {
  const ws = tempWorkspace({ minInstances: 3 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const { set } = parsePredicateSet(SET(corpus.revision, corpus.alphabet.version));
    const profile = loadTextProfile(builtinTextProfile('synthetic')!);
    const r = await annotate(corpus, set, profile, stub, ws.dir);
    const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
    attachObservations(subjects, r.file!);

    // The fixture escalates five complaints, every one of which says
    // "charged twice" — on the customer turn, three events before the action.
    const escalate = subjects.find((s) => s.type === 'action:escalate')!;
    const bases = escalate.instances.map((i) => instanceFacts(i));
    assert.equal(bases.filter((b) => b['obs.states_double_charge'] === true).length, 5, 'lifted from the complaint turn into every escalate decision point');

    // And nowhere else: no refund, no rate quote says it.
    const refund = subjects.find((s) => s.type === 'action:issue_refund')!;
    assert.ok(refund.instances.every((i) => !('obs.states_double_charge' in instanceFacts(i))));

    // Which is exactly the shape G2 admits: one value, present on some
    // instances of a subject and absent on the rest.
    const all = subjects.flatMap((s) => s.instances.map((i) => instanceFacts(i)));
    assert.ok(candidateConditions(all, ws.thresholds).some((c) => c.fact === 'obs.states_double_charge' && c.value === true), 'the observed fact is a candidate condition');
  } finally {
    ws.cleanup();
  }
});

test('given a fixed annotation file, mining is byte-for-byte reproducible (JF6.4)', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const { set } = parsePredicateSet(SET(corpus.revision, corpus.alphabet.version));
    const profile = loadTextProfile(builtinTextProfile('synthetic')!);
    const r = await annotate(corpus, set, profile, stub, ws.dir);
    const a = await mine(await loadCorpus(ws.config, 'synthetic'), ws.thresholds, { minedAt: 1, annotations: r.file! });
    const b = await mine(await loadCorpus(ws.config, 'synthetic'), ws.thresholds, { minedAt: 1, annotations: r.file! });
    assert.equal(JSON.stringify(a.rules), JSON.stringify(b.rules));
    assert.equal(JSON.stringify(a.contradictions), JSON.stringify(b.contradictions));
    assert.deepEqual(a.observation, b.observation);
    // The guarantee is unchanged in form; it has one more pinned input.
    assert.equal(a.observation!.digest, r.file!.digest);
  } finally {
    ws.cleanup();
  }
});
