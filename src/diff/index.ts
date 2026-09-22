// The conformance diff (FS §S4, F8.1–F8.3, TS §10). Given a mined rule set
// and a policy clause set, both already aligned:
//
//   mined ∧ ¬written   → TRIBAL KNOWLEDGE   what the reps do that nobody wrote down
//   mined ∧ written    → CONFIRMED          the policy, followed
//   ¬mined ∧ written   → COMPLIANCE GAP     — with the distinction, made explicit,
//                        between VIOLATED in the corpus ("your reps ignore this"),
//                        NEVER EXERCISED ("this situation never arose"), and
//                        KEPT BUT NOT MINED (followed every time, below a floor)
//   contradictions within the mined set → reported separately
//
// Every finding links to interactions (F8.2). Every alignment is labelled as
// proposed-for-confirmation (F8.3): alignment is the least reliable step in
// the system and the report says so wherever its output appears.
import { type LoadedCorpus } from 'polyx-lens';
import { align, type Alignment } from '../evaluate/align.ts';
import { controls, type ClauseExercise } from '../evaluate/controls.ts';
import { loadPolicy, type Clause, type Policy } from '../evaluate/policies/index.ts';
import { fraction, type InstanceRef, type Rule } from 'polyx-lens';
import { cmp } from 'polyx-lens';

/**
 * Why a mined rule has no clause (human ruling, 29 Aug 2026).
 *
 *   extended-beyond-policy  the same action and guard ARE written down — for a
 *                           different flow. The agents apply the practice
 *                           somewhere the policy never covered. This is the
 *                           product's actual finding and folding it into
 *                           "confirmed" would hide it.
 *   novel                   the pair appears nowhere in the rulebook.
 */
export type TribalKind = 'extended-beyond-policy' | 'novel';

export interface RuleFinding {
  rule: { id: string; scope: string; status: string; text: string; evidence: string; support: string; provenance: string; family: string };
  /** Alignments proposed by the matcher — for a person to confirm. */
  alignments: Array<{ clauseId: string; clauseText: string; kind: string }>;
  supporting: InstanceRef[];
  contradicting: InstanceRef[];
  /** Tribal findings only: which of the two kinds this is, and where the policy does state it. */
  tribalKind?: TribalKind;
  writtenElsewhere?: string[];
}

export interface ClauseFinding {
  clause: { id: string; text: string; subject?: string; guard?: string; when?: string };
  kind: 'violated' | 'never-exercised' | 'kept-not-mined';
  exercised: number;
  violated: number;
  violations: InstanceRef[];
  kept: InstanceRef[];
}

export interface ContradictionFinding {
  scope: string;
  a: RuleFinding['rule'];
  b: RuleFinding['rule'];
  reason: string;
}

export interface Diff {
  corpus: string;
  policy: { name: string; version: number; file: string };
  counts: { tribal: number; tribalExtended: number; tribalNovel: number; confirmed: number; gap: { violated: number; neverExercised: number; keptNotMined: number }; contradictions: number; inexpressible: number };
  tribal: RuleFinding[];
  confirmed: RuleFinding[];
  gap: ClauseFinding[];
  contradictions: ContradictionFinding[];
  inexpressible: Array<{ id: string; text: string; reason: string }>;
  /** Rules the matcher could only tentatively align — a person decides which region they belong to. */
  undecided: RuleFinding[];
}

const provenanceLabel = (r: Rule) => (r.provenance.kind === 'own' ? `own@${r.provenance.level}` : r.provenance.kind === 'borrowed' ? `borrowed(${r.provenance.foundIn.join(',')})` : 'neither');

function ruleView(r: Rule, byClause: Map<string, Clause>, alignments: Alignment[]): RuleFinding {
  return {
    rule: { id: r.id, scope: r.scope, status: r.status, text: r.text, evidence: r.evidence, support: fraction(r.support), provenance: provenanceLabel(r), family: r.family },
    alignments: alignments.map((a) => ({ clauseId: a.clauseId, clauseText: byClause.get(a.clauseId)?.text ?? '', kind: a.kind })),
    supporting: r.examples,
    contradicting: r.counterexamples,
  };
}

