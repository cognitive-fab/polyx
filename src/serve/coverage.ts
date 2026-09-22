// `polyx coverage <corpus>` (F7.1–F7.3): replay the corpus through the
// advisor. Every decision point — an episode with a consequential action —
// is asked cold, with what was known before its first consequential action,
// and the answer is compared with what the agent actually did and how the
// interaction ended.
//
//   coverage            answered / (answered + abstained)
//   abstention split    uncovered : unknown_fact
//   agreement           a recommendation matched the action taken
//   outcome precision   P(good outcome | a rule fired and was followed)
//   inference displaced decision points answered with no model call AT DECISION TIME —
//                       an observed fact was recorded once, at annotate time, and read back
//
// The replay writes its decision points to the same log the live endpoint
// uses, tagged with its source, so `polyx serve`'s /coverage and this
// command are the same figure over different traffic.
import { attachObservations, type AnnotationFile, type LoadedCorpus, type Observation, type Rule } from 'polyx-lens';
import { consequentialTypes, recommendableTypes } from 'polyx-lens';
import { decisionPoints, GOOD_OUTCOMES } from '../mine/recommend.ts';
import { naiveExtractor } from 'polyx-lens';
import type { Store } from '../store/db.ts';
import { Advisor, toRecord, type AdviseRequest } from './advisor.ts';
import { logDecision } from './http.ts';
import { cmp } from 'polyx-lens';

export interface Replay {
  decisionPoints: number;
  served: number;
  answered: number;
  abstained: { uncovered: number; unknownFact: number };
  coverage: number | null;
  byVerdict: Record<string, number>;
  /** Of the decision points with a recommendation, how many recommended the action actually taken. */
  agreement: { holds: number; of: number; value: number | null };
  /** Of the agreeing ones with a known outcome, how many ended well. */
  outcomePrecision: { holds: number; of: number; value: number | null };
  /** Of the decision points where the taken action was `considering`, how many drew a warning — the obligation half's yield. */
  warned: { holds: number; of: number; value: number | null };
  /** … and how many were cleared: every real obligation on the action held. */
  cleared: { holds: number; of: number; value: number | null };
  inferenceDisplaced: number;
  missingFacts: Array<{ fact: string; count: number }>;
  /**
   * JT9.2 — the yield of observation, when an annotation file was read.
   * `answered` above is split into answered without observation and answered
   * BECAUSE of it; the two deltas are the invariant's two directions and the
   * only numbers worth quoting: abstentions resolved, warnings newly raised.
   * Every other verdict is unchanged by construction (JF7).
   */
  observation: {
    digest: string;
    partial: boolean;
    pointsObserved: number;
    answeredWithout: number;
    answeredByObservation: number;
    abstentionsResolved: number;
    warningsRaised: number;
  } | null;
}

const ratio = (holds: number, of: number) => ({ holds, of, value: of ? holds / of : null });

