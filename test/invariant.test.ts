// The safety invariant (JF7), as a property test (JF7.4, JT9.3).
//
// Let F be the fact base the advisor builds today and O the observed facts.
// Observation only ever adds keys (JF5.2), so a condition over a key already
// in F is unaffected, and only a rule that was UNKNOWN can move. Therefore:
//
//   JF7.1  no warning is withdrawn      every warning raised under F is raised under F+O
//   JF7.2  no abstention is created     `missing` is monotonically non-increasing
//   JF7.3  verdicts move one way        abstain < clear < recommend < warn, non-decreasing
//
// Switching observation on can surface a warning that was hidden behind an
// unknown fact, and can turn an abstention into an answer. It cannot make
// the advisor go quiet where it used to speak, and it cannot make it bless
// an action it used to warn about. That is what lets a reviewer adopt a
// predicate without re-validating the rules that already worked, and it is
// what a bank will ask to see.
//
// So this test does not assert it on one example. It drives the advisor
// over every decision point of the synthetic corpus and a few hundred
// random rule sets, with random observation sets that include withheld,
// asserting, and refuting observations over every fact name a rule could
// mention — including deliberate collisions with slot and caller facts,
// which JF5.2's precedence must render harmless.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consequentialTypes, loadCorpus, naiveExtractor, type Observation, type Rule } from '@cognitive-fab/polyx-lens';
import { decisionPoints } from '../src/mine/recommend.ts';
import { Advisor, factsAt, type AdviseRequest, type AdviseResponse } from '../src/serve/advisor.ts';
import { tempWorkspace } from './helpers.ts';

/** A small deterministic PRNG, so a failure reproduces from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

const ORDER: Record<AdviseResponse['verdict'], number> = { abstain: 0, clear: 1, recommend: 2, warn: 3 };
const ANY: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

const FACTS = ['obs.a', 'obs.b', 'obs.c', 'slot.account_id', 'slot.amount', 'episode.intent', 'customer.member_level'];
const VALUES: Array<string | number | boolean> = [true, false, 'x', 'intent:complaint', 1];

const rule = (r: () => number, i: number, actions: string[], subjects: string[]): Rule => {
  const obligation = r() < 0.5;
  const conditions = Array.from({ length: Math.floor(r() * 3) }, () => ({ fact: FACTS[Math.floor(r() * FACTS.length)]!, op: 'eq' as const, value: VALUES[Math.floor(r() * VALUES.length)]! }));
  const patterns = ['X-implies-prior-Y', 'no-X-without-prior-Y', 'at-most-one-X', 'exactly-one-Y-per-X'] as const;
  const pattern = obligation ? patterns[Math.floor(r() * patterns.length)]! : 'antecedent-implies-action';
  const subject = subjects[Math.floor(r() * subjects.length)]!;
  const guard = subjects[Math.floor(r() * subjects.length)]!;
  return {
    id: `r${i}`,
    family: obligation ? 'obligation' : 'recommendation',
    pattern,
    bindings: obligation ? (pattern === 'at-most-one-X' ? { subject } : { subject, guard }) : { action: actions[Math.floor(r() * actions.length)]! },
    conditions,
    window: 'episode',
    support: { holds: 9, of: 10 },
    corpusSupport: { holds: 9, of: 10 },
    counterexamples: [],
    examples: [],
    provenance: { kind: 'own', level: 'operator', scope: 'op-alpha' },
    status: 'real',
    predicates: { js: '' },
    alphabetVersion: 1,
    minedAt: 0,
    text: '',
    evidence: '',
    corpus: 'synthetic',
    scope: 'op-alpha',
  };
};

/** A random observation set: some withheld, some asserting, some refuting, over every fact name — collisions included. */
const observations = (r: () => number): Observation[] =>
  FACTS.filter(() => r() < 0.6).map((fact) => {
    const p = r();
    const value = p > 0.8 ? true : p < 0.2 ? false : null;
    return { predicate: fact, fact, value, p };
  });

function check(advisor: Advisor, req: AdviseRequest, obs: Observation[], where: string): void {
  const before = advisor.advise(req);
  const after = advisor.advise(req, obs);

  // JF7.1 — every warning raised without observation is raised with it.
  const warned = (x: AdviseResponse) => new Set(x.warnings.map((w) => `${w.rule.id}|${w.unsatisfied}`));
  for (const w of warned(before)) assert.ok(warned(after).has(w), `${where}: warning ${w} was WITHDRAWN by observation`);

  // JF7.2 — `missing` is monotonically non-increasing.
  const missing = (x: AdviseResponse) => new Set(x.abstention?.missing ?? []);
  for (const m of missing(after)) assert.ok(missing(before).has(m), `${where}: observation CREATED an abstention on ${m}`);

  // JF7.3 — abstain < clear < recommend < warn, non-decreasing.
  assert.ok(ORDER[after.verdict] >= ORDER[before.verdict], `${where}: verdict moved ${before.verdict} → ${after.verdict}`);

  // And an answered decision point stays answered.
  if (before.coverage.answered) assert.ok(after.coverage.answered, `${where}: an answered decision point became an abstention`);
}

