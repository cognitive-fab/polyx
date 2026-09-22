// `polyx evaluate` (FS §6, TS §9): the falsifiable claim, measured. Reads the
// rule set the miner persisted and the policy clause set, aligns them,
// computes the headline figures, and stamps every one with what produced it.
import { existsSync } from 'node:fs';
import { type LoadedCorpus, type Manifest, type Rule, type Thresholds } from 'polyx-lens';
import { align, goldReport, loadGold, type Alignment, type GoldReport } from './align.ts';
import { controls as computeControls, type Controls } from './controls.ts';
import { fmt, metrics, type Metrics, type Ratio } from './metrics.ts';
import { loadPolicy, type Policy } from './policies/index.ts';

export interface Evaluation {
  policy: { name: string; version: number; file: string; source?: string };
  gold: { file: string; present: boolean; report: GoldReport };
  metrics: Metrics;
  alignments: Alignment[];
  /** FS §6.1 targets and §6.5 falsification thresholds, and where this run landed. */
  gate: Gate;
  /** TS §9.4: the confounder controls, when the corpus was supplied. */
  controls?: Controls & {
    recallViolatedOnly: { strict: Ratio; lenient: Ratio };
    /** Recall over the clauses this corpus actually keeps — a diagnostic, never the headline. */
    recallKept: { strict: Ratio; lenient: Ratio };
  };
}

export interface Gate {
  targets: { precision: number; recall: number; refusalCorrectness: number };
  falsification: { precision: number; refusalCorrectnessAtChance: number };
  verdict: 'target' | 'between' | 'falsified' | 'unmeasured';
  notes: string[];
}

export const TARGETS = { precision: 0.7, recall: 0.5, refusalCorrectness: 0.8 };
export const FALSIFICATION = { precision: 0.4, refusalCorrectnessAtChance: 0.5 };

export function gate(m: Metrics): Gate {
  const notes: string[] = [];
  const p = m.precision.lenient.value;
  const r = m.recall.lenient.value;
  const rc = m.refusalCorrectness.value;
  let verdict: Gate['verdict'];
  if (p === null) {
    verdict = 'unmeasured';
    notes.push('no proposed rules: precision is undefined');
  } else if (p < FALSIFICATION.precision) {
    verdict = 'falsified';
    notes.push(`precision ${p.toFixed(3)} is below the falsification line ${FALSIFICATION.precision}: the pattern table manufactures true-but-useless regularities`);
  } else if (rc !== null && rc <= FALSIFICATION.refusalCorrectnessAtChance) {
    verdict = 'falsified';
    notes.push(`refusal correctness ${rc.toFixed(3)} is at chance: provenance is decoration`);
  } else if (p >= TARGETS.precision && (r ?? 0) >= TARGETS.recall && (rc === null || rc >= TARGETS.refusalCorrectness)) {
    verdict = 'target';
  } else {
    verdict = 'between';
    if (p < TARGETS.precision) notes.push(`precision ${p.toFixed(3)} < target ${TARGETS.precision}`);
    if ((r ?? 0) < TARGETS.recall) notes.push(`recall ${(r ?? 0).toFixed(3)} < target ${TARGETS.recall}`);
    if (rc !== null && rc < TARGETS.refusalCorrectness) notes.push(`refusal correctness ${rc.toFixed(3)} < target ${TARGETS.refusalCorrectness}`);
  }
  if (rc === null) notes.push('no refused rules: refusal correctness is undefined on this corpus');
  if (m.precision.strict.value !== null && m.precision.lenient.value !== null && m.precision.strict.value < m.precision.lenient.value) {
    notes.push(`strict precision ${m.precision.strict.value.toFixed(3)} — the gap to lenient is unconditioned rules that claim more than any single clause`);
  }
  return { targets: TARGETS, falsification: FALSIFICATION, verdict, notes };
}

export async function evaluate(rules: Rule[], policyFile: string, goldFile: string, corpus?: LoadedCorpus, thresholds?: Thresholds): Promise<Evaluation> {
  const policy: Policy = loadPolicy(policyFile);
  const alignments = align(rules, policy);
  const gold = loadGold(goldFile);
  const m = metrics(rules, policy, alignments);
  const out: Evaluation = {
    policy: { name: policy.policy, version: policy.version, file: policyFile },
    gold: { file: goldFile, present: existsSync(goldFile), report: goldReport(gold, alignments) },
    metrics: m,
    alignments,
    gate: gate(m),
  };
  if (policy.source) out.policy.source = policy.source;
  if (corpus) {
    const c = await computeControls(corpus, policy, thresholds);
    // Recall again, over the clauses the corpus actually broke at least once.
    const violated = new Set(c.violatedAtLeastOnce);
    const proposedKeys = new Set(rules.filter((r) => ['proposed', 'real', 'not_real', 'narrowed'].includes(r.status)).map((r) => `${r.id}|${r.scope}`));
    const strict = new Set<string>();
    const lenient = new Set<string>();
    for (const a of alignments) {
      if (!proposedKeys.has(`${a.ruleId}|${a.scope}`) || !violated.has(a.clauseId)) continue;
      if (a.kind === 'exact') strict.add(a.clauseId);
      if (a.kind === 'exact' || a.kind === 'general') lenient.add(a.clauseId);
    }
    const r = (n: number) => ({ num: n, den: violated.size, value: violated.size ? n / violated.size : null });
    // and again over the clauses the corpus itself keeps
    const kept = new Set(c.keptAtOwnSupport);
    const ks = new Set<string>();
    const kl = new Set<string>();
    for (const a of alignments) {
      if (!proposedKeys.has(`${a.ruleId}|${a.scope}`) || !kept.has(a.clauseId)) continue;
      if (a.kind === 'exact') ks.add(a.clauseId);
      if (a.kind === 'exact' || a.kind === 'general') kl.add(a.clauseId);
    }
    const rk = (n: number) => ({ num: n, den: kept.size, value: kept.size ? n / kept.size : null });
    out.controls = {
      ...c,
      recallViolatedOnly: { strict: r(strict.size), lenient: r(lenient.size) },
      recallKept: { strict: rk(ks.size), lenient: rk(kl.size) },
    };
  }
  return out;
}