export async function replay(corpus: LoadedCorpus, rules: Rule[], store?: Store, annotations: AnnotationFile | null = null): Promise<Replay> {
  const advisor = new Advisor(rules, recommendableTypes(corpus.alphabet));
  const subjects = await naiveExtractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
  // Lifted from the sites before each decision point, exactly as the miner
  // does it, and BEFORE decisionPoints reads a fact base (the memo hazard).
  if (annotations) attachObservations(subjects, annotations);
  const points = decisionPoints(subjects);
  let pointsObserved = 0;
  let answeredWithout = 0;
  let answeredByObservation = 0;
  let abstentionsResolved = 0;
  let warningsRaised = 0;
  const byVerdict: Record<string, number> = {};
  let uncovered = 0;
  let unknownFact = 0;
  let agreed = 0;
  let recommended = 0;
  let goodOf = 0;
  let good = 0;
  let warned = 0;
  let clearedN = 0;
  const missing = new Map<string, number>();
  const source = `replay:${corpus.name}`;
  for (const p of points) {
    const i = p.instance;
    const req: AdviseRequest = {
      operator: i.actor.operatorId,
      episode: { events: i.before.map((e) => ({ type: e.type, kind: e.kind, slots: e.slots })) },
      facts: i.facts ?? {},
      considering: p.action,
    };
    // The served verdict is the one WITH observation. The one without is
    // computed beside it so the yield is measured rather than assumed.
    const obs: Observation[] = Object.entries(i.observed ?? {}).map(([fact, value]) => ({ predicate: fact, fact, value, p: value === null ? 0.5 : value ? 1 : 0 }));
    const res = advisor.advise(req, obs);
    if (annotations) {
      // A point "carries an observation" only if some predicate EMITTED there.
      // A withholding contributes nothing and must not be counted as if it did.
      const emitted = obs.some((o) => o.value !== null);
      const plain = emitted ? advisor.advise(req) : res;
      if (emitted) pointsObserved++;
      if (plain.coverage.answered) answeredWithout++;
      else if (res.coverage.answered) {
        answeredByObservation++;
        abstentionsResolved++;
      }
      if (res.warnings.length > plain.warnings.length) warningsRaised++;
    }
    byVerdict[res.verdict] = (byVerdict[res.verdict] ?? 0) + 1;
    if (res.abstention?.reason === 'uncovered') uncovered++;
    if (res.abstention?.reason === 'unknown_fact') unknownFact++;
    for (const f of res.abstention?.missing ?? []) missing.set(f, (missing.get(f) ?? 0) + 1);
    if (res.warnings.length) warned++;
    if (res.verdict === 'clear') clearedN++;
    if (res.actions.length) {
      recommended++;
      if (res.actions.some((a) => a.type === p.action)) {
        agreed++;
        if (i.outcome) {
          goodOf++;
          if (GOOD_OUTCOMES.has(i.outcome.label)) good++;
        }
      }
    }
    if (store) logDecision(store, toRecord(req, res, source, i.at, annotations ? { observer: `annotation:${annotations.digest}`, version: obs.length ? annotations.lines[0]!.pv : 0, obs } : { observer: null, version: 0, obs: [] }));
  }
  const answered = points.length - uncovered - unknownFact;
  return {
    decisionPoints: points.length,
    served: advisor.served,
    answered,
    abstained: { uncovered, unknownFact },
    coverage: points.length ? answered / points.length : null,
    byVerdict,
    agreement: ratio(agreed, recommended),
    outcomePrecision: ratio(good, goodOf),
    warned: ratio(warned, points.length),
    cleared: ratio(clearedN, points.length),
    inferenceDisplaced: answered,
    missingFacts: [...missing]
      .map(([fact, count]) => ({ fact, count }))
      .sort((a, b) => b.count - a.count || cmp(a.fact, b.fact))
      .slice(0, 10),
    observation: annotations ? { digest: annotations.digest, partial: annotations.partial, pointsObserved, answeredWithout, answeredByObservation, abstentionsResolved, warningsRaised } : null,
  };
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);

export function renderReplay(r: Replay, corpus: string): string {
  const lines = [
    `polyx coverage — ${corpus}: ${r.decisionPoints} decision points replayed through ${r.served} real rule(s)`,
    '',
    `coverage             ${pct(r.coverage)}  (${r.answered} answered; ${r.abstained.uncovered} abstained as uncovered, ${r.abstained.unknownFact} as unknown-fact)`,
    `verdicts             ${Object.entries(r.byVerdict).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `agreement            ${pct(r.agreement.value)}  (${r.agreement.holds}/${r.agreement.of} recommendations matched the action taken)`,
    `outcome precision    ${pct(r.outcomePrecision.value)}  (${r.outcomePrecision.holds}/${r.outcomePrecision.of} agreeing decision points with a known outcome ended well)`,
    `warnings             ${pct(r.warned.value)}  (${r.warned.holds}/${r.warned.of} decision points drew an obligation warning)`,
    `cleared              ${pct(r.cleared.value)}  (${r.cleared.holds}/${r.cleared.of} decision points: every real obligation on the action held, nothing to recommend)`,
    // "Without a model call" is true of the decision, not of the whole
    // history: an observed fact came from a call made once, at annotate
    // time, and read back here. Say both, or a reader who knows a model was
    // involved somewhere will distrust the number.
    `inference displaced  ${r.inferenceDisplaced} decision points answered with no model call at decision time (F7.3)${r.observation && r.observation.answeredByObservation ? ` — ${r.observation.answeredByObservation} of them on a fact recorded once, at annotate time` : ''}`,
  ];
  if (r.missingFacts.length) lines.push(`facts most often missing: ${r.missingFacts.map((m) => `${m.fact} (${m.count})`).join(', ')}`);
  if (r.observation) {
    const o = r.observation;
    lines.push('', `observation          annotation ${o.digest}${o.partial ? ' (PARTIAL)' : ''}: ${o.pointsObserved} decision point(s) carried an observed fact`);
    lines.push(`  answered             ${o.answeredWithout} without observation, ${o.answeredByObservation} because of it`);
    lines.push(`  yield                ${o.abstentionsResolved} abstention(s) resolved, ${o.warningsRaised} warning(s) newly raised — nothing else can move (JF7)`);
  } else {
    lines.push('observation          none — replayed over typed state only');
  }
  if (r.served === 0) lines.push('', 'nothing is served: no rule has been adjudicated real (F6.4). Review first: polyx review <corpus> serve');
  if (r.coverage !== null && r.served > 0 && r.coverage < 0.1) lines.push('', 'coverage below ~10% of decision points is a falsification result (FS §6.5), not a tuning problem');
  return lines.join('\n');
}
