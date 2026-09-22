// The gold alignment (TS §9.2, FS §10.1). Matching a mined rule to a written
// clause is the least reliable step in the system, and until a person has
// confirmed a sample the headline precision and recall measure the MATCHER as
// much as the miner. This module picks the sample and stores the verdicts.
//
// The sample is stratified, not random, because a random draw is dominated by
// the matcher's easy `exact` calls and would contain essentially no pairs the
// matcher DECLINED to make — and a matcher's false negatives are exactly what
// a human is needed to find. Five strata:
//
//   exact       the matcher is confident: same action, same guard, same scope
//   general     the rule is unconditioned where the clause is scoped — it
//               claims more than the clause does
//   proposed    the rule carries a condition the clause never names
//   near-miss   NOT paired by the matcher: a clause sharing the rule's action
//               but naming a different guard. If a human pairs these, the
//               matcher is missing correspondences.
//   tribal      NOT paired by the matcher at all: a rule the diff calls
//               tribal knowledge, beside the clause closest to it. If a human
//               pairs these, "followed but never written" is overstated.
//
// Verdicts land in policies/<policy>-gold.yaml, which is a committed
// evaluation artefact like the clause set itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Alphabet } from 'polyx-lens';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { cmp } from 'polyx-lens';
import { fraction, type Rule } from 'polyx-lens';
import { align, type MatchKind } from './align.ts';
import type { Clause, Policy } from './policies/index.ts';
export type Stratum = 'exact' | 'general' | 'proposed' | 'near-miss' | 'tribal';

/**
 * One field of the pair, in ONE vocabulary on both sides.
 *
 * The first pass at this surface rendered the rule as prose and the clause as
 * bracketed button names. The action appeared in both and matched; the guard
 * was buried in different notation on each side, and a rater scanning at speed
 * naturally anchored on the part that matched. Thirteen of fifteen near-miss
 * pairs came back confirmed when the guards plainly differed. That was the
 * instrument, not the rater — so the fields are now aligned and the differing
 * one is marked.
 */
export interface CompareRow {
  field: string;
  rule: string;
  clause: string;
  same: boolean;
}

export interface GoldCandidate {
  /** Stable across regenerations of the sample: the pair itself is the key. */
  key: string;
  stratum: Stratum;
  /** What the matcher said, or null when it declined to pair these. */
  matcher: MatchKind | null;
  rule: { id: string; scope: string; text: string; evidence: string; support: string; provenance: string; pattern: string; conditions: string[] };
  clause: { id: string; text: string; subject: string; guard: string | null; when: string | null };
  /** The pair field by field, both sides in the alphabet's own words. */
  compare: CompareRow[];
}

export interface GoldVerdict {
  rule: string;
  clause: string;
  verdict: 'confirmed' | 'rejected';
  rater: string;
  at: number;
  stratum?: Stratum;
  matcher?: MatchKind | null;
  note?: string;
}

const provenanceLabel = (r: Rule) => (r.provenance.kind === 'own' ? `own@${r.provenance.level}` : r.provenance.kind === 'borrowed' ? 'borrowed' : 'neither');
const whenText = (c: Clause) => (c.when ? `${c.when.fact} = ${String(c.when.value)}` : null);
export const pairKey = (ruleId: string, scope: string, clauseId: string) => `${ruleId}|${scope}|${clauseId}`;

/** `action:issue_refund` -> the alphabet's label, or a readable fallback. */
export function labeller(alphabet?: Alphabet): (type: string) => string {
  const labels = new Map((alphabet?.eventTypes ?? []).filter((t) => t.label).map((t) => [t.id, t.label!]));
  return (type) => labels.get(type) ?? type.replace(/^[a-z]+:/, '').replace(/[_-]+/g, ' ');
}

const NONE = '—';

