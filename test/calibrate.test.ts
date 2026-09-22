// `polyx calibrate` (JF3, W3.1). The sample, the label file, and the walk from
// a reviewer's verdicts to a calibration record. No key is needed: the model
// sits behind the observation port, so a stub stands in for it and the whole
// path runs offline.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinTextProfile, loadCorpus, loadTextProfile, type Observer, type Predicate } from '@cognitive-fab/polyx-lens';
import { nullObserver } from '@cognitive-fab/polyx-lens';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  deriveFrom,
  drawSample,
  labelFileFor,
  measure,
  observedFrom,
  progressOf,
  readLabelFile,
  sitesFor,
  writeLabelFile,
  CalibrationIncomplete,
  type LabelFile,
} from '../src/ports/jev/calibrate.ts';
import { tempWorkspace } from './helpers.ts';

const PROFILE = loadTextProfile(builtinTextProfile('synthetic')!);

const PREDICATE: Predicate = {
  id: 'mentions_refund',
  fact: 'obs.mentions_refund',
  status: 'proposed',
  quadrant: 'text-unknown',
  source: 'event.text',
  window: 'event',
  question: 'Does this message mention a refund?',
  bands: { assertAt: 0.85, refuteAt: -1 },
};

/**
 * A stub that reads the text for real — a substring test standing in for the
 * model — and returns a separated, slightly jittering probability. Jitter is
 * not decoration: the model is not bit-stable, and a derivation that only
 * works on clean numbers would be a derivation that never runs in production.
 */
const stubObserver = (n = 0): Observer => ({
  name: 'stub',
  version: 1,
  async observe(text, predicates) {
    const hit = /refund/i.test(text);
    const jitter = ((n++ % 3) - 1) * 0.01;
    return predicates.map((p) => ({
      predicate: p.id,
      fact: p.fact,
      value: null,
      p: Math.round((hit ? 0.95 + jitter : 0.04 + jitter) * 100) / 100,
    }));
  },
});

test('sites carry resolved text, and sites without text are not sampled', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const sites = sitesFor(corpus, PREDICATE, PROFILE);
    assert.ok(sites.length > 0, 'the synthetic fixture carries text on its turns');
    for (const s of sites) {
      assert.ok(s.text.trim().length > 0);
      assert.match(s.sha, /^[0-9a-f]{16}$/);
      // Redacted: the labeller labels what the model will be asked, and the
      // label file never holds a seeded identifier.
      assert.doesNotMatch(s.text, /jane\.doe@example\.com|ACC-\d{8}/);
    }
    assert.ok(sites.some((s) => /email#[0-9a-f]{12}/.test(s.text)), 'the surrogate is what the model sees');
    // Action turns carry no utterance. If every event were sampled, the
    // sample would be padded with items no predicate can read.
    assert.ok(sites.length < corpus.interactions.reduce((n, i) => n + i.events.length, 0));
  } finally {
    ws.cleanup();
  }
});

test('the sample is deterministic in the seed, and drawn over DISTINCT texts', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const sites = sitesFor(corpus, PREDICATE, PROFILE);
    const a = drawSample(sites, PREDICATE, 20, 1);
    const b = drawSample(sites, PREDICATE, 20, 1);
    assert.deepEqual(a.map((x) => x.sha), b.map((x) => x.sha), 'same seed, same sample — a second reviewer labels the same items');
    const c = drawSample(sites, PREDICATE, 20, 2);
    assert.notDeepEqual(a.map((x) => x.sha), c.map((x) => x.sha));
    // Labelling one templated message forty times is forty labels and one
    // item of evidence.
    assert.equal(new Set(a.map((x) => x.sha)).size, a.length);
    // A different predicate draws a different sample from the same corpus.
    const other = drawSample(sites, { ...PREDICATE, id: 'other' }, 20, 1);
    assert.notDeepEqual(a.map((x) => x.sha), other.map((x) => x.sha));
  } finally {
    ws.cleanup();
  }
});

test('the label file round-trips, and carries no p until labelling is done', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const drawn = drawSample(sitesFor(corpus, PREDICATE, PROFILE), PREDICATE, 12, 1);
    mkdirSync(join(ws.config.workspace, 'labels'), { recursive: true });
    const file = labelFileFor(ws.config.workspace, 'synthetic', PREDICATE.id);
    const lf: LabelFile = {
      corpus: 'synthetic',
      predicate: PREDICATE.id,
      question: PREDICATE.question,
      predicateSetVersion: 1,
      corpusRevision: corpus.revision,
      alphabetVersion: corpus.alphabet.version,
      seed: 1,
      reviewer: null,
      items: drawn.map((s) => ({ ...s })),
    };
    writeLabelFile(file, lf);
    const back = readLabelFile(file)!;
    assert.equal(back.items.length, 12);
    assert.ok(back.items.every((i) => i.p === undefined), 'a labeller shown the answer is being asked to agree, not to judge');
    // Nothing has been looked at: not labelled, and not "unsure" either.
    assert.deepEqual(progressOf(back), { total: 12, labelled: 0, unsure: 0, trueN: 0, falseN: 0 });
    assert.ok(back.items.every((i) => !('label' in i)), 'an unlabelled item carries no label key, so it cannot be mistaken for an unsure one');
  } finally {
    ws.cleanup();
  }
});

