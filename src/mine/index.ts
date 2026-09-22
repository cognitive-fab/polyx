// `polyx mine` (FS §S2): subjects → candidate rules → provenance →
// contradictions → subsumption → a rule set with evidence and
// counter-evidence, mined per operator.
//
// No LLM call anywhere in here, by design (TS §11): same corpus + same
// alphabet version + same thresholds → byte-identical rule set.
import { type LoadedCorpus, type Thresholds } from 'polyx-lens';
import { attachObservations, type AnnotationFile } from 'polyx-lens';
import { consequentialTypes, recommendableTypes } from 'polyx-lens';
import { evalCondition } from 'polyx-lens';
import { simpleClassifier, type ProvenanceClassifier } from 'polyx-lens';
import { naiveExtractor, type Instance, type Subject, type SubjectExtractor } from 'polyx-lens';
import { ratio, type Rule, type RuleStatus } from 'polyx-lens';
import { ruleId } from '../store/identity.ts';
import { contradictions as findContradictions, type Contradiction } from './contradictions.ts';
import { instanceFacts } from './facts.ts';
import { scoreCandidate, specKey, synthesise, type CandidateSpec, type SynthesisContext } from './obligation.ts';
import { evidenceSentence, provenance } from './provenance.ts';
import { VACUOUS_EPISODE } from './patterns.ts';
import { subsumed } from './subsumption.ts';
import { ref, sample } from './support.ts';
import { decisionPoints, refs, synthesiseRecommendations } from './recommend.ts';
import { cmp } from 'polyx-lens';

export interface MineOptions {
  /** Mine recommendation rules too (default true). */
  recommend?: boolean;
  /**
   * Recorded observations to mine over (JF6.3). Read as DATA, like the
   * corpus: this module never calls the port, and the boundary check makes
   * sure it cannot. Absent, the corpus mines exactly as it does today (JF6.5).
   */
  annotations?: AnnotationFile;
  extractor?: SubjectExtractor;
  classifier?: ProvenanceClassifier;
  minedAt?: number;
  requested?: SynthesisContext['requested'];
}

export interface MineStats {
  subjects: number;
  candidates: number;
  belowPatternFloor: number;
  proposed: number;
  refused: number;
  suppressed: number;
  vacuous: number;
  contradicted: number;
  conditioned: number;
  /** Recommendation rules proposed (F4.2) — or the finding that none cleared the floor. */
  recommendations: number;
  /**
   * Candidates the ACV §6.4 recommendable gate dropped. A policy decision that
   * removes rules has to be visible, or an operator cannot see what it cost.
   */
  notRecommendable: Array<{ scope: string; action: string; candidates: number }>;
  decisionPoints: number;
  byOperator: Record<string, { proposed: number; refused: number }>;
}

export interface MineResult {
  rules: Rule[];
  contradictions: Contradiction[];
  stats: MineStats;
  extractor: string;
  classifier: string;
  /** What was read from the annotation store, when one was given: the pinned input (JF6.2). */
  observation: { digest: string; partial: boolean; sites: number; observed: number } | null;
}

const STATUS_ORDER: RuleStatus[] = ['proposed', 'real', 'not_real', 'narrowed', 'retired', 'contradicted', 'suppressed', 'refused'];

/** `action:issue_refund` → "issue refund", unless the alphabet gives a label. */
export function labeller(corpus: LoadedCorpus): (type: string) => string {
  const labels = new Map(corpus.alphabet.eventTypes.filter((t) => t.label).map((t) => [t.id, t.label!]));
  return (type) => labels.get(type) ?? type.replace(/^[a-z]+:/, '').replace(/[_-]+/g, ' ');
}

