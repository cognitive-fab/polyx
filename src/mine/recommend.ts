// Recommendation rules (TS §7.3, F4.2). A different shape and a different
// evidence standard from obligations:
//
//   antecedent (conjunction of conditions on episode state and customer facts)
//     → suggested action
//     with AGREEMENT measured against what was actually done,
//     and OUTCOME-CONDITIONED PRECISION against the outcome that followed.
//
// Two figures, not one. A rule that reproduces what agents do badly is a
// faithfully mined mistake, and only the second figure catches it.
//
// The unit is a DECISION POINT: an episode in which a consequential action
// was taken. Its fact base is what was known before the first consequential
// action — the interaction's facts, the classified intent, the categorical
// slots seen so far — and its "answer" is that first consequential action.
// Later consequential actions in the same episode are consequences of the
// first, not decisions the advisor would be asked about cold.
//
// The antecedent search is bounded: conjunctions up to `antecedentMaxLength`
// over the fact vocabulary, with a minimum instance floor, and a longer
// antecedent is kept only when it beats every shorter one it contains.
// Beyond that the search explodes and the rules stop being readable, which
// defeats the purpose.
import { type Condition, type Instance, type InstanceRef, type Subject, type Support, type Thresholds } from '@cognitive-fab/polyx-lens';
import { evalCondition, renderCondition, type FactBase } from '@cognitive-fab/polyx-lens';
import { candidateConditions, instanceFacts } from './facts.ts';
import { sample, ref } from './support.ts';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface DecisionPoint {
  episodeId: string;
  interactionId: string;
  facts: FactBase;
  /** The first consequential action's type. */
  action: string;
  instance: Instance;
  good: boolean | null; // outcome known and resolved / not / unknown
}

export const GOOD_OUTCOMES = new Set(['resolved', 'accepted']);

/** One decision point per episode: the first consequential action and what was known before it. */
export function decisionPoints(subjects: Subject[]): DecisionPoint[] {
  const byEpisode = new Map<string, Instance>();
  for (const s of subjects) {
    for (const i of s.instances) {
      const prev = byEpisode.get(i.episodeId);
      if (!prev || i.seq < prev.seq) byEpisode.set(i.episodeId, i);
    }
  }
  return [...byEpisode.values()]
    .sort((a, b) => a.at - b.at || cmp(a.interactionId, b.interactionId) || a.seq - b.seq)
    .map((i) => ({
      episodeId: i.episodeId,
      interactionId: i.interactionId,
      facts: instanceFacts(i),
      action: i.event.type,
      instance: i,
      good: i.outcome ? GOOD_OUTCOMES.has(i.outcome.label) : null,
    }));
}

export interface RecommendationCandidate {
  action: string;
  conditions: Condition[];
  /** Agreement: the action taken matched. */
  agreement: Support;
  /** Of the matches with a known outcome, how many were good. */
  outcome: Support;
  matched: DecisionPoint[];
  disagreed: DecisionPoint[];
  text: string;
  predicate: string;
}

const key = (cs: Condition[]) => cs.map(renderCondition).sort().join(' && ');

/**
 * How many instances a rule with this many conditions must rest on. Longer
 * antecedents are stronger claims drawn from a much larger search, so they
 * are paid for with proportionally more evidence (TS §11 — reported and
 * swept, never tuned to taste).
 */
export const floorFor = (conditions: number, t: Thresholds): number =>
  Math.ceil(t.minInstances * Math.pow(Math.max(1, conditions), t.antecedentFloorExponent));

/**
 * @param recommendable the actions an advisory system may PROPOSE (ACV §6.4).
 *   Not a filter on the decision points: an action nobody may suggest still
 *   happened, and still belongs in the denominator that every other rule's
 *   base rate is measured against. It gates only what may be EMITTED.
 *   Required rather than defaulted — a safety gate that defaults open is not
 *   a gate.
 */
export interface RecommendationResult {
  rules: RecommendationCandidate[];
  /** Candidates the ACV §6.4 gate dropped, per action — never silently zero. */
  withheld: Array<{ action: string; candidates: number }>;
}

