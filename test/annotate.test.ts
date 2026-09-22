// `polyx annotate` (JF6.1, JT5, JT7). The pass runs here against a stub
// observer, so the whole path — resolve, redact, group, call once per
// distinct text, record, digest — is exercised with no key and no network.
//
// The stored-artefact scan at the end is the test that matters (F1.3): the
// preview, the annotation file and the label file are three new places
// text-derived bytes can land, and a redactor that is correct but not applied
// to one of them is the failure mode the scan exists to catch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  annotationPath,
  loadCorpus,
  loadTextProfile,
  builtinTextProfile,
  parsePredicateSet,
  readAnnotations,
  type Observer,
  type PredicateSet,
} from '@cognitive-fab/polyx-lens';
import { annotate, resolveSites, writePreview } from '../src/ports/jev/annotate.ts';
import { FIXTURES, tempWorkspace } from './helpers.ts';

const seeded = (JSON.parse(readFileSync(join(FIXTURES, 'synthetic', 'seeded.json'), 'utf8')) as { identifiers: string[] }).identifiers;

const SET_YAML = `corpus: synthetic
version: 1
model: jev-latest
redaction: text.synthetic@1
predicates:
  - id: mentions_refund
    fact: obs.mentions_refund
    status: real
    quadrant: text-unknown
    source: event.text
    window: event
    question: Does this message mention a refund?
    bands: { assertAt: 0.85, refuteAt: -1 }
    calibration:
      at: '2026-09-19'
      corpusRevision: REV
      alphabetVersion: ALPHA
      n: 60
      labels: { true: 30, false: 30 }
      assertPrecision: 0.97
      refutePrecision: null
      withheldFraction: 0.5
      reviewer: test
  - id: asks_a_question
    fact: obs.asks_a_question
    status: real
    quadrant: text-closed
    source: event.text
    window: event
    question: Is this a question?
    bands: { assertAt: 0.85, refuteAt: 0.15 }
    calibration:
      at: '2026-09-19'
      corpusRevision: REV
      alphabetVersion: ALPHA
      n: 60
      labels: { true: 30, false: 30 }
      assertPrecision: 0.95
      refutePrecision: 0.95
      withheldFraction: 0.1
      reviewer: test
  - id: never_calibrated
    fact: obs.never_calibrated
    status: proposed
    quadrant: text-unknown
    source: event.text
    window: event
    question: Is this message about shipping?
    bands: { assertAt: 0.85, refuteAt: -1 }
`;

async function setup(ws: ReturnType<typeof tempWorkspace>): Promise<{ corpus: Awaited<ReturnType<typeof loadCorpus>>; set: PredicateSet; profile: ReturnType<typeof loadTextProfile> }> {
  const corpus = await loadCorpus(ws.config, 'synthetic');
  const { set } = parsePredicateSet(SET_YAML.replace(/REV/g, corpus.revision).replace(/ALPHA/g, String(corpus.alphabet.version)));
  const profile = loadTextProfile(builtinTextProfile('synthetic')!);
  return { corpus, set, profile };
}

/** Reads the text for real, answers with a jitter, and counts its calls. */
function stub(): Observer & { calls: number; texts: string[] } {
  let n = 0;
  const s = {
    name: 'stub',
    version: 1,
    calls: 0,
    texts: [] as string[],
    async observe(text: string, predicates: Parameters<Observer['observe']>[1]) {
      s.calls++;
      s.texts.push(text);
      const jitter = ((n++ % 3) - 1) * 0.01;
      return predicates.map((p) => {
        const hit = p.id === 'mentions_refund' ? /refund/i.test(text) : /\?/.test(text);
        const prob = Math.round((hit ? 0.95 + jitter : 0.04 + jitter) * 100) / 100;
        return { predicate: p.id, fact: p.fact, value: prob >= p.bands.assertAt ? true : prob <= p.bands.refuteAt ? false : null, p: prob, raw: { extra: 'kept' }, model: 'stub-1.0' };
      });
    },
  };
  return s;
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

test('sites are resolved only for real, calibrated predicates; the rest are reported, not dropped', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const r = resolveSites(corpus, set, profile);
    assert.ok(r.sites.length > 0);
    assert.deepEqual(r.skipped, [{ predicate: 'never_calibrated', reason: 'status proposed' }]);
    assert.ok(r.unobservable > 0, 'action turns carry no text');
    for (const s of r.sites) {
      assert.equal(s.predicates.length, 2, 'both active predicates read the same text, so they share the site');
      for (const id of seeded) assert.ok(!s.text.includes(id), `site text still carries ${id}`);
    }
  } finally {
    ws.cleanup();
  }
});

test('a stale calibration makes the predicate inert for the pass (JF3.5)', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const stale = { ...set, predicates: set.predicates.map((p) => (p.id === 'mentions_refund' ? { ...p, calibration: { ...p.calibration!, corpusRevision: 'elsewhere' } } : p)) };
    const r = resolveSites(corpus, stale, profile);
    assert.ok(r.skipped.some((s) => s.predicate === 'mentions_refund' && /stale/.test(s.reason)));
  } finally {
    ws.cleanup();
  }
});

