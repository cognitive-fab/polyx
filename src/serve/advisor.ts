// The advisor (FS §S3, TS §8). Forward chaining over a fact base, not
// backward chaining over goals: the query is "given this state, what
// fires?", which is a fixpoint, not a proof search.
//
// THREE-VALUED, and this is the load-bearing part. Each condition evaluates
// to true, false, or unknown. A fact absent from the request is unknown,
// never false.
//
//   all conditions true                     → the rule fires
//   any condition false                     → the rule does not apply
//   none false, at least one unknown        → abstain with `unknown_fact`, naming the fact
//
// Closed-world assumption is prohibited. "No record of income verification"
// is not "income was not verified", and in a bank the difference is the
// whole product. F6.3 tests exactly this.
//
// Serves only rules a person adjudicated `real` (F6.4). Every response is a
// decision point, logged; that log is the coverage figure (§9.3) and, later,
// the corpus for the next mining pass.
import { type Event, type Observation, type Scalar } from 'polyx-lens';
import { evalAll, type FactBase } from 'polyx-lens';
import { fraction, type Rule } from 'polyx-lens';

export interface AdviseRequest {
  operator: string;
  agent?: string;
  /**
   * Canonical events so far in the episode — types are what matter; slots
   * feed the fact base. `text` is what was SAID at that event, if the caller
   * chooses to send it: the live path (JT8.2) redacts it under the corpus's
   * text profile and resolves observations over it before the advisor is
   * called. Absent text means no observation, which is not an error. The
   * advisor itself never reads it and the decision log never stores it.
   */
  episode: { events: Array<Pick<Event, 'type'> & Partial<Pick<Event, 'kind' | 'slots' | 'seq'>> & { text?: string }> };
  facts?: Record<string, Scalar>;
  /** The action under consideration. Obligations are checked against it; without it, only recommendations answer. */
  considering?: string;
}

export interface FiredRule {
  id: string;
  support: string;
  provenance: string;
  text: string;
  evidence: string;
}

export interface AdviseResponse {
  /**
   * recommend  a recommendation fired
   * warn       an obligation on the considered action is unsatisfied
   * clear      every obligation on the considered action holds and nothing is recommended — an answer, not an abstention (rev. 4)
   * abstain    nothing covers this, or a fact is unknown
   */
  verdict: 'recommend' | 'warn' | 'clear' | 'abstain';
  actions: Array<{ type: string; rules: FiredRule[] }>;
  warnings: Array<{ rule: FiredRule; unsatisfied: string }>;
  /** The obligations that applied to the considered action and were satisfied. */
  cleared: FiredRule[];
  abstention?: { reason: 'uncovered' | 'unknown_fact'; missing: string[] };
  coverage: { decisionPoint: string | null; answered: boolean };
}

export interface DecisionRecord {
  at: number;
  operator: string;
  considering: string | null;
  verdict: AdviseResponse['verdict'];
  reason: string | null;
  missing: string[];
  fired: string[];
  source: string;
  /**
   * Which observer answered — `jev:<model>`, `annotation:<digest>` on a
   * replay, or `null` when none did (JT8.4). Logged by name so a period of
   * degraded coverage is visible rather than mistaken for corpus drift.
   */
  observer: string | null;
  /**
   * Every observation at this decision point with its `p`, predicate and
   * set version (JT8.3). The log is thereby a progressively growing
   * annotation file for live traffic, and a live period can be replayed
   * later with no key — the same recorded-answer pattern as the annotation
   * pass, applied to traffic instead of to a corpus.
   */
  observations: Array<{ predicate: string; fact: string; value: boolean | null; p: number; pv: number }>;
}

/** The obligation patterns the advisor knows how to check — one branch each below. */
export const CHECKABLE = new Set(['X-implies-prior-Y', 'no-X-without-prior-Y', 'at-most-one-X', 'exactly-one-Y-per-X']);

const provenanceLabel = (r: Rule): string => {
  const v = r.provenance;
  if (v.kind === 'own') return `own@${v.level}`;
  if (v.kind === 'borrowed') return `borrowed`;
  return 'neither';
};

const fired = (r: Rule): FiredRule => ({ id: r.id, support: fraction(r.support), provenance: provenanceLabel(r), text: r.text, evidence: `/rules/${r.id}/evidence?scope=${encodeURIComponent(r.scope)}` });