function compareRows(r: Rule, c: Clause, label: (t: string) => string): CompareRow[] {
  const ruleFlow = r.conditions.find((x) => x.fact === 'episode.intent');
  const rf = ruleFlow ? label(String(ruleFlow.value)) : '(every flow)';
  const cf = c.when ? label(String(c.when.value)) : '(every flow)';
  const rg = r.bindings.guard ? label(r.bindings.guard) : NONE;
  const cg = c.guard ? label(c.guard) : NONE;
  const ra = r.bindings.subject ? label(r.bindings.subject) : NONE;
  const ca = c.subject ? label(c.subject) : NONE;
  return [
    { field: 'in flow', rule: rf, clause: cf, same: rf === cf },
    { field: 'the action', rule: ra, clause: ca, same: ra === ca },
    { field: 'must follow', rule: rg, clause: cg, same: rg === cg },
  ];
}

function candidate(r: Rule, c: Clause, stratum: Stratum, matcher: MatchKind | null, label: (t: string) => string): GoldCandidate {
  return {
    key: pairKey(r.id, r.scope, c.id),
    stratum,
    matcher,
    rule: {
      id: r.id,
      scope: r.scope,
      text: r.text,
      evidence: r.evidence,
      support: fraction(r.support),
      provenance: provenanceLabel(r),
      pattern: r.pattern,
      conditions: r.conditions.map((x) => `${x.fact} ${x.op} ${String(x.value)}`),
    },
    clause: { id: c.id, text: c.text, subject: c.subject ?? '', guard: c.guard ?? null, when: whenText(c) },
    compare: compareRows(r, c, label),
  };
}

/** Evenly spaced across the stratum, so the sample is a spread rather than the first few. Deterministic. */
function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  if (n <= 1) return xs.slice(0, n);
  return Array.from({ length: n }, (_, k) => xs[Math.round((k * (xs.length - 1)) / (n - 1))]!);
}