export function renderEvaluation(e: Evaluation, manifest: Manifest): string {
  const m = e.metrics;
  const lines: string[] = [];
  lines.push(`polyx evaluate — ${manifest.corpus} against ${e.policy.name} v${e.policy.version}`);
  lines.push(`  alphabet v${manifest.alphabetVersion} · corpus ${manifest.corpusRevision} · segmenter ${manifest.segmenter} · seed ${manifest.seed} · commit ${manifest.codeCommit ?? 'none'}`);
  lines.push(`  thresholds ${JSON.stringify(manifest.thresholds)}`);
  lines.push('');
  lines.push(`clauses: ${m.clauses.total} total, ${m.clauses.expressible} expressible, ${m.clauses.inexpressible} not (${Object.entries(m.clauses.byReason).map(([k, v]) => `${v} ${k}`).join('; ')})`);
  lines.push(`rules: ${m.proposed} proposed, ${m.refused} refused`);
  lines.push('');
  lines.push(`precision            strict ${fmt(m.precision.strict)}   lenient ${fmt(m.precision.lenient)}   over alignable shapes only ${fmt(m.precision.alignable)}`);
  lines.push(`recall               strict ${fmt(m.recall.strict)}   lenient ${fmt(m.recall.lenient)}   (over expressible clauses only)`);
  if (m.recallAdjacent) {
    lines.push(`recall, steps the policy lists side by side  strict ${fmt(m.recallAdjacent.strict)}   lenient ${fmt(m.recallAdjacent.lenient)}   — the all-pairs figure above counts transitively implied clauses too; neither is "the" recall`);
  }
  lines.push(`refusal correctness  ${fmt(m.refusalCorrectness)}`);
  if (e.controls) {
    const c = e.controls;
    lines.push(`recall, violated-at-least-once clauses only (TS §9.4)  strict ${fmt(c.recallViolatedOnly.strict)}   lenient ${fmt(c.recallViolatedOnly.lenient)}   — ${c.violatedAtLeastOnce.length} of ${m.clauses.expressible} expressible clauses were ever broken; ${c.neverExercised.length} were never exercised`);
    lines.push(`recall over the clauses this corpus actually keeps  strict ${fmt(c.recallKept.strict)}   lenient ${fmt(c.recallKept.lenient)}   — DIAGNOSTIC, not the claim: it separates "polyx missed it" from "the agents do not do it" (the latter is the diff's compliance gap)`);
    lines.push(`failed / abandoned interactions kept in: ${c.failedShare.failed} of ${c.failedShare.of}${c.failedShare.value === null ? '' : ` (${(c.failedShare.value * 100).toFixed(1)}%)`}`);
  }
  lines.push(`unalignable proposed rules (shapes the policy never states): ${m.unalignable}; awaiting a person's confirmation: ${m.needsConfirmation}`);
  lines.push('');
  const g = e.gold.report;
  if (e.gold.present && g.pairs) {
    lines.push(`gold: ${g.pairs} pairs, ${g.doubleRated} double-rated, inter-rater ${g.interRater === null ? 'n/a' : g.interRater.toFixed(3)}, matcher agreement ${g.matcherAgreement === null ? 'n/a' : g.matcherAgreement.toFixed(3)}, ${g.matcherMissed} gold pairs the matcher never proposed`);
  } else {
    lines.push(`gold: none at ${e.gold.file} — every alignment above is a PROPOSAL awaiting confirmation (F8.3); the headline figures measure the matcher as much as the miner until a gold set exists`);
  }
  lines.push('');
  lines.push(`gate: ${e.gate.verdict.toUpperCase()}  (targets p≥${e.gate.targets.precision} r≥${e.gate.targets.recall} rc≥${e.gate.targets.refusalCorrectness}; falsified below p<${e.gate.falsification.precision} or rc at chance)`);
  for (const n of e.gate.notes) lines.push(`  ${n}`);
  return lines.join('\n');
}