/**
 * The fact base at a decision point, built lowest precedence first so that
 * each layer overwrites the one below it:
 *
 *   obs.*             what a predicate observed in the text — lowest, and first
 *   slot.*            what the episode's events carried
 *   episode.intent    the one classified intent, if there is exactly one
 *   req.facts         what the CALLER said — highest, and last
 *
 * THE MERGE ORDER IS THE WHOLE OF JF5.2, AND THE SAFETY INVARIANT DEPENDS ON
 * IT (JF7.5). Observation only ever ADDS keys. A condition over a key that
 * was already in the base is unaffected by adding others, so a rule that was
 * true stays true, a rule that was false stays false, and only a rule that
 * was UNKNOWN can move. That is what makes every warning raised without
 * observation still raised with it, and every decision point answered
 * without it still answered. An observed fact that overwrote a caller's
 * could flip a true condition to false and withdraw a warning, which is why
 * this is a MUST and not a default, and why a withheld observation (value
 * null) contributes no key rather than a false one.
 *
 * The caller's facts win. A caller stating `slot.x` knows its own state
 * better than an inference from its own event list does. Before rev. 5 the
 * caller's facts were spread FIRST and a slot overwrote them, which was the
 * wrong way round and had gone unnoticed because nobody had sent a fact with
 * a `slot.` name. It matters now: the observation layer (JT6) goes UNDER
 * all of these, and the safety invariant (JF7) is only true if nothing an
 * observation adds can displace a fact that was already there.
 */
export function factsAt(req: AdviseRequest, obs: Observation[] = []): FactBase {
  const facts: FactBase = {};
  for (const o of obs) if (o.value !== null) facts[o.fact] = o.value; // lowest; null = withheld = absent
  for (const e of req.episode.events) for (const [k, v] of Object.entries(e.slots ?? {})) facts[`slot.${k}`] = v;
  const intents = new Set(req.episode.events.filter((e) => (e.kind === 'customer_intent' || e.type.startsWith('intent:')) && e.type !== 'unknown').map((e) => e.type));
  if (intents.size === 1) facts['episode.intent'] = [...intents][0]!;
  Object.assign(facts, req.facts ?? {});
  return facts;
}

/**
 * Rules indexed for the advisor (TS §8.3). At 500 rules a plain indexed scan
 * is sufficient; RETE would be premature. Index by scope, then by the
 * obligation's subject and the recommendation's action.
 */
export class Advisor {
  private readonly obligations = new Map<string, Map<string, Rule[]>>(); // scope → subject → rules
  private readonly recommendations = new Map<string, Rule[]>(); // scope → rules
  readonly served: number;

  /**
   * Recommendations withheld because their action is not recommendable under
   * the current alphabet (ACV §8.4). A human adjudicated them `real` and a
   * later policy declaration overrode that; the count exists so the conflict
   * is visible rather than silently absorbed.
   */
  readonly withheld: number;

  /**
   * @param recommendable actions an advisory engine may propose (ACV §6.4).
   *   Required, not defaulted: ACV §8.3 makes withholding a MUST, and the
   *   alphabet — not the stored rule — is the authority, so a policy change
   *   takes effect on restart rather than waiting for someone to re-mine.
   */
  constructor(rules: Rule[], recommendable: ReadonlySet<string>) {
    let n = 0;
    let withheld = 0;
    for (const r of rules) {
      if (r.status !== 'real') continue; // F6.4 — proposed-but-unreviewed is never served
      // ACV §8.3: "An advisory engine MUST NOT propose a term whose
      // `recommendable` is `false`." Dropped rather than thrown, unlike an
      // unevaluable pattern: an unevaluable rule is a defect in polyx, while
      // this is a legitimate policy decision that must not take the service
      // down when someone makes it.
      if (r.family === 'recommendation' && !recommendable.has(r.bindings.action ?? '')) {
        withheld++;
        continue;
      }
      // A rule the advisor cannot evaluate must fail loudly here, not be
      // silently "cleared" at request time.
      if (r.family === 'obligation' && !CHECKABLE.has(r.pattern)) throw new Error(`advisor cannot evaluate pattern '${r.pattern}' (rule ${r.id})`);
      if (r.family === 'recommendation' && r.pattern !== 'antecedent-implies-action') throw new Error(`advisor cannot evaluate pattern '${r.pattern}' (rule ${r.id})`);
      n++;
      if (r.family === 'obligation') {
        let byScope = this.obligations.get(r.scope);
        if (!byScope) this.obligations.set(r.scope, (byScope = new Map()));
        const subject = r.bindings.subject!;
        let l = byScope.get(subject);
        if (!l) byScope.set(subject, (l = []));
        l.push(r);
      } else {
        let l = this.recommendations.get(r.scope);
        if (!l) this.recommendations.set(r.scope, (l = []));
        l.push(r);
      }
    }
    this.served = n;
    this.withheld = withheld;
  }