const whenText = (c: Clause) => (c.when ? `${c.when.fact} = ${String(c.when.value)}` : undefined);

export async function diff(
  corpus: LoadedCorpus,
  rules: Rule[],
  policyFile: string,
  contradictionPairs: Array<{ scope: string; a: string; b: string; reason: string }>,
): Promise<Diff> {
  const policy: Policy = loadPolicy(policyFile);
  const byClause = new Map(policy.clauses.map((c) => [c.id, c]));
  const obligations = rules.filter((r) => r.family === 'obligation');
  const live = obligations.filter((r) => r.status === 'proposed' || r.status === 'real' || r.status === 'narrowed');
  const alignments = align(live, policy);
  const byRule = new Map<string, Alignment[]>();
  for (const a of alignments) {
    const k = `${a.ruleId}|${a.scope}`;
    let l = byRule.get(k);
    if (!l) byRule.set(k, (l = []));
    l.push(a);
  }

  // Where each (action, guard) pair is written down, whatever the flow.
  const writtenIn = new Map<string, string[]>();
  for (const c of policy.clauses) {
    if (c.shape !== 'precedence' || !c.subject) continue;
    const k = `${c.subject}>${c.guard}`;
    let l = writtenIn.get(k);
    if (!l) writtenIn.set(k, (l = []));
    const where = c.when ? String(c.when.value) : '(every flow)';
    if (!l.includes(where)) l.push(where);
  }
  const tribal: RuleFinding[] = [];
  const confirmed: RuleFinding[] = [];
  const undecided: RuleFinding[] = [];
  const recovered = new Set<string>();
  for (const r of live) {
    const as = byRule.get(`${r.id}|${r.scope}`) ?? [];
    const firm = as.filter((a) => a.kind === 'exact' || a.kind === 'general');
    if (firm.length) {
      confirmed.push(ruleView(r, byClause, firm));
      for (const a of firm) recovered.add(a.clauseId);
    } else if (as.length) undecided.push(ruleView(r, byClause, as));
    else {
      const f = ruleView(r, byClause, []);
      const elsewhere = writtenIn.get(`${r.bindings.subject}>${r.bindings.guard}`) ?? [];
      // A rule conditioned on flow X whose pair is written only for flow Y is
      // the practice extended beyond the policy, not a novel practice.
      const mineFlow = r.conditions.find((c) => c.fact === 'episode.intent');
      const covered = mineFlow ? elsewhere.filter((w) => w !== String(mineFlow.value)) : elsewhere;
      f.tribalKind = covered.length ? 'extended-beyond-policy' : 'novel';
      if (covered.length) f.writtenElsewhere = covered;
      tribal.push(f);
    }
  }

  const c = await controls(corpus, policy);
  const exercise = new Map<string, ClauseExercise>(c.exercise.map((e) => [e.clauseId, e]));
  const gap: ClauseFinding[] = [];
  for (const cl of policy.clauses) {
    if (!cl.expressible || recovered.has(cl.id)) continue;
    const ex = exercise.get(cl.id);
    const base = { clause: { id: cl.id, text: cl.text, ...(cl.subject ? { subject: cl.subject } : {}), ...(cl.guard ? { guard: cl.guard } : {}), ...(whenText(cl) ? { when: whenText(cl)! } : {}) } };
    if (!ex || ex.exercised === 0) gap.push({ ...base, kind: 'never-exercised', exercised: 0, violated: 0, violations: [], kept: [] });
    else if (ex.violated > 0) gap.push({ ...base, kind: 'violated', exercised: ex.exercised, violated: ex.violated, violations: ex.violations, kept: ex.kept });
    else gap.push({ ...base, kind: 'kept-not-mined', exercised: ex.exercised, violated: 0, violations: [], kept: ex.kept });
  }
  gap.sort((x, y) => ['violated', 'kept-not-mined', 'never-exercised'].indexOf(x.kind) - ['violated', 'kept-not-mined', 'never-exercised'].indexOf(y.kind) || y.violated - x.violated || cmp(x.clause.id, y.clause.id));

  const ruleById = new Map(obligations.map((r) => [`${r.id}|${r.scope}`, r]));
  const contradictions: ContradictionFinding[] = [];
  const seenPairs = new Set<string>();
  for (const p of contradictionPairs) {
    const key = `${p.scope}|${[p.a, p.b].sort().join('|')}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const a = ruleById.get(`${p.a}|${p.scope}`);
    const b = ruleById.get(`${p.b}|${p.scope}`);
    if (!a || !b) continue;
    contradictions.push({ scope: p.scope, a: ruleView(a, byClause, []).rule, b: ruleView(b, byClause, []).rule, reason: p.reason });
  }

  const inexpressible = policy.clauses.filter((cl) => !cl.expressible).map((cl) => ({ id: cl.id, text: cl.text, reason: cl.reason ?? 'unstated' }));
  return {
    corpus: corpus.name,
    policy: { name: policy.policy, version: policy.version, file: policyFile },
    counts: {
      tribal: tribal.length,
      tribalExtended: tribal.filter((f) => f.tribalKind === 'extended-beyond-policy').length,
      tribalNovel: tribal.filter((f) => f.tribalKind === 'novel').length,
      confirmed: confirmed.length,
      gap: { violated: gap.filter((g) => g.kind === 'violated').length, neverExercised: gap.filter((g) => g.kind === 'never-exercised').length, keptNotMined: gap.filter((g) => g.kind === 'kept-not-mined').length },
      contradictions: contradictions.length,
      inexpressible: inexpressible.length,
    },
    tribal,
    confirmed,
    gap,
    contradictions,
    inexpressible,
    undecided,
  };
}

export function renderDiff(d: Diff): string {
  const lines: string[] = [];
  lines.push(`polyx diff — ${d.corpus} against ${d.policy.name} v${d.policy.version}`);
  lines.push(`  ${d.counts.tribal} followed but never written (${d.counts.tribalExtended} the policy states for another flow, ${d.counts.tribalNovel} it never states at all) · ${d.counts.confirmed} confirmed · ${d.counts.gap.violated} written but violated · ${d.counts.gap.keptNotMined} written, kept, not mined · ${d.counts.gap.neverExercised} written, never exercised · ${d.counts.contradictions} contradictions · ${d.undecided.length} awaiting a person's alignment · ${d.counts.inexpressible} clauses polyx cannot state`);
  const section = (title: string, items: RuleFinding[]) => {
    lines.push('', `${title} (${items.length})`);
    for (const f of items) {
      lines.push(`  ${f.rule.id} ${f.rule.scope} ${f.rule.support} ${f.rule.provenance}  ${f.rule.text}`);
      for (const a of f.alignments) lines.push(`      ↔ ${a.clauseId} [${a.kind}, proposed for confirmation] ${a.clauseText}`);
      if (f.writtenElsewhere?.length) lines.push(`      the policy states this pair, but only for: ${f.writtenElsewhere.join(', ')}`);
      if (f.contradicting.length) lines.push(`      contradicting: ${f.contradicting.map((i) => `${i.interactionId}#${i.seq}`).join(' ')}`);
    }
  };
  section('TRIBAL KNOWLEDGE — followed, never written', d.tribal);
  section('CONFIRMED — written and followed', d.confirmed);
  lines.push('', `COMPLIANCE GAP — written, not mined (${d.gap.length})`);
  for (const g of d.gap) {
    const tag = g.kind === 'violated' ? `VIOLATED ${g.violated} of ${g.exercised} times — your reps ignore this` : g.kind === 'kept-not-mined' ? `kept ${g.exercised}/${g.exercised} times but below a mining floor` : 'never exercised — this situation never arose';
    lines.push(`  ${g.clause.id}  ${g.clause.text}`);
    lines.push(`      ${tag}${g.violations.length ? `; e.g. ${g.violations.slice(0, 5).map((i) => `${i.interactionId}#${i.seq}`).join(' ')}` : ''}`);
  }
  if (d.contradictions.length) {
    lines.push('', `CONTRADICTIONS within the mined set (${d.contradictions.length})`);
    for (const c of d.contradictions) lines.push(`  ${c.a.id} × ${c.b.id}: ${c.reason}`);
  }
  if (d.undecided.length) section('AWAITING ALIGNMENT — the matcher could only propose', d.undecided);
  return lines.join('\n');
}