export function sampleGold(rules: Rule[], policy: Policy, perStratum = 12, alphabet?: Alphabet): GoldCandidate[] {
  const label = labeller(alphabet);
  const live = rules.filter((r) => r.family === 'obligation' && (r.status === 'proposed' || r.status === 'real' || r.status === 'narrowed'));
  const byId = new Map(live.map((r) => [`${r.id}|${r.scope}`, r]));
  const clauseById = new Map(policy.clauses.map((c) => [c.id, c]));
  const alignments = align(live, policy);
  const paired = new Set(alignments.map((a) => pairKey(a.ruleId, a.scope, a.clauseId)));

  const byKind = (k: MatchKind): GoldCandidate[] =>
    alignments
      .filter((a) => a.kind === k)
      .flatMap((a) => {
        const r = byId.get(`${a.ruleId}|${a.scope}`);
        const c = clauseById.get(a.clauseId);
        return r && c ? [candidate(r, c, k, k, label)] : [];
      })
      .sort((x, y) => cmp(x.key, y.key));

  // near-miss: a clause naming the rule's action but a different guard, which
  // the matcher therefore never paired.
  const bySubject = new Map<string, Clause[]>();
  for (const c of policy.clauses) {
    if (!c.expressible || !c.subject) continue;
    let l = bySubject.get(c.subject);
    if (!l) bySubject.set(c.subject, (l = []));
    l.push(c);
  }
  const nearMiss: GoldCandidate[] = [];
  const tribal: GoldCandidate[] = [];
  const firm = new Set(alignments.filter((a) => a.kind === 'exact' || a.kind === 'general').map((a) => `${a.ruleId}|${a.scope}`));
  for (const r of live) {
    const subject = r.bindings.subject;
    if (!subject) continue;
    const near = (bySubject.get(subject) ?? []).filter((c) => !paired.has(pairKey(r.id, r.scope, c.id)));
    if (firm.has(`${r.id}|${r.scope}`)) {
      for (const c of spread(near, 2)) nearMiss.push(candidate(r, c, 'near-miss', null, label));
    } else {
      // no firm alignment at all — the diff calls this tribal knowledge
      for (const c of spread(near, 2)) tribal.push(candidate(r, c, 'tribal', null, label));
    }
  }

  const strata: Array<[Stratum, GoldCandidate[]]> = [
    ['exact', byKind('exact')],
    ['general', byKind('general')],
    ['proposed', byKind('proposed')],
    ['near-miss', nearMiss.sort((x, y) => cmp(x.key, y.key))],
    ['tribal', tribal.sort((x, y) => cmp(x.key, y.key))],
  ];
  const out: GoldCandidate[] = [];
  const seen = new Set<string>();
  for (const [, list] of strata) {
    for (const c of spread(list, perStratum)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Verdict storage. YAML, committed beside the clause set; the format is the
// one align.ts's loadGold already reads.

export function goldFileFor(policyFile: string): string {
  return policyFile.replace(/\.yaml$/, '-gold.yaml');
}

export function readVerdicts(file: string): GoldVerdict[] {
  if (!existsSync(file)) return [];
  const doc = parseYaml(readFileSync(file, 'utf8')) as { pairs?: GoldVerdict[] } | null;
  return doc?.pairs ?? [];
}

/** Verdicts withdrawn from the live set — kept, never deleted, with the reason. */
export function readSuperseded(file: string): GoldVerdict[] {
  if (!existsSync(file)) return [];
  const doc = parseYaml(readFileSync(file, 'utf8')) as { superseded?: GoldVerdict[] } | null;
  return doc?.superseded ?? [];
}

/**
 * Move verdicts out of the live set without losing them. A rating pass that
 * turned out to be misled is itself a finding; deleting it would erase the
 * evidence that the instrument was at fault.
 */
export function supersede(verdicts: GoldVerdict[], match: (v: GoldVerdict) => boolean, reason: string): { kept: GoldVerdict[]; moved: GoldVerdict[] } {
  const kept: GoldVerdict[] = [];
  const moved: GoldVerdict[] = [];
  for (const v of verdicts) (match(v) ? moved : kept).push(match(v) ? { ...v, note: v.note ? `${v.note} — ${reason}` : reason } : v);
  return { kept, moved };
}

export function writeVerdicts(file: string, verdicts: GoldVerdict[], policy: Policy, superseded: GoldVerdict[] = []): void {
  const header = [
    '# Gold alignment — a person\'s ruling on whether a mined rule and a written',
    '# clause are the same rule. EVALUATION INPUT.',
    '#',
    '# Alignment is the least reliable step in the system (F8.3). These verdicts',
    '# are what the automatic matcher is scored against, and the inter-rater',
    "# figure over pairs two people rated is what says whether the question is",
    '# even well posed. Written by `polyx gold <corpus> serve`.',
    `#`,
    `# policy: ${policy.policy} v${policy.version}`,
    '',
  ].join('\n');
  const key = (x: GoldVerdict) => x.rule + x.clause + x.rater;
  const sorted = [...verdicts].sort((a, b) => cmp(key(a), key(b)));
  const old = [...superseded].sort((a, b) => cmp(key(a), key(b)));
  writeFileSync(file, header + stringifyYaml(old.length ? { pairs: sorted, superseded: old } : { pairs: sorted }));
}

export function upsertVerdict(verdicts: GoldVerdict[], v: GoldVerdict): GoldVerdict[] {
  const rest = verdicts.filter((x) => !(x.rule === v.rule && x.clause === v.clause && x.rater === v.rater));
  return [...rest, v];
}

export interface GoldProgress {
  sampled: number;
  rated: number;
  byStratum: Record<string, { total: number; rated: number }>;
  raters: string[];
  doubleRated: number;
}

export function progress(sample: GoldCandidate[], verdicts: GoldVerdict[]): GoldProgress {
  const byPair = new Map<string, Set<string>>();
  for (const v of verdicts) {
    const k = `${v.rule}|${v.clause}`;
    let s = byPair.get(k);
    if (!s) byPair.set(k, (s = new Set()));
    s.add(v.rater);
  }
  const byStratum: Record<string, { total: number; rated: number }> = {};
  let rated = 0;
  for (const c of sample) {
    const s = (byStratum[c.stratum] ??= { total: 0, rated: 0 });
    s.total++;
    if (byPair.has(`${c.rule.id}|${c.clause.id}`)) {
      s.rated++;
      rated++;
    }
  }
  return {
    sampled: sample.length,
    rated,
    byStratum,
    raters: [...new Set(verdicts.map((v) => v.rater))].sort(cmp),
    doubleRated: [...byPair.values()].filter((s) => s.size >= 2).length,
  };
}