  /**
   * Synchronous and pure (JT6.2). The observation set is resolved by the
   * caller — the HTTP layer, or the replay reading an annotation file —
   * before this is called, so the advisor never waits on a model and the
   * replay stays a function of the corpus plus the annotation file.
   */
  advise(req: AdviseRequest, obs: Observation[] = []): AdviseResponse {
    const facts = factsAt(req, obs);
    const types = req.episode.events.map((e) => e.type);
    const missing = new Set<string>();
    const warnings: AdviseResponse['warnings'] = [];
    const cleared: FiredRule[] = [];
    const actions = new Map<string, FiredRule[]>();

    if (req.considering) {
      for (const r of this.obligations.get(req.operator)?.get(req.considering) ?? []) {
        const { truth, unknown } = evalAll(r.conditions, facts);
        if (truth === false) continue;
        if (truth === 'unknown') {
          for (const f of unknown) missing.add(f);
          continue;
        }
        const guard = r.bindings.guard;
        const before = warnings.length;
        if (r.pattern === 'X-implies-prior-Y' || r.pattern === 'no-X-without-prior-Y') {
          if (!types.includes(guard!)) warnings.push({ rule: fired(r), unsatisfied: guard! });
        } else if (r.pattern === 'at-most-one-X') {
          if (types.filter((t) => t === req.considering).length >= 1) warnings.push({ rule: fired(r), unsatisfied: `a second ${req.considering} in this episode` });
        } else if (r.pattern === 'exactly-one-Y-per-X') {
          const n = types.filter((t) => t === guard).length;
          if (n !== 1) warnings.push({ rule: fired(r), unsatisfied: n === 0 ? guard! : `${guard} more than once` });
        }
        if (warnings.length === before) cleared.push(fired(r));
      }
    }
    for (const r of this.recommendations.get(req.operator) ?? []) {
      const { truth, unknown } = evalAll(r.conditions, facts);
      if (truth === false) continue;
      if (truth === 'unknown') {
        for (const f of unknown) missing.add(f);
        continue;
      }
      const action = r.bindings.action!;
      let l = actions.get(action);
      if (!l) actions.set(action, (l = []));
      l.push(fired(r));
    }

    const decisionPoint = req.considering ?? null;
    const acts = [...actions].map(([type, rules]) => ({ type, rules }));
    if (warnings.length) return { verdict: 'warn', actions: acts, warnings, cleared, coverage: { decisionPoint, answered: true } };
    if (actions.size) return { verdict: 'recommend', actions: acts, warnings: [], cleared, coverage: { decisionPoint, answered: true } };
    // Every obligation on the considered action holds: that is an answer —
    // "go ahead" — and it displaces the same inference a warning would.
    if (cleared.length && !missing.size) return { verdict: 'clear', actions: [], warnings: [], cleared, coverage: { decisionPoint, answered: true } };
    // Abstention is a successful answer, and the two reasons demand
    // different responses from the caller (F6.1).
    if (missing.size) {
      return { verdict: 'abstain', actions: [], warnings: [], cleared, abstention: { reason: 'unknown_fact', missing: [...missing].sort() }, coverage: { decisionPoint, answered: false } };
    }
    return { verdict: 'abstain', actions: [], warnings: [], cleared: [], abstention: { reason: 'uncovered', missing: [] }, coverage: { decisionPoint, answered: false } };
  }
}

export function toRecord(req: AdviseRequest, res: AdviseResponse, source: string, at = Date.now(), observed: { observer: string | null; version: number; obs: Observation[] } = { observer: null, version: 0, obs: [] }): DecisionRecord {
  return {
    at,
    operator: req.operator,
    considering: req.considering ?? null,
    verdict: res.verdict,
    reason: res.abstention?.reason ?? null,
    missing: res.abstention?.missing ?? [],
    fired: [...res.actions.flatMap((a) => a.rules.map((r) => r.id)), ...res.warnings.map((w) => w.rule.id), ...res.cleared.map((c) => c.id)],
    source,
    observer: observed.observer,
    observations: observed.obs.map((o) => ({ predicate: o.predicate, fact: o.fact, value: o.value, p: o.p, pv: observed.version })),
  };
}

/** Validate an incoming request body; throws with a message a caller can act on. */
export function parseRequest(body: unknown): AdviseRequest {
  if (typeof body !== 'object' || body === null) throw new Error('request must be an object');
  const b = body as Record<string, unknown>;
  if (typeof b.operator !== 'string' || !b.operator) throw new Error('operator is required');
  const ep = b.episode as { events?: unknown } | undefined;
  if (!ep || !Array.isArray(ep.events)) throw new Error('episode.events must be an array');
  const events = ep.events.map((e, i) => {
    if (typeof e !== 'object' || e === null || typeof (e as { type?: unknown }).type !== 'string') throw new Error(`episode.events[${i}].type must be a string`);
    const t = (e as { text?: unknown }).text;
    if (t !== undefined && typeof t !== 'string') throw new Error(`episode.events[${i}].text must be a string`);
    return e as AdviseRequest['episode']['events'][number];
  });
  const out: AdviseRequest = { operator: b.operator, episode: { events } };
  if (typeof b.agent === 'string') out.agent = b.agent;
  if (b.facts !== undefined) {
    if (typeof b.facts !== 'object' || b.facts === null || Array.isArray(b.facts)) throw new Error('facts must be an object');
    for (const [k, v] of Object.entries(b.facts as Record<string, unknown>)) {
      if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) throw new Error(`facts.${k} must be a scalar`);
    }
    out.facts = b.facts as Record<string, Scalar>;
  }
  if (b.considering !== undefined) {
    if (typeof b.considering !== 'string') throw new Error('considering must be a string');
    out.considering = b.considering;
  }
  return out;
}