export function synthesiseRecommendations(
  points: DecisionPoint[],
  t: Thresholds,
  label: (type: string) => string,
  recommendable: ReadonlySet<string>,
): RecommendationResult {
  if (points.length < t.minInstances) return { rules: [], withheld: [] };
  const conditions = candidateConditions(
    points.map((p) => p.facts),
    t,
  );
  // Breadth-first by antecedent length, so every shorter antecedent is
  // measured before any longer one that contains it. Two prunings:
  //   - the shortest sufficient antecedent wins: once some action clears the
  //     floor under an antecedent, no extension of it is explored, and no
  //     antecedent containing an explained subset is either;
  //   - a longer antecedent that does clear the floor is kept only when it
  //     beats every shorter subset by `recommendGain` — otherwise the extra
  //     condition is decoration.
  // Without these, every flow-scoped rule sprouts a variant per incidental
  // fact (ABCD: 1,017 recommendations from 55 flows).
  interface Node {
    chosen: Condition[];
    lastIndex: number;
    selected: DecisionPoint[];
  }
  const out: RecommendationCandidate[] = [];
  const withheld = new Map<string, number>(); // action -> candidates dropped by the ACV gate
  const agreementOf = new Map<string, number>(); // `${action}|${key}` → agreement
  const explained = new Set<string>(); // antecedent keys under which some action cleared the floor
  const subsetsOf = (cs: Condition[]) => cs.map((_, k) => cs.filter((_, j) => j !== k));
  // The agreement of an antecedent for an action, computed on demand when the
  // search never scored it (it was pruned as an extension of an explained
  // subset, or fell under the floor). A subset the search skipped is still a
  // shorter antecedent this one must beat.
  const agreementFor = (action: string, sub: Condition[]): number => {
    const k = `${action}|${key(sub)}`;
    const cached = agreementOf.get(k);
    if (cached !== undefined) return cached;
    const selected = points.filter((p) => sub.every((c) => evalCondition(c, p.facts) === true));
    const v = selected.length ? selected.filter((p) => p.action === action).length / selected.length : 0;
    agreementOf.set(k, v);
    return v;
  };

  let frontier: Node[] = conditions.flatMap((c, i) => {
    const selected = points.filter((p) => evalCondition(c, p.facts) === true);
    return selected.length >= t.minInstances ? [{ chosen: [c], lastIndex: i, selected }] : [];
  });
  for (let depth = 1; depth <= t.antecedentMaxLength && frontier.length; depth++) {
    const next: Node[] = [];
    for (const node of frontier) {
      const k = key(node.chosen);
      if (depth > 1 && subsetsOf(node.chosen).some((sub) => explained.has(key(sub)))) continue;
      const byAction = new Map<string, DecisionPoint[]>();
      for (const p of node.selected) {
        let l = byAction.get(p.action);
        if (!l) byAction.set(p.action, (l = []));
        l.push(p);
      }
      let any = false;
      for (const [action, matched] of [...byAction].sort(([a], [b]) => cmp(a, b))) {
        const agreement = matched.length / node.selected.length;
        agreementOf.set(`${action}|${k}`, agreement);
        if (agreement < t.recommendAgreement || matched.length < floorFor(node.chosen.length, t)) continue;
        any = true;
        const redundant = depth > 1 && subsetsOf(node.chosen).some((sub) => agreement < agreementFor(action, sub) + t.recommendGain);
        if (redundant) continue;
        // The gate is applied HERE and not earlier, so that the search shape
        // is identical whether or not an action is recommendable: a
        // non-recommendable action still explains these decision points, so it
        // must still mark the antecedent explained and must still be the
        // baseline a longer antecedent has to beat. Gating earlier would let a
        // rule look novel because the thing it competes with was invisible.
        //
        // The cost of that choice is that the node is NOT extended, so a
        // deeper rule for some other action is not found either. That is a
        // real loss, so it is counted rather than absorbed: every other
        // suppression in the miner leaves a record, and a policy decision that
        // silently removes rules is one nobody can review.
        if (!recommendable.has(action)) {
          withheld.set(action, (withheld.get(action) ?? 0) + 1);
          continue;
        }
        const withOutcome = matched.filter((p) => p.good !== null);
        out.push({
          action,
          conditions: node.chosen,
          agreement: { holds: matched.length, of: node.selected.length },
          outcome: { holds: withOutcome.filter((p) => p.good).length, of: withOutcome.length },
          matched,
          disagreed: node.selected.filter((p) => p.action !== action),
          text: `When ${node.chosen.map(renderCondition).join(' and ')}, ${label(action)}.`,
          predicate: `(facts) => ${node.chosen.map((c) => `facts[${JSON.stringify(c.fact)}] === ${JSON.stringify(c.value)}`).join(' && ')} ? ${JSON.stringify(action)} : null`,
        });
      }
      if (any) {
        explained.add(k);
        continue;
      }
      if (depth === t.antecedentMaxLength) continue;
      for (let i = node.lastIndex + 1; i < conditions.length; i++) {
        const c = conditions[i]!;
        if (node.chosen.some((x) => x.fact === c.fact)) continue; // one value per fact
        const selected = node.selected.filter((p) => evalCondition(c, p.facts) === true);
        if (selected.length >= t.minInstances) next.push({ chosen: [...node.chosen, c], lastIndex: i, selected });
      }
    }
    frontier = next;
  }
  return { rules: coverPrune(out, t), withheld: [...withheld].map(([action, candidates]) => ({ action, candidates })).sort((x, y) => y.candidates - x.candidates || cmp(x.action, y.action)) };
}

