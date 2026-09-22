// The live path (JT8.2–JT8.4). A request may carry text; the server redacts
// it, observes it, and calls the advisor with what was observed. The advisor
// stays pure; the log carries every observation with its p; and when nothing
// can observe, the server answers exactly as it did before observation
// existed and says so by name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinTextProfile, loadTextProfile, parsePredicateSet, type Observer, type Rule } from 'polyx-lens';
import { parseRequest, type AdviseRequest } from '../src/serve/advisor.ts';
import { startAdvisorServer, type ServeOptions } from '../src/serve/http.ts';
import { LiveObserver } from '../src/serve/observe.ts';
import { openStore } from '../src/store/db.ts';
import { persistMined } from '../src/store/rules.ts';
import { tempWorkspace } from './helpers.ts';

const ANY: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

/** "Before you escalate, verify identity — when the customer states a double charge." Real. */
const RULE: Rule = {
  id: 'escalate-needs-verify',
  family: 'obligation',
  pattern: 'X-implies-prior-Y',
  bindings: { subject: 'action:escalate', guard: 'action:verify_identity' },
  conditions: [{ fact: 'obs.states_double_charge', op: 'eq', value: true }],
  window: 'episode',
  support: { holds: 5, of: 5 },
  corpusSupport: { holds: 5, of: 5 },
  counterexamples: [],
  examples: [],
  provenance: { kind: 'own', level: 'operator', scope: 'op-alpha' },
  status: 'real',
  predicates: { js: '' },
  alphabetVersion: 2,
  minedAt: 0,
  text: 'When the customer states a double charge, verify identity before escalating.',
  evidence: 'held 5 of 5 times',
  corpus: 'synthetic',
  scope: 'op-alpha',
};

const SET = parsePredicateSet(`corpus: synthetic
version: 1
model: stub
redaction: text.synthetic@1
predicates:
  - id: states_double_charge
    fact: obs.states_double_charge
    status: real
    quadrant: text-unknown
    source: event.text
    window: event
    question: Does this message state a double charge?
    bands: { assertAt: 0.85, refuteAt: -1 }
    calibration: { at: '2026-09-19', corpusRevision: REV, alphabetVersion: 2, n: 60, labels: { true: 30, false: 30 }, assertPrecision: 1, refutePrecision: null, withheldFraction: 0.5, reviewer: t }
`).set;

/** Reads the (redacted) text for real; the answer for "charged twice" sits above the band. */
function stub(): Observer & { seen: string[] } {
  const seen: string[] = [];
  return {
    name: 'stub',
    version: 1,
    seen,
    async observe(text, predicates) {
      seen.push(text);
      return predicates.map((p) => ({ predicate: p.id, fact: p.fact, value: null, p: /charged twice/i.test(text) ? 0.96 : 0.05 }));
    },
  };
}

const observation = (observer: Observer, budget?: number): NonNullable<ServeOptions['observation']> => ({
  observer,
  set: SET,
  profile: loadTextProfile(builtinTextProfile('synthetic')!),
  corpusRevision: 'REV',
  alphabetVersion: 2,
  ...(budget !== undefined ? { budget } : {}),
});