export async function mine(corpus: LoadedCorpus, thresholds: Thresholds, opts: MineOptions = {}): Promise<MineResult> {
  const extractor = opts.extractor ?? naiveExtractor;
  const classifier = opts.classifier ?? simpleClassifier;
  const minedAt = opts.minedAt ?? Date.now();
  const label = labeller(corpus);
  const t = thresholds;
  const subjects = await extractor.extract(corpus.interactions, consequentialTypes(corpus.alphabet));
  // Immediately after extraction and before any fact base is read: the fact
  // base is memoised per instance, and an instance read before its
  // observations were attached would serve the pre-observation one, silently,
  // for the rest of the run.
  const observation = opts.annotations ? attachObservations(subjects, opts.annotations) : null;
  // ACV §6.4: an action may be worth an obligation while proposing it stays a
  // human's decision. Obligations run over every subject; recommendations do not.
  const recommendable = recommendableTypes(corpus.alphabet);
  const operators = [...new Set(corpus.interactions.map((i) => i.actor.operatorId))].sort();

  const stats: MineStats = {
    subjects: subjects.length,
    candidates: 0,
    belowPatternFloor: 0,
    proposed: 0,
    refused: 0,
    suppressed: 0,
    vacuous: 0,
    contradicted: 0,
    conditioned: 0,
    recommendations: 0,
    notRecommendable: [],
    decisionPoints: 0,
    byOperator: {},
  };
  const rules: Rule[] = [];
  const allContradictions: Contradiction[] = [];

  const ctx: SynthesisContext = { thresholds: t, label };
  if (opts.requested) ctx.requested = opts.requested;
  const byOperator = (subject: Subject) => {
    const m = new Map<string, Instance[]>();
    for (const i of subject.instances) {
      let l = m.get(i.actor.operatorId);
      if (!l) m.set(i.actor.operatorId, (l = []));
      l.push(i);
    }
    return m;
  };

  // Pass 1 — every candidate any operator's history produces. A candidate is
  // identified by what it says, not where it was found, so a rule mined at
  // one operator is SCORED at every other (F4.4): that is where "no own
  // evidence" verdicts come from, and later the cross-domain provenance figure.
  const specs = new Map<string, Map<string, CandidateSpec>>();
  for (const subject of subjects) {
    const perSubject = new Map<string, CandidateSpec>();
    specs.set(subject.type, perSubject);
    for (const [, own] of byOperator(subject)) {
      if (own.length < t.minInstances) continue;
      for (const c of synthesise({ type: subject.type, instances: own }, ctx)) {
        const k = specKey(c);
        if (!perSubject.has(k)) {
          const spec: CandidateSpec = { pattern: c.pattern, args: c.args, conditions: c.conditions };
          if (c.parentId) spec.parentId = c.parentId;
          perSubject.set(k, spec);
        }
      }
    }
  }

  // Pass 2 — score every candidate at every operator, then provenance.
  for (const operatorId of operators) {
    stats.byOperator[operatorId] = { proposed: 0, refused: 0 };
    const mined: Rule[] = [];
    /** Rule id → reason, for patterns whose vacuity test defers to contradictions and subsumption. */
    const lateVacuous = new Map<string, string>();
    for (const subject of subjects) {
      const split = byOperator(subject);
      const own = split.get(operatorId) ?? [];
      if (own.length < t.minInstances) continue;
      const others = new Map([...split].filter(([op]) => op !== operatorId));
      for (const spec of specs.get(subject.type)!.values()) {
        const c = scoreCandidate(spec, own, ctx);
        if (!c) continue;
        stats.candidates++;
        const conditioned = c.conditions.length > 0;
        // Others, under the same condition, so borrowed evidence is like for like.
        const othersHere = new Map<string, Instance[]>();
        for (const [scope, instances] of others) {
          const sel = conditioned ? instances.filter((i) => c.conditions.every((cond) => evalCondition(cond, instanceFacts(i)) === true)) : instances;
          if (sel.length) othersHere.set(scope, sel);
        }
        const p = provenance(c.instances, othersHere, c.holds, c.pattern.perEpisode, operatorId, classifier, t);
        const r = ratio(p.measured);
        const floor = c.pattern.minSupport(t);
        // Own evidence below the pattern's floor is a habit, not an obligation:
        // not a candidate at all. (Below OWN evidence is a different thing —
        // that is refused, and the refusal is kept.)
        if (p.verdict.kind === 'own' && r < floor) {
          stats.belowPatternFloor++;
          continue;
        }
        let status: RuleStatus = 'proposed';
        let suppressedBy: string | undefined;
        // 'survivor' vacuity is applied last, after contradictions and
        // subsumption, so a relational verdict always wins (see Pattern).
        if (c.vacuous && (c.pattern.vacuousWhen ?? 'candidate') === 'candidate') {
          status = 'suppressed';
          suppressedBy = c.pattern.vacuousReason ?? VACUOUS_EPISODE;
          stats.vacuous++;
        } else if (p.verdict.kind === 'neither') {
          status = 'refused';
        }
        const id = ruleId({ family: 'obligation', pattern: c.pattern.name, bindings: c.bindings, conditions: c.conditions, window: c.window });
        if (c.vacuous && c.pattern.vacuousWhen === 'survivor') {
          lateVacuous.set(id, c.pattern.vacuousReason ?? VACUOUS_EPISODE);
        }
        const rule: Rule = {
          id,
          family: 'obligation',
          pattern: c.pattern.name,
          bindings: c.bindings,
          conditions: c.conditions,
          window: c.window,
          support: { holds: p.measured.holds, of: p.measured.of },
          corpusSupport: { holds: p.corpusMeasured.holds, of: p.corpusMeasured.of },
          counterexamples: sample(p.measured.failing, t.maxCounterexamples).map(ref),
          examples: sample(p.measured.passing, t.maxCounterexamples).map(ref),
          provenance: p.verdict,
          status,
          predicates: { js: c.predicate },
          alphabetVersion: corpus.alphabet.version,
          minedAt,
          text: c.text,
          evidence: evidenceSentence(p, c.why),
          corpus: corpus.name,
          scope: operatorId,
        };
        if (suppressedBy) rule.suppressedBy = suppressedBy;
        if (c.parentId) rule.parentId = c.parentId;
        if (conditioned) stats.conditioned++;
        mined.push(rule);
      }
    }

    // Recommendations (TS §7.3): one decision point per episode of this operator.
    if (opts.recommend !== false) {
      const ownSubjects: Subject[] = subjects.map((s) => ({ type: s.type, instances: s.instances.filter((i) => i.actor.operatorId === operatorId) }));
      const points = decisionPoints(ownSubjects);
      stats.decisionPoints += points.length;
      const others = new Map<string, Instance[]>();
      for (const s of subjects) for (const i of s.instances) if (i.actor.operatorId !== operatorId) {
        let l = others.get(i.actor.operatorId);
        if (!l) others.set(i.actor.operatorId, (l = []));
        l.push(i);
      }
      const synthesised = synthesiseRecommendations(points, t, label, recommendable);
      for (const w of synthesised.withheld) {
        stats.notRecommendable.push({ scope: operatorId, action: w.action, candidates: w.candidates });
      }
      for (const c of synthesised.rules) {
        const instances = [...c.matched, ...c.disagreed].map((p) => p.instance);
        const holds = (i: Instance) => i.event.type === c.action;
        // Others' decision points under the same antecedent, for the lattice.
        const othersHere = new Map<string, Instance[]>();
        for (const [scope, list] of others) {
          const pts = decisionPoints([{ type: 'all', instances: list }]).filter((p) => c.conditions.every((cond) => evalCondition(cond, p.facts) === true));
          if (pts.length) othersHere.set(scope, pts.map((p) => p.instance));
        }
        const p = provenance(instances, othersHere, holds, false, operatorId, classifier, t);
        const id = ruleId({ family: 'recommendation', pattern: 'antecedent-implies-action', bindings: { action: c.action }, conditions: c.conditions, window: 'episode' });
        const rule: Rule = {
          id,
          family: 'recommendation',
          pattern: 'antecedent-implies-action',
          bindings: { action: c.action },
          conditions: c.conditions,
          window: 'episode',
          support: { holds: p.measured.holds, of: p.measured.of },
          corpusSupport: { holds: p.corpusMeasured.holds, of: p.corpusMeasured.of },
          outcomeSupport: c.outcome,
          counterexamples: refs(c.disagreed, t.maxCounterexamples),
          examples: refs(c.matched, t.maxCounterexamples),
          provenance: p.verdict,
          status: p.verdict.kind === 'neither' ? 'refused' : 'proposed',
          predicates: { js: c.predicate },
          alphabetVersion: corpus.alphabet.version,
          minedAt,
          text: c.text,
          evidence: `${evidenceSentence(p, 'this is what was done')}; good outcome ${c.outcome.holds} of ${c.outcome.of} times it was followed`,
          corpus: corpus.name,
          scope: operatorId,
        };
        if (rule.status === 'proposed') stats.recommendations++;
        mined.push(rule);
      }
    }

    // Contradictions among what would be proposed, then subsumption among
    // what survives. Order matters: a cycle's members must not suppress others.
    const proposed = () => mined.filter((r) => r.status === 'proposed');
    const cs = findContradictions(proposed(), operatorId);
    const contradicted = new Map<string, string>();
    for (const c of cs) {
      contradicted.set(c.a, c.b);
      contradicted.set(c.b, c.a);
    }
    for (const r of mined) {
      const other = contradicted.get(r.id);
      if (other && r.status === 'proposed') {
        r.status = 'contradicted';
        r.suppressedBy = `contradicts ${other}`;
      }
    }
    allContradictions.push(...cs);
    const sub = subsumed(proposed());
    for (const r of mined) {
      const by = sub.get(r.id);
      if (by && r.status === 'proposed') {
        r.status = 'suppressed';
        r.suppressedBy = `implied by ${by.join(' + ')}`;
      }
    }
    // Last: vacuity for the patterns that defer to a relational verdict.
    for (const r of mined) {
      if (r.status !== 'proposed' || !lateVacuous.has(r.id)) continue;
      r.status = 'suppressed';
      r.suppressedBy = lateVacuous.get(r.id)!;
      stats.vacuous++;
    }
    for (const r of mined) {
      if (r.status === 'proposed') stats.byOperator[operatorId]!.proposed++;
      if (r.status === 'refused') stats.byOperator[operatorId]!.refused++;
    }
    rules.push(...mined);
  }

  for (const r of rules) {
    if (r.status === 'proposed') stats.proposed++;
    else if (r.status === 'refused') stats.refused++;
    else if (r.status === 'suppressed') stats.suppressed++;
    else if (r.status === 'contradicted') stats.contradicted++;
  }
  rules.sort(
    (a, b) =>
      cmp(a.scope, b.scope) ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      ratio(b.support) - ratio(a.support) ||
      b.support.of - a.support.of ||
      cmp(a.id, b.id),
  );
  return {
    rules,
    contradictions: allContradictions,
    stats,
    extractor: extractor.name,
    classifier: classifier.name,
    observation: opts.annotations && observation ? { digest: opts.annotations.digest, partial: opts.annotations.partial, ...observation } : null,
  };
}