test('the pass calls once per distinct redacted text, and records every predicate at every site', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const obs = stub();
    const r = await annotate(corpus, set, profile, obs, ws.dir, { now: () => 1758240000 });
    assert.equal(obs.calls, r.distinct, 'one call per distinct text');
    assert.equal(r.callsMade, r.distinct);
    assert.equal(r.callsSaved, r.sites - r.distinct, 'every repeated text was answered from the cache');
    assert.ok(r.callsSaved > 0, 'the fixture repeats agent messages, as real corpora do');
    assert.ok(r.file);
    assert.equal(r.file!.lines.length, r.sites * 2, 'two predicates per site, withheld lines included');
    assert.equal(r.partial, false);
    // Every line carries what JT3 requires.
    for (const l of r.file!.lines) {
      assert.equal(l.pv, 1);
      assert.equal(l.redaction, 'text.synthetic@1');
      assert.match(l.sha, /^[0-9a-f]{16}$/);
      assert.equal(l.at, 1758240000);
      assert.ok(l.value === true || l.value === false || l.value === null);
      assert.deepEqual(l.raw, { extra: 'kept' }, 'whatever else the answer carried is retained verbatim (W0.3)');
      assert.equal(l.model, 'stub-1.0', 'the model that answered is on every line');
    }
    assert.deepEqual(r.models, ['stub-1.0']);
    // The file on disk is what the reader reads back, digest and all.
    const back = readAnnotations(annotationPath(ws.dir, 'synthetic', 1))!;
    assert.equal(back.digest, r.file!.digest);
    assert.equal(back.lines.length, r.file!.lines.length);
    // And every text that was sent was the REDACTED text.
    for (const t of obs.texts) for (const id of seeded) assert.ok(!t.includes(id), `${id} was sent`);
  } finally {
    ws.cleanup();
  }
});

test('a withheld observation is recorded with its p, and a refuting predicate can record false', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const r = await annotate(corpus, set, profile, stub(), ws.dir);
    const lines = r.file!.lines;
    const withheld = lines.filter((l) => l.pred === 'mentions_refund' && l.value === null);
    assert.ok(withheld.length > 0, 'assert-only: every non-refund text is withheld, not refuted');
    assert.ok(withheld.every((l) => typeof l.p === 'number'));
    assert.ok(lines.filter((l) => l.pred === 'mentions_refund' && l.value === false).length === 0, 'assert-only never contributes a false');
    assert.ok(lines.some((l) => l.pred === 'asks_a_question' && l.value === false), 'the refuting predicate does');
  } finally {
    ws.cleanup();
  }
});

test('the budget stops the pass and marks the file partial (JT8.5)', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const obs = stub();
    const r = await annotate(corpus, set, profile, obs, ws.dir, { budget: 3, concurrency: 1 });
    assert.equal(r.callsMade, 3);
    assert.equal(r.partial, true);
    assert.match(r.file!.path, /\.partial\.jsonl$/);
    assert.ok(r.file!.lines.length > 0, 'a partial file is usable');
    const back = readAnnotations(annotationPath(ws.dir, 'synthetic', 1))!;
    assert.equal(back.partial, true);
  } finally {
    ws.cleanup();
  }
});

test('the null observer records nothing, and says so rather than writing an empty file', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const nul: Observer = { name: 'null', version: 1, observe: async () => [] };
    const r = await annotate(corpus, set, profile, nul, ws.dir);
    assert.equal(r.file, null);
    assert.equal(readAnnotations(annotationPath(ws.dir, 'synthetic', 1)), null);
  } finally {
    ws.cleanup();
  }
});

test('the dry run writes every payload as it would be sent, with what it was, and sends nothing (JT7.3)', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    const path = join(ws.dir, 'synthetic.preview.jsonl');
    const r = writePreview(path, corpus, set, profile);
    assert.ok(r.distinct > 0);
    assert.deepEqual(r.skipped, [{ predicate: 'never_calibrated', reason: 'status proposed' }]);
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { before: string | null; after: string; fired: Record<string, number>; predicates: string[]; redaction: string });
    assert.equal(lines.length, r.distinct);
    // The preview runs every DECLARED predicate, calibrated or not: the
    // reviewer is looking at what would leave the machine.
    assert.ok(lines.some((l) => l.predicates.includes('never_calibrated')));
    for (const l of lines) {
      assert.equal(l.redaction, 'text.synthetic@1');
      for (const id of seeded) assert.ok(!l.after.includes(id), `${id} in a payload`);
    }
    // …and `before` is there so the reviewer can see what each rule caught.
    assert.ok(lines.some((l) => l.before !== null && l.before !== l.after && Object.keys(l.fired).length > 0));
  } finally {
    ws.cleanup();
  }
});

test('no seeded identifier reaches the annotation file — the preview is the one file allowed to hold the original', async () => {
  const ws = tempWorkspace();
  try {
    const { corpus, set, profile } = await setup(ws);
    await annotate(corpus, set, profile, stub(), ws.dir);
    const hits: string[] = [];
    for (const f of files(ws.dir)) {
      const text = readFileSync(f).toString('latin1');
      for (const id of seeded) if (text.includes(id)) hits.push(`${id} in ${f}`);
    }
    assert.deepEqual(hits, []);
  } finally {
    ws.cleanup();
  }
});