function seedStore(dbPath: string, thresholds: Parameters<typeof persistMined>[4]): void {
  const store = openStore(dbPath);
  const manifest = { runId: 'r', command: 'mine', at: 0, corpus: 'synthetic', corpusRevision: 'REV', alphabetVersion: 2, alphabetFile: 'x', thresholds, seed: 1, codeCommit: null, segmenter: 'null' };
  store
    .prepare('INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('r', 'mine', 0, 'synthetic', 'REV', 2, JSON.stringify(thresholds), 1, null, JSON.stringify(manifest));
  persistMined(store, manifest, [RULE], [], thresholds);
  store.close();
}

const COMPLAINT: AdviseRequest = {
  operator: 'op-alpha',
  episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent', text: 'My account ACC-99887766 was charged twice for the same order.' }] },
  considering: 'action:escalate',
};

test('parseRequest accepts text on an event and refuses anything but a string', () => {
  assert.equal(parseRequest({ operator: 'o', episode: { events: [{ type: 'x', text: 'hello' }] } }).episode.events[0]!.text, 'hello');
  assert.throws(() => parseRequest({ operator: 'o', episode: { events: [{ type: 'x', text: 42 }] } }), /text must be a string/);
});

test('LiveObserver: text is redacted before it is observed, and the fact is re-derived through the declared bands', async () => {
  const s = stub();
  const live = new LiveObserver(observation(s));
  const r = await live.resolve(COMPLAINT);
  assert.equal(r.observer, 'stub');
  assert.deepEqual(r.obs.map((o) => [o.fact, o.value, o.p]), [['obs.states_double_charge', true, 0.96]]);
  assert.equal(s.seen.length, 1);
  assert.doesNotMatch(s.seen[0]!, /ACC-99887766/, 'the seeded identifier never reaches the observer');
  assert.match(s.seen[0]!, /account#[0-9a-f]{12}/);
});

test('LiveObserver: later events win, a withholding never retracts, and no text means no call', async () => {
  const s = stub();
  const live = new LiveObserver(observation(s));
  const r = await live.resolve({ ...COMPLAINT, episode: { events: [{ type: 'a', text: 'charged twice' }, { type: 'b', text: 'thanks, that is all' }] } });
  assert.equal(r.obs[0]!.value, true, 'the second text withheld, and did not retract the first');
  assert.equal(s.seen.length, 2, 'two distinct texts, two calls');
  const none = await live.resolve({ operator: 'o', episode: { events: [{ type: 'a' }] } });
  assert.equal(none.observer, 'null (no text in the request)');
  assert.equal(s.seen.length, 2, 'nothing was asked');
});

test('LiveObserver: a stale calibration makes the predicate inert on the live path too (JF3.5)', async () => {
  const live = new LiveObserver({ ...observation(stub()), corpusRevision: 'moved' });
  assert.equal(live.active.length, 0);
  assert.equal((await live.resolve(COMPLAINT)).observer, 'null (no real, calibrated predicate)');
});

test('LiveObserver: unreachable and budget both fall back to nothing, by name, without throwing (JT8.4)', async () => {
  const broken: Observer = { name: 'broken', version: 1, observe: async () => { throw new Error('ECONNREFUSED'); } };
  const r = await new LiveObserver(observation(broken)).resolve(COMPLAINT);
  assert.match(r.observer, /^null \(unreachable: ECONNREFUSED\)/);
  assert.deepEqual(r.obs, []);

  const capped = new LiveObserver(observation(stub(), 1));
  assert.equal((await capped.resolve(COMPLAINT)).observer, 'stub');
  assert.equal((await capped.resolve(COMPLAINT)).observer, 'null (budget spent)');
});

test('serve: a request carrying text surfaces a warning that was hidden behind an unknown fact, and the log carries the observation with its p', async () => {
  const ws = tempWorkspace();
  seedStore(ws.config.dbPath, ws.thresholds);
  const s = stub();
  const srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'synthetic', recommendable: ANY, observation: observation(s) });
  try {
    const post = async (body: unknown) => (await fetch(`${srv.url}advise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<{ verdict: string; warnings: Array<{ unsatisfied: string }>; abstention?: { missing: string[] } }>;

    // Without text: the rule's condition is unknown → abstain, naming it.
    const cold = await post({ ...COMPLAINT, episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent' }] } });
    assert.equal(cold.verdict, 'abstain');
    assert.deepEqual(cold.abstention!.missing, ['obs.states_double_charge']);

    // With text: observed true, guard absent → the warning that was hidden.
    const warm = await post(COMPLAINT);
    assert.equal(warm.verdict, 'warn');
    assert.equal(warm.warnings[0]!.unsatisfied, 'action:verify_identity');

    // The decision log: which observer, and every observation with its p. No text.
    const store = openStore(ws.config.dbPath);
    const rows = store.prepare('SELECT verdict, observer, observations_json FROM decision_points ORDER BY id').all() as Array<{ verdict: string; observer: string | null; observations_json: string | null }>;
    store.close();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.observer, 'null (no text in the request)');
    assert.equal(rows[0]!.observations_json, null);
    assert.equal(rows[1]!.observer, 'stub');
    assert.deepEqual(JSON.parse(rows[1]!.observations_json!), [{ predicate: 'states_double_charge', fact: 'obs.states_double_charge', value: true, p: 0.96, pv: 1 }]);
    assert.doesNotMatch(JSON.stringify(rows), /charged twice|ACC-/, 'the log never stores text');
  } finally {
    await srv.close();
    ws.cleanup();
  }
});

test('serve: with no observation configured the response and the record are as they were before observation existed (JF5.3)', async () => {
  const ws = tempWorkspace();
  seedStore(ws.config.dbPath, ws.thresholds);
  const srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'synthetic', recommendable: ANY });
  try {
    assert.equal(srv.observer, null);
    const r = (await (await fetch(`${srv.url}advise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(COMPLAINT) })).json()) as { verdict: string };
    assert.equal(r.verdict, 'abstain', 'text is carried but nobody reads it');
    const store = openStore(ws.config.dbPath);
    const row = store.prepare('SELECT observer, observations_json FROM decision_points').get() as { observer: string | null; observations_json: string | null };
    store.close();
    assert.deepEqual({ ...row }, { observer: null, observations_json: null });
  } finally {
    await srv.close();
    ws.cleanup();
  }
});