export function renderMine(result: MineResult, { all = false } = {}): string {
  const lines: string[] = [];
  const s = result.stats;
  lines.push(`${s.subjects} subjects, ${s.candidates} candidates → ${s.proposed} proposed, ${s.refused} refused (no own evidence), ${s.suppressed} suppressed (${s.vacuous} vacuous), ${s.contradicted} contradicted; ${s.belowPatternFloor} below the pattern floor; ${s.conditioned} carried a data condition`);
  lines.push(
    s.recommendations > 0
      ? `${s.recommendations} recommendation rule(s) cleared the floor over ${s.decisionPoints} decision points`
      : `no recommendation rule cleared the floor over ${s.decisionPoints} decision points — the advisor is an obligation-warning service on this corpus (FS §10.2)`,
  );
  if (s.notRecommendable.length) {
    const total = s.notRecommendable.reduce((a, w) => a + w.candidates, 0);
    const byAction = new Map<string, number>();
    for (const w of s.notRecommendable) byAction.set(w.action, (byAction.get(w.action) ?? 0) + w.candidates);
    lines.push(
      `${total} recommendation candidate(s) withheld — the alphabet declares these actions not recommendable (ACV 6.4): ` +
        [...byAction].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([a, n]) => `${a} (${n})`).join(', '),
    );
  }
  for (const [op, c] of Object.entries(s.byOperator)) lines.push(`  ${op}: ${c.proposed} proposed, ${c.refused} refused`);
  if (result.contradictions.length) {
    lines.push('');
    lines.push('contradictions (reported, not proposed):');
    for (const c of result.contradictions) lines.push(`  ${c.a} × ${c.b}: ${c.reason}`);
  }
  lines.push('');
  for (const r of result.rules) {
    if (!all && r.status !== 'proposed') continue;
    lines.push(`${r.id}  [${r.status}] ${r.scope}  ${r.support.holds}/${r.support.of}  ${verdict(r)}`);
    lines.push(`  ${r.text}`);
    lines.push(`  ${r.evidence}`);
    if (r.suppressedBy) lines.push(`  ${r.suppressedBy}`);
  }
  return lines.join('\n');
}

export function verdict(r: Rule): string {
  const v = r.provenance;
  if (v.kind === 'own') return `own@${v.level}${v.level === 'operator' ? '' : `:${v.scope}`}`;
  if (v.kind === 'borrowed') return `borrowed(${v.foundIn.join(',')})`;
  return 'neither';
}