/** A labelled file, labelled the way a person would: by reading the text. */
async function labelled(ws: ReturnType<typeof tempWorkspace>, n = 70): Promise<LabelFile> {
  const corpus = await loadCorpus(ws.config, 'synthetic');
  const sites = sitesFor(corpus, PREDICATE, PROFILE);
  const drawn = drawSample(sites, PREDICATE, Math.min(n, sites.length), 1);
  return {
    corpus: 'synthetic',
    predicate: PREDICATE.id,
    question: PREDICATE.question,
    predicateSetVersion: 1,
    corpusRevision: corpus.revision,
    alphabetVersion: corpus.alphabet.version,
    seed: 1,
    reviewer: 'test',
    items: drawn.map((s) => ({ ...s, label: /refund/i.test(s.text) })),
  };
}

test('measure attaches one probability per DISTINCT text, and the null observer attaches none', async () => {
  const ws = tempWorkspace();
  try {
    const lf = await labelled(ws, 20);
    const withP = await measure(lf, PREDICATE, stubObserver());
    assert.ok(withP.items.every((i) => typeof i.p === 'number'));

    // JT8.4's failure direction, at calibration time: no key, no numbers, and
    // the labels are not lost.
    const none = await measure(lf, PREDICATE, nullObserver);
    assert.ok(none.items.every((i) => i.p === undefined));
    assert.deepEqual(observedFrom(none), { true: [], false: [] });
  } finally {
    ws.cleanup();
  }
});

test('with no key the derivation says so, rather than writing a record built on absent numbers', async () => {
  const ws = tempWorkspace();
  try {
    const lf = await measure(await labelled(ws), PREDICATE, nullObserver);
    assert.throws(() => deriveFrom(lf, PREDICATE, ws.thresholds, 'jjd', {} as never), CalibrationIncomplete);
  } finally {
    ws.cleanup();
  }
});

test('a labelled, measured sample derives a record the predicate set can carry', async () => {
  const ws = tempWorkspace({ minCalibration: 20, minCalibrationPerLabel: 5 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const lf = await measure(await labelled(ws, 40), PREDICATE, stubObserver());
    const o = observedFrom(lf);
    // The fixture's balance is a fact about the fixture, so assert it rather
    // than guarding on it: a guard here would let the test pass while
    // measuring nothing.
    assert.deepEqual([o.true.length, o.false.length], [22, 13]);
    const record = deriveFrom(lf, PREDICATE, ws.thresholds, 'jjd', corpus);
    assert.equal(record.reviewer, 'jjd');
    assert.equal(record.corpusRevision, corpus.revision);
    assert.equal(record.n, o.true.length + o.false.length);
    assert.ok(record.assertPrecision >= 0.9);
    assert.ok((record.labelSeparation ?? 0) > 0.2, 'a predicate reading the text separates its labels');
    assert.ok(record.observed, 'the distribution is retained so a band change needs no fresh pass');
  } finally {
    ws.cleanup();
  }
});

// ---------------------------------------------------------------------------
// The labelling surface.

import { startLabelServer } from '../src/ports/jev/label-server.ts';

test('the label server serves one text at a time, never p, and saves each verdict as given', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const drawn = drawSample(sitesFor(corpus, PREDICATE, PROFILE), PREDICATE, 6, 1);
    mkdirSync(join(ws.config.workspace, 'labels'), { recursive: true });
    const file = labelFileFor(ws.config.workspace, 'synthetic', PREDICATE.id);
    writeLabelFile(file, {
      corpus: 'synthetic',
      predicate: PREDICATE.id,
      question: PREDICATE.question,
      predicateSetVersion: 1,
      corpusRevision: corpus.revision,
      alphabetVersion: corpus.alphabet.version,
      seed: 1,
      reviewer: null,
      items: drawn.map((s) => ({ ...s })),
    });
    const srv = await startLabelServer({ labelFile: file });
    try {
      const page = await (await fetch(srv.url)).text();
      assert.match(page, /polyx calibrate/);
      assert.doesNotMatch(page, /probab|confidence/i, 'the page must not even mention the model\'s answer');

      const first = (await (await fetch(`${srv.url}api/next`)).json()) as { item: { key: string; text: string } | null; question: string; progress: { labelled: number } };
      assert.equal(first.question, PREDICATE.question);
      assert.ok(first.item);
      assert.equal(first.progress.labelled, 0);
      assert.ok(!('p' in first.item!), 'p is never sent to the labeller');

      // No reviewer name: refused, because the record names who labelled it.
      const anon = await fetch(`${srv.url}api/label`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: first.item!.key, label: true, reviewer: '' }) });
      assert.equal(anon.status, 400);

      const post = (key: string, label: boolean | null) =>
        fetch(`${srv.url}api/label`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, label, reviewer: 'jjd' }) });
      assert.equal((await post(first.item!.key, true)).status, 200);

      const second = (await (await fetch(`${srv.url}api/next`)).json()) as { item: { key: string } | null; progress: { labelled: number; trueN: number } };
      assert.notEqual(second.item?.key, first.item!.key, 'a labelled item is not served again');
      assert.deepEqual([second.progress.labelled, second.progress.trueN], [1, 1]);

      // "Can't tell" is a verdict, saved as null, distinct from not-yet-labelled.
      assert.equal((await post(second.item!.key, null)).status, 200);
      const back = readLabelFile(file)!;
      assert.equal(back.reviewer, 'jjd');
      const byKey = new Map(back.items.map((i) => [`${i.interactionId}|${i.seq}`, i]));
      assert.equal(byKey.get(first.item!.key)!.label, true);
      assert.equal(byKey.get(second.item!.key)!.label, null);
      assert.equal(progressOf(back).unsure, 1);
      assert.equal(progressOf(back).labelled, 2);
      assert.ok(back.items.every((i) => i.p === undefined), 'labelling wrote no probabilities');
    } finally {
      await srv.close();
    }
  } finally {
    ws.cleanup();
  }
});