test('JF7: over every decision point of the synthetic corpus, observation never withdraws a warning, never creates an abstention, and moves verdicts one way', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
    const points = decisionPoints(subjects);
    const actions = [...new Set(points.map((p) => p.action))];
    const subjectTypes = subjects.map((s) => s.type);
    assert.ok(points.length >= 40);

    let checks = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed * 7919);
      const rules = Array.from({ length: 12 }, (_, i) => rule(r, i, actions, subjectTypes));
      const advisor = new Advisor(rules, ANY);
      for (const p of points) {
        const i = p.instance;
        const req: AdviseRequest = {
          operator: i.actor.operatorId,
          episode: { events: i.before.map((e) => ({ type: e.type, kind: e.kind, slots: e.slots })) },
          // Half the time the caller states something too, including names an
          // observation will collide with: JF5.2 has to make that harmless.
          ...(r() < 0.5 ? { facts: { 'customer.member_level': 'gold', ...(r() < 0.3 ? { 'obs.a': false } : {}) } } : {}),
          considering: p.action,
        };
        for (let k = 0; k < 3; k++) {
          check(advisor, req, observations(r), `seed ${seed} point ${p.episodeId} obs-set ${k}`);
          checks++;
        }
      }
    }
    assert.ok(checks > 8000, `ran ${checks} checks`);
  } finally {
    ws.cleanup();
  }
});

test('JF5.2: an observation never displaces a fact that was already there', () => {
  const req: AdviseRequest = {
    operator: 'op',
    episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent' }, { type: 'action:x', slots: { account_id: 'from-slot' } }] },
    facts: { 'customer.member_level': 'gold', 'obs.a': 'from-caller' },
  };
  const obs: Observation[] = [
    { predicate: 'a', fact: 'obs.a', value: true, p: 0.99 }, // collides with the caller: the caller wins
    { predicate: 's', fact: 'slot.account_id', value: false, p: 0.01 }, // collides with a slot: the slot wins
    { predicate: 'i', fact: 'episode.intent', value: true, p: 0.99 }, // collides with the intent: the intent wins
    { predicate: 'b', fact: 'obs.b', value: true, p: 0.99 }, // adds
    { predicate: 'c', fact: 'obs.c', value: null, p: 0.5 }, // withheld: adds nothing
  ];
  const f = factsAt(req, obs);
  assert.equal(f['obs.a'], 'from-caller');
  assert.equal(f['slot.account_id'], 'from-slot');
  assert.equal(f['episode.intent'], 'intent:complaint');
  assert.equal(f['obs.b'], true);
  assert.equal('obs.c' in f, false, 'withheld → absent → unknown, never false');
});

test('JF5.3: with an empty observation set the advisor is byte-identical to today', () => {
  const req: AdviseRequest = { operator: 'op', episode: { events: [{ type: 'intent:complaint', kind: 'customer_intent' }] }, facts: { x: 1 }, considering: 'action:y' };
  const advisor = new Advisor([rule(rng(3), 0, ['action:y'], ['action:y'])], ANY);
  assert.equal(JSON.stringify(advisor.advise(req)), JSON.stringify(advisor.advise(req, [])));
  assert.equal(JSON.stringify(factsAt(req)), JSON.stringify(factsAt(req, [])));
});

test('the invariant is a consequence of the seam, and this shows it: an observation that resolves an unknown can only add', () => {
  const conditioned: Rule = { ...rule(rng(1), 0, ['action:z'], ['action:quote_rate']), family: 'obligation', pattern: 'X-implies-prior-Y', bindings: { subject: 'action:quote_rate', guard: 'action:disclose_terms' }, conditions: [{ fact: 'obs.states_reason', op: 'eq', value: true }] };
  const advisor = new Advisor([conditioned], ANY);
  const req: AdviseRequest = { operator: 'op-alpha', episode: { events: [] }, considering: 'action:quote_rate' };
  // Without observation the fact is unknown: abstain, naming it.
  const before = advisor.advise(req);
  assert.deepEqual(before.abstention, { reason: 'unknown_fact', missing: ['obs.states_reason'] });
  // Observed true: the rule applies, the guard is absent → a warning that was hidden behind the unknown.
  const surfaced = advisor.advise(req, [{ predicate: 'p', fact: 'obs.states_reason', value: true, p: 0.95 }]);
  assert.equal(surfaced.verdict, 'warn');
  // Observed false: the rule does not apply → uncovered. Still an abstention, but with nothing missing.
  const ruledOut = advisor.advise(req, [{ predicate: 'p', fact: 'obs.states_reason', value: false, p: 0.03 }]);
  assert.deepEqual(ruledOut.abstention, { reason: 'uncovered', missing: [] });
  // Withheld: exactly as before.
  assert.deepEqual(advisor.advise(req, [{ predicate: 'p', fact: 'obs.states_reason', value: null, p: 0.5 }]), before);
});
