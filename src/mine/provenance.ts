// The provenance lattice (TS §7.4, F4.5), evaluated over the port's
// single-level judgement.
//
//   operator  →  team  →  agent  →  borrowed(other operators)  →  neither
//
// The verdict names the BROADEST level at which the rule holds with own
// evidence (rev. 2 — the spec's "evaluated in order, stopping at the first
// that yields own evidence" is read broadest-first: a rule that holds for the
// whole operator is a norm; one that holds only for one team is a team norm;
// one that holds only for one agent is a personal habit, and a reviewer will
// care which). The support quoted is the support at that scope; the
// operator-wide figure rides along as `corpusSupport` so nobody mistakes a
// habit for a norm.
import { type Elsewhere, type Instance, type ProvenanceClassifier, type Support, type Thresholds, type Verdict } from 'polyx-lens';
import { measure, type Measured } from './support.ts';
import { cmp } from 'polyx-lens';

export interface Provenanced {
  verdict: Verdict;
  /** Support at the verdict's scope. */
  measured: Measured;
  /** Support across the operator being mined. */
  corpusMeasured: Measured;
}

function groupBy(instances: Instance[], key: (i: Instance) => string | undefined): Map<string, Instance[]> {
  const out = new Map<string, Instance[]>();
  for (const i of instances) {
    const k = key(i);
    if (k === undefined) continue;
    let l = out.get(k);
    if (!l) out.set(k, (l = []));
    l.push(i);
  }
  return out;
}

export function provenance(
  own: Instance[],
  others: Map<string, Instance[]>,
  holds: (i: Instance) => boolean,
  perEpisode: boolean,
  operatorId: string,
  classifier: ProvenanceClassifier,
  t: Thresholds,
): Provenanced {
  const corpusMeasured = measure(own, holds, { perEpisode });
  const enough = (m: Support) => m.of >= t.minInstances;

  if (enough(corpusMeasured) && classifier.classify(corpusMeasured, [], t) === 'own') {
    return { verdict: { kind: 'own', level: 'operator', scope: operatorId }, measured: corpusMeasured, corpusMeasured };
  }
  for (const [level, key] of [
    ['team', (i: Instance) => i.actor.teamId],
    ['agent', (i: Instance) => i.actor.agentId],
  ] as const) {
    const groups = [...groupBy(own, key)].sort(([a, x], [b, y]) => y.length - x.length || cmp(a, b));
    for (const [scope, instances] of groups) {
      const m = measure(instances, holds, { perEpisode });
      if (enough(m) && classifier.classify(m, [], t) === 'own') {
        return { verdict: { kind: 'own', level, scope }, measured: m, corpusMeasured };
      }
    }
  }
  const elsewhere: Elsewhere[] = [...others]
    .map(([scope, instances]) => {
      const m = measure(instances, holds, { perEpisode });
      return { scope, holds: m.holds, of: m.of };
    })
    .filter((e) => e.of >= t.minInstances)
    .sort((a, b) => cmp(a.scope, b.scope));
  if (classifier.classify(corpusMeasured, elsewhere, t) === 'borrowed') {
    const foundIn = elsewhere.filter((e) => e.holds / e.of >= t.ownSupport).map((e) => e.scope);
    return { verdict: { kind: 'borrowed', foundIn }, measured: corpusMeasured, corpusMeasured };
  }
  return { verdict: { kind: 'neither' }, measured: corpusMeasured, corpusMeasured };
}

/** The sentence a rule is offered with — its support, in the reviewer's own terms. */
export function evidenceSentence(p: Provenanced, why: string): string {
  const { holds, of } = p.measured;
  const v = p.verdict;
  if (v.kind === 'own') {
    const where = v.level === 'operator' ? '' : ` — for ${v.level} ${v.scope} only (${p.corpusMeasured.holds}/${p.corpusMeasured.of} across the operator)`;
    const base = of === holds ? `never violated (${holds}/${of})` : `held ${holds} of ${of} times, and it would have stopped the other ${of - holds}`;
    return `${base}${where}; ${why}`;
  }
  if (v.kind === 'borrowed') {
    return `${v.foundIn.length} other operator(s) keep this rule; this one does not (${holds}/${of} here)`;
  }
  return `no own evidence anywhere (${holds}/${of} here)`;
}