/**
 * Redundancy pruning for recommendations.
 *
 * The subset check above only compares an antecedent with its own subsets, so
 * it cannot see that a rule is a worse-stated proxy for a DIFFERENT rule it
 * already emitted. On ABCD that let `payment_method = paypal AND
 * membership_level = gold -> update the order` (38/38) survive beside
 * `episode.intent = return_color -> update the order` (132/147), even though
 * 34 of those 38 sit inside the return flows the first rule already answers.
 * The proxy also generalises past its evidence: it claims to hold whenever
 * gold and paypal, but every instance supporting it was a return or refund.
 *
 * So: take the rules for one action in order of how much they explain, and
 * keep one only when enough of what it explains is genuinely new.
 */
function coverPrune(candidates: RecommendationCandidate[], t: Thresholds): RecommendationCandidate[] {
  const byAction = new Map<string, RecommendationCandidate[]>();
  for (const c of candidates) {
    let l = byAction.get(c.action);
    if (!l) byAction.set(c.action, (l = []));
    l.push(c);
  }
  const rate = (c: RecommendationCandidate) => (c.agreement.of ? c.agreement.holds / c.agreement.of : 0);
  const kept: RecommendationCandidate[] = [];
  for (const [, list] of [...byAction].sort(([a], [b]) => cmp(a, b))) {
    // Broadest first: a rule that answers more decision points is the one to
    // state, and a narrower rule must earn its place beside it.
    list.sort((a, b) => b.matched.length - a.matched.length || b.agreement.holds - a.agreement.holds || cmp(a.text, b.text));
    const covered = new Set<string>();
    const here: RecommendationCandidate[] = [];
    for (const c of list) {
      if (!c.matched.length) continue;
      const mine = new Set(c.matched.map((p) => p.episodeId));
      const fresh = c.matched.filter((p) => !covered.has(p.episodeId)).length;
      if (fresh / c.matched.length < t.recommendNovelty) {
        // Already explained. Two very different things look like this, and
        // only one of them is redundant: a rule sitting INSIDE a single
        // broader rule and answering it more accurately is a refinement and
        // is worth keeping; a rule smeared across several broader rules is a
        // proxy for whatever they have in common, and claims to hold in
        // situations it was never tested on. On ABCD the split is 6 to 81.
        const host = here
          .map((k) => ({ k, n: k.matched.filter((p) => mine.has(p.episodeId)).length }))
          .sort((x, y) => y.n - x.n || cmp(x.k.text, y.k.text))[0];
        const nested = host && host.n / mine.size >= 0.9;
        if (!nested || rate(c) <= rate(host.k) + t.recommendGain) continue;
      }
      kept.push(c);
      here.push(c);
      for (const p of c.matched) covered.add(p.episodeId);
    }
  }
  return kept.sort((a, b) => b.agreement.holds - a.agreement.holds || cmp(a.text, b.text));
}

export const refs = (points: DecisionPoint[], n: number): InstanceRef[] => sample(points, n).map((p) => ref(p.instance));
