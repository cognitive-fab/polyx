// polyx audit | alphabet | mine | review | serve | evaluate | diff
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Condition, type Rule } from '@cognitive-fab/polyx-lens';
import { audit, figureEvents, renderAudit } from '@cognitive-fab/polyx-lens';
import { loadAlphabet, recommendableTypes } from '@cognitive-fab/polyx-lens';
import { activePredicates, annotatableAdapters, builtinPredicates, inertPredicates, isStale, loadPredicateSet, unproducedFacts, type Predicate, type PredicateSet } from '@cognitive-fab/polyx-lens';
import { annotationPath, builtinTextProfile, diffAnnotations, loadTextProfile, profileId, readAnnotations, type AnnotationFile } from '@cognitive-fab/polyx-lens';
import { loadConfig, corpusConfig, type Config } from '@cognitive-fab/polyx-lens';
import { codeCommit, corpusRevision, newRunId, type Manifest } from '@cognitive-fab/polyx-lens';
import { loadCorpus, type LoadOptions, type LoadedCorpus } from '@cognitive-fab/polyx-lens';
import { renderCondition } from '@cognitive-fab/polyx-lens';
import { exerciseClauses, inventory } from '@cognitive-fab/polyx-lens';
import { loadContracts } from '@cognitive-fab/polyx-lens';
import { buildReport, renderReport } from '@cognitive-fab/polyx-lens';
import { renderDiffHtml } from '../diff/html.ts';
import { diff, renderDiff } from '../diff/index.ts';
import { evaluate, renderEvaluation } from '../evaluate/index.ts';
import { startGoldServer } from '../evaluate/gold-server.ts';
import { goldFileFor, progress, readSuperseded, readVerdicts, sampleGold, supersede, writeVerdicts } from '../evaluate/gold.ts';
import { loadPolicy } from '../evaluate/policies/index.ts';
import { parseSweep, renderSweep, sweep } from '../evaluate/sweep.ts';
import { mine, renderMine, verdict } from '../mine/index.ts';
import { simpleClassifier } from '@cognitive-fab/polyx-lens';
import { builtinContracts, naiveExtractor, polynessClassifier, polynessExtractor } from '@cognitive-fab/polyx-lens';
import { startReviewServer } from '../review/server.ts';
import { renderReplay, replay } from '../serve/coverage.ts';
import { coverageSummary, startAdvisorServer, type ServeOptions } from '../serve/http.ts';
import { renderShown, show } from '../show.ts';
import { deriveFrom, drawSample, labelFileFor, measure, progressOf, readLabelFile, sitesFor, writeLabelFile, CalibrationIncomplete, type LabelFile } from '../ports/jev/calibrate.ts';
import { startLabelServer } from '../ports/jev/label-server.ts';
import { annotate, writePreview } from '../ports/jev/annotate.ts';
import { observerFromEnv } from '../ports/jev/observer.ts';
import { openStore, type Store } from '../store/db.ts';
import { adjudicate, adjudications, loadRule, loadRules, pendingNarrowings, persistMined, reviewPace, type ReviewVerdict } from '../store/rules.ts';
import { withThresholds, type Thresholds } from '@cognitive-fab/polyx-lens';

const USAGE = `usage: polyx <command> [options]

  audit <corpus> [--json] [--show <figure>] [--alphabet <file>]
      what the corpus repeats, what it does not support, and why
  alphabet show <corpus> <event-type> [--alphabet <file>]
      the source records assigned to an event type (F2.3)
  mine <corpus> [--json] [--all] [--extractor naive|polyness] [--classifier simple|polyness]
      synthesise candidate rules with evidence, counter-evidence and provenance
  review <corpus> [list] [--all] [--json]
      the rules awaiting adjudication (--all: every status)
  review <corpus> show <rule-id>
      one rule with its supporting and contradicting records
  review <corpus> mark <rule-id> real|not_real|narrowed [--note ..] [--reviewer ..] [--condition fact=value]
  review <corpus> serve [--port N] [--all] [--sample N]
      the domain reviewer's surface: one rule per screen, verdicts saved as given
  review <corpus> pace
      median seconds per verdict, measured (F5.4)
  calibrate <corpus> <predicate-id> [sample|serve|status|derive] [--sample N] [--port N] [--reviewer ..]
      label a sample of the corpus, then derive the predicate's bands from it.
      Bands are DERIVED, never set by hand: a predicate is inert until a person
      has labelled ~60 items (JF3.2), and the labeller is never shown the
      model's answer
  annotate <corpus> [--dry-run] [--import <file>] [--budget N] [--concurrency N] [--json]
      the frozen observation pass (JF6.1): one model call per distinct redacted
      text, answers recorded to .polyx/annotations/, digest pinned in the manifest.
      --dry-run writes the exact redacted payloads and sends NOTHING (JT7.3) —
      produce and read it before the first real run on any customer corpus.
      A re-run reports drift against the previous file (JF6.6).
      --import <file> installs a recorded annotation file instead of calling:
      anyone holding the file reproduces the figure, with no key (JF6.2).
      The only command that makes a network call; needs POLYX_JEV_KEY.
  predicates <corpus> [--show <id>] [--json]
      the declared observation predicates, with status and calibration age
      (a predicate emits no fact until a person has labelled a sample: JF3.1)
  (--scope <operator> picks the row when a rule was mined for several operators)
  lens <corpus> [--contracts <file>] [--json]
      the free report: what your agents did, and which of the rules they were
      given they kept. No mining, no store, no model call
  evaluate <corpus> [--policy <file>] [--gold <file>] [--json]
      precision, recall and refusal correctness of the mined rule set against a policy clause set
      (default policy: <policyRoot>/<corpus>-{guidelines,policy}.yaml — see POLYX_POLICIES)
  gold <corpus> [serve|status] [--port N] [--per-stratum N] [--redo <strata>] [--rater <name>]
      rate whether a mined rule and a written clause are the same rule, so the
      headline figures stop measuring the matcher (TS §9.2). One pair per screen.
  evaluate <corpus> --sweep "minInstances=3,5,10;impliesSupport=0.8,0.9"
      the same figures across a grid of thresholds — a curve, never a tuned point
  --scope-by <hint>      (mine, evaluate) treat a source hint — backbone, flow — as the operator,
                         for the cross-domain provenance experiment (FS §6.4)
  serve <corpus> [--port N] [--budget N]
      the advisor: POST /advise → recommend | warn | clear | abstain (only rules adjudicated real are served).
      An event may carry text; with POLYX_JEV_KEY set and a real, calibrated predicate, it is
      redacted and observed before the advisor answers, and every observation is logged with its p
  coverage <corpus> [--json] [--assume-proposed]
      replay every decision point in the corpus through the advisor: coverage, agreement, outcome precision (F7)
      (--assume-proposed: the what-if ceiling with every proposed rule treated as real)
  diff <corpus> [--policy <file>] [--out report.html] [--json]
      the three-region conformance report: followed-not-written, confirmed, written-not-followed (violated / never exercised / kept), contradictions

options
  --config <file>        polyx.config.json (default: ./polyx.config.json)
  --threshold k=v        override one threshold (repeatable)
  --segmenter <name>     null | polyness
`;

function fail(msg: string): never {
  throw new Error(msg);
}

export interface Ctx {
  config: Config;
  thresholds: Thresholds;
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Stamp and record a run. Returns the manifest every figure from this run carries. */
export function recordRun(store: Store, ctx: Ctx, command: string, corpus: LoadedCorpus, extra: Partial<Pick<Manifest, 'policyRevision'>> = {}): Manifest {
  const at = Date.now();
  const manifest: Manifest = {
    runId: newRunId(command, at),
    command,
    at,
    corpus: corpus.name,
    corpusRevision: corpus.revision,
    alphabetVersion: corpus.alphabet.version,
    alphabetFile: corpus.alphabetFile,
    thresholds: ctx.thresholds,
    seed: ctx.config.seed,
    codeCommit: codeCommit(),
    segmenter: corpus.segmenter,
  };
  if (extra.policyRevision) manifest.policyRevision = extra.policyRevision;
  if (corpus.meta.backbone) manifest.backbone = corpus.meta.backbone;
  if (Object.keys(corpus.meta).length) manifest.source = corpus.meta;
  store
    .prepare(
      `INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      manifest.runId,
      command,
      at,
      corpus.name,
      corpus.revision,
      corpus.alphabet.version,
      JSON.stringify(ctx.thresholds),
      ctx.config.seed,
      manifest.codeCommit,
      JSON.stringify(manifest),
    );
  return manifest;
}

/**
 * `polyx lens <corpus>` — the free report. What your agents did, and which of
 * the rules they were given they actually kept.
 *
 * Deliberately the smallest possible surface: it needs a corpus and a contract
 * set, and nothing else. No store, no mining, no adjudication, no model call.
 * A reader who has installed nothing gets a number about their own history on
 * the first run, which is the only thing that makes the rest worth asking
 * about.
 */
export async function cmdLens(ctx: Ctx, corpusName: string, opts: { json?: boolean; contracts?: string; alphabet?: string; segmenter?: string }) {
  const load: LoadOptions = {};
  if (opts.alphabet) load.alphabetFile = opts.alphabet;
  if (opts.segmenter) load.segmenter = opts.segmenter;
  const corpus = await loadCorpus(ctx.config, corpusName, load);
  // A contract set belongs to the SYSTEM, not the corpus: `cc` and `cc-mimo`
  // are two corpora of one harness and share its contracts, exactly as the five
  // tau2 corpora share one domain. `:` is legal in a domain and not in a
  // filename on every platform.
  // Contract sets ship inside polyx-lens, keyed by the SYSTEM: two corpora of
  // one harness share its contracts.
  const file = opts.contracts ?? builtinContracts(corpus.domain);
  if (!file || !existsSync(file)) {
    throw new Error(`no contract set for ${corpusName}: nothing shipped for '${corpus.domain}' and no --contracts given. Contract sets live in polyx-lens under contracts/.`);
  }
  const contracts = loadContracts(file);
  const exercise = await exerciseClauses(corpus, contracts.clauses);
  const report = buildReport(corpus, contracts, exercise, inventory(corpus));
  if (opts.json) ctx.out(JSON.stringify({ ...report, exercise }, null, 2));
  else ctx.out(renderReport(report, exercise));
  return 0;
}

export async function cmdAudit(ctx: Ctx, corpusName: string, opts: { json?: boolean; show?: string; alphabet?: string; segmenter?: string }) {
  const loadOpts: { alphabetFile?: string; segmenter?: string } = {};
  if (opts.alphabet) loadOpts.alphabetFile = opts.alphabet;
  if (opts.segmenter) loadOpts.segmenter = opts.segmenter;
  const corpus = await loadCorpus(ctx.config, corpusName, loadOpts);
  if (opts.show) {
    ctx.out(renderShown(show(figureEvents(corpus, opts.show))));
    return 0;
  }
  const report = audit(corpus, ctx.thresholds);
  const store = openStore(ctx.config.dbPath);
  try {
    const manifest = recordRun(store, ctx, 'audit', corpus);
    const dir = join(ctx.config.workspace, 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${manifest.runId}.audit.json`), JSON.stringify({ manifest, audit: report }, null, 2));
    // JT9.1 — three counts that did not exist before observation: predicates
    // declared, predicates inert (uncalibrated or stale), and conditions in
    // REAL rules that mention an obs.* fact no real predicate produces. The
    // third is a broken dependency and is an error, not a note.
    const set = predicateSetFor(ctx, corpusName);
    const realRules = loadRules(store, { corpus: corpusName }).filter((r) => r.status === 'real');
    const inert = set ? set.predicates.filter((p) => p.status !== 'real' || !p.calibration || isStale(p, corpus.revision, corpus.alphabet.version)) : [];
    const broken = realRules.flatMap((r) => unproducedFacts(r.conditions, set).map((f) => ({ rule: r.id, scope: r.scope, fact: f })));
    const observation = {
      annotatable: annotatableAdapters().includes(corpus.config.adapter),
      declared: set?.predicates.length ?? 0,
      inert: inert.length,
      inertBecause: inert.map((p) => ({ predicate: p.id, reason: p.status !== 'real' ? `status ${p.status}` : !p.calibration ? 'uncalibrated' : 'calibration stale (JF3.5)' })),
      broken,
    };
    if (opts.json) ctx.out(JSON.stringify({ manifest, audit: report, observation }, null, 2));
    else {
      ctx.out(renderAudit(report));
      ctx.out('');
      ctx.out(`observation           ${observation.annotatable ? 'annotatable' : 'NOT annotatable: the adapter carries no text'}; ${observation.declared} predicate(s) declared, ${observation.inert} inert`);
      for (const i of observation.inertBecause) ctx.out(`  inert ${i.predicate}: ${i.reason}`);
      for (const b of broken) ctx.out(`  ERROR real rule ${b.rule} (${b.scope}) depends on ${b.fact}, which no real predicate produces (JF4.3)`);
      ctx.out(`\nrun ${manifest.runId} recorded (commit ${manifest.codeCommit ?? 'none'})`);
    }
    if (broken.length) return 1;
  } finally {
    store.close();
  }
  return report.unknown.refused ? 2 : 0;
}

export async function cmdAlphabetShow(ctx: Ctx, corpusName: string, type: string, opts: { alphabet?: string }) {
  const loadOpts: { alphabetFile?: string } = {};
  if (opts.alphabet) loadOpts.alphabetFile = opts.alphabet;
  const corpus = await loadCorpus(ctx.config, corpusName, loadOpts);
  const rows = show(figureEvents(corpus, `type:${type}`));
  ctx.out(`${rows.length} record(s) assigned to ${type} under alphabet v${corpus.alphabet.version}`);
  ctx.out(renderShown(rows));
  return 0;
}

/**
 * Where a corpus's predicate set lives. Keyed by the alphabet's corpus FAMILY,
 * as the alphabet is: `cc` and `cc-mimo` are both Claude Code under one
 * reviewed set, and two copies of a reviewed artefact drift.
 *
 * Absent is normal and is never an error (JF6.5). A corpus with no predicate
 * set mines, audits and serves exactly as it does today.
 */
export function predicateFileFor(corpus: LoadedCorpus): string | null {
  return builtinPredicates(corpus.alphabet.corpus);
}

const calibrationAge = (p: Predicate, now: number): string => {
  const c = p.calibration;
  if (!c) return 'never';
  const days = Math.floor((now - Date.parse(c.at)) / 86_400_000);
  return Number.isFinite(days) ? `${days}d` : c.at;
};

export async function cmdPredicates(ctx: Ctx, corpusName: string, opts: { show?: string; json?: boolean }) {
  const corpus = await loadCorpus(ctx.config, corpusName);
  const file = predicateFileFor(corpus);
  if (!file) {
    // Not an error. It is the state every corpus is in until someone declares
    // a question, and it is what `mine` and `serve` already assume.
    ctx.out(`no predicate set for '${corpusName}' (looked for predicates.${corpus.alphabet.corpus}.yaml)`);
    ctx.out('this corpus observes nothing and mines exactly as it does today');
    return 0;
  }
  const { set, warnings } = loadPredicateSet(file);
  if (set.corpus !== corpus.alphabet.corpus) {
    throw new Error(`${file} is for corpus family '${set.corpus}', not '${corpus.alphabet.corpus}'`);
  }
  const now = Date.now();
  const stale = (p: Predicate) => p.calibration !== undefined && isStale(p, corpus.revision, corpus.alphabet.version);

  if (opts.show) {
    const p = set.predicates.find((x) => x.id === opts.show);
    if (!p) throw new Error(`no predicate '${opts.show}' in ${file} (known: ${set.predicates.map((x) => x.id).join(', ')})`);
    if (opts.json) {
      ctx.out(JSON.stringify(p, null, 2));
      return 0;
    }
    ctx.out(`${p.id}  ${p.fact}`);
    ctx.out(`  status      ${p.status}${stale(p) ? ' (calibration STALE — inert until recalibrated)' : ''}`);
    ctx.out(`  quadrant    ${p.quadrant}`);
    ctx.out(`  reads       ${p.source} over window '${p.window}'`);
    ctx.out(`  bands       assert at p >= ${p.bands.assertAt}; ${p.bands.refuteAt < 0 ? 'assert-only — it can never contribute a false' : `refute at p <= ${p.bands.refuteAt}`}`);
    ctx.out(`  question    ${p.question}`);
    if (p.criteria) {
      ctx.out(`    true      ${p.criteria.true}`);
      ctx.out(`    false     ${p.criteria.false}`);
    }
    const c = p.calibration;
    if (!c) {
      ctx.out('  calibration none — this predicate emits NO fact, in every path (JF3.1)');
      ctx.out(`              next: polyx calibrate ${corpusName} ${p.id}`);
    } else {
      ctx.out(`  calibration ${c.at} by ${c.reviewer}: n=${c.n} (${c.labels.true} true, ${c.labels.false} false)`);
      ctx.out(`              assert precision ${c.assertPrecision}${c.refutePrecision === null ? '' : `, refute precision ${c.refutePrecision}`}, withheld ${c.withheldFraction}`);
      if (c.labelSeparation !== undefined) ctx.out(`              label separation ${c.labelSeparation.toFixed(3)}`);
      ctx.out(`              measured against corpus ${c.corpusRevision}, alphabet v${c.alphabetVersion}`);
    }
    for (const w of warnings.filter((x) => x.predicate === p.id)) ctx.out(`  note        ${w.message}`);
    return 0;
  }

  const active = activePredicates(set).filter((p) => !stale(p));
  // Stale IS inert (JF3.5): a calibration measured against a corpus that has
  // since moved makes the predicate emit nothing, and the count has to say
  // so or the row's STALE flag and the summary line would disagree.
  const inert = [...inertPredicates(set), ...set.predicates.filter((p) => stale(p)).map((predicate) => ({ predicate, reason: 'calibration stale (JF3.5)' }))];
  if (opts.json) {
    ctx.out(JSON.stringify({ file, version: set.version, model: set.model, redaction: set.redaction, declared: set.predicates.length, active: active.length, inert: inert.length, predicates: set.predicates, warnings }, null, 2));
    return 0;
  }
  ctx.out(`polyx predicates — ${corpusName}: predicate set v${set.version}, model ${set.model}, redaction ${set.redaction}`);
  ctx.out(`  ${file}`);
  ctx.out('');
  for (const p of set.predicates) {
    const flag = stale(p) ? 'STALE' : p.status === 'real' && p.calibration ? 'real' : p.status;
    ctx.out(`  ${flag.padEnd(10)} ${p.id.padEnd(28)} ${p.fact.padEnd(32)} ${p.quadrant.padEnd(16)} calibrated ${calibrationAge(p, now)}`);
  }
  ctx.out('');
  ctx.out(`declared ${set.predicates.length}, emitting ${active.length}, inert ${inert.length}`);
  if (inert.length) {
    const why = new Map<string, number>();
    for (const i of inert) why.set(i.reason, (why.get(i.reason) ?? 0) + 1);
    ctx.out(`inert because: ${[...why].map(([r, n]) => `${r} (${n})`).join(', ')}`);
  }
  if (active.length === 0) {
    // The honest headline, and the one worth repeating: the cost of a
    // predicate is a labelled sample, not an API bill.
    ctx.out('');
    ctx.out('nothing is observed: no predicate has been calibrated and adjudicated real.');
    ctx.out(`the cost of a predicate is a labelled sample, not a model call — start with: polyx calibrate ${corpusName} <id>`);
  }
  for (const w of warnings) ctx.out(`note: ${w.predicate}: ${w.message}`);
  return 0;
}

/**
 * The annotation file a corpus mines over, or null. Resolved from the
 * predicate set's version so a set that changed since the last pass reads
 * NOTHING rather than a stale file (JF1.4): annotations produced under an
 * earlier version are not read under a later one.
 */
export function annotationsFor(ctx: Ctx, corpus: LoadedCorpus): { version: number; file: AnnotationFile } | null {
  const predFile = predicateFileFor(corpus);
  if (!predFile) return null;
  const { set } = loadPredicateSet(predFile);
  const file = readAnnotations(annotationPath(ctx.config.workspace, corpus.name, set.version));
  return file ? { version: set.version, file } : null;
}

/** The corpus's predicate set, or null. Loads the corpus only to learn its alphabet family. */
export function predicateSetFor(ctx: Ctx, corpusName: string): PredicateSet | null {
  const cc = corpusConfig(ctx.config, corpusName);
  const family = loadAlphabet(cc.alphabet).corpus;
  const file = builtinPredicates(family);
  return file ? loadPredicateSet(file).set : null;
}

export async function cmdCalibrate(ctx: Ctx, corpusName: string, id: string, sub: string, opts: { sample?: number; reviewer?: string; port?: number }) {
  const corpus = await loadCorpus(ctx.config, corpusName);
  const file = predicateFileFor(corpus);
  if (!file) throw new Error(`no predicate set for '${corpusName}'`);
  const { set } = loadPredicateSet(file);
  const predicate = set.predicates.find((p) => p.id === id);
  if (!predicate) throw new Error(`no predicate '${id}' in ${file} (known: ${set.predicates.map((p) => p.id).join(', ')})`);
  const labels = labelFileFor(ctx.config.workspace, corpusName, id);
  mkdirSync(join(ctx.config.workspace, 'labels'), { recursive: true });

  if (sub === 'sample') {
    const n = opts.sample ?? ctx.thresholds.minCalibration;
    // The same refusal annotate makes (JT7.2), for the same reason: the
    // sample is what the model will be asked, and it must be what leaves.
    const profileFile = builtinTextProfile(corpus.alphabet.corpus);
    if (!profileFile) throw new Error(`corpus '${corpusName}' declares no text redaction profile (looked for text.${corpus.alphabet.corpus}.yaml); a sample cannot be drawn from unredacted text (JT7.1)`);
    const profile = loadTextProfile(profileFile);
    if (set.redaction !== profileId(profile)) throw new Error(`${file} names redaction '${set.redaction}' but the corpus profile is '${profileId(profile)}'`);
    const sites = sitesFor(corpus, predicate, profile);
    if (sites.length === 0) {
      // Not a crash. Either the adapter has no text resolver — a τ² tool trace
      // or a BPIC event log carries no utterances — or the predicate reads a
      // slot nothing carries. Both are findings, and both are reported.
      throw new Error(`no site in '${corpusName}' carries text for ${predicate.source}. This corpus may not be annotatable at all; polyx audit reports which are.`);
    }
    const drawn = drawSample(sites, predicate, n, ctx.config.seed);
    if (drawn.length < n) ctx.err(`only ${drawn.length} distinct texts available, below the ${n} asked for`);
    // A larger draw EXTENDS the sample. The draw is deterministic, so the
    // first sixty of a hundred and twenty are the same sixty; a verdict
    // already given is kept, keyed by the text's hash, and only the new items
    // arrive unlabelled. A low base rate is the usual reason to redraw —
    // one positive in six means sixty items carry ten — and redrawing must
    // not cost the labels that found that out.
    const existing = readLabelFile(labels);
    const kept = new Map<string, boolean | null>();
    for (const i of existing?.items ?? []) if (i.label !== undefined) kept.set(i.sha, i.label);
    if (existing && existing.predicateSetVersion !== set.version) ctx.err(`warning: ${kept.size} label(s) were given under predicate set v${existing.predicateSetVersion}; kept, but the question may have changed`);
    const lf: LabelFile = {
      corpus: corpusName,
      predicate: id,
      question: predicate.question,
      predicateSetVersion: set.version,
      corpusRevision: corpus.revision,
      alphabetVersion: corpus.alphabet.version,
      seed: ctx.config.seed,
      reviewer: opts.reviewer ?? null,
      items: drawn.map((sx) => (kept.has(sx.sha) ? { ...sx, label: kept.get(sx.sha)! } : { ...sx })),
    };
    writeLabelFile(labels, lf);
    ctx.out(`drew ${drawn.length} distinct texts from ${sites.length} sites, redacted under ${profileId(profile)}${kept.size ? `; ${lf.items.filter((i) => i.label !== undefined).length} already labelled, kept` : ''}`);
    ctx.out(`  ${labels}`);
    ctx.out('');
    ctx.out('label each item, then: polyx calibrate ' + corpusName + ' ' + id + ' derive');
    return 0;
  }

  const lf = readLabelFile(labels);
  if (!lf) throw new Error(`no sample yet for '${id}' — run: polyx calibrate ${corpusName} ${id} sample`);
  // A sample drawn against a corpus that has since moved is not a sample of
  // this corpus. Say so rather than deriving a record that claims otherwise.
  if (lf.corpusRevision !== corpus.revision) ctx.err(`warning: the sample was drawn against corpus ${lf.corpusRevision}, now ${corpus.revision} — recalibration is required (JF3.5)`);
  if (lf.predicateSetVersion !== set.version) ctx.err(`warning: the sample was drawn under predicate set v${lf.predicateSetVersion}, now v${set.version}`);

  if (sub === 'serve') {
    const { url } = await startLabelServer({ labelFile: labels, ...(opts.port !== undefined ? { port: opts.port } : {}) });
    ctx.out(`labelling ${id} at ${url}`);
    ctx.out('one text per screen; Y yes, N no, U cannot tell from the text. Saved as given. Ctrl-C when done.');
    await new Promise<never>(() => undefined);
  }

  const pr = progressOf(lf);
  if (sub === 'status') {
    ctx.out(`${id}: ${pr.labelled}/${pr.total} labelled (${pr.trueN} true, ${pr.falseN} false, ${pr.unsure} unsure)`);
    if (pr.unsure) {
      // Worth saying out loud. "I cannot tell from the text" is the reviewer
      // discovering the predicate's quadrant by hand.
      ctx.out(`${pr.unsure} item(s) marked unsure: a question a person cannot answer from the text is one the model cannot answer either (JF2.4)`);
    }
    return 0;
  }
  if (sub !== 'derive') throw new Error(`usage: polyx calibrate <corpus> <id> [sample|serve|status|derive]`);

  // An unsure is a label: the reviewer looked and could not decide from the
  // text. It counts toward the sample; the per-label floors inside
  // deriveBands are what guarantee enough yes and enough no.
  if (pr.labelled < ctx.thresholds.minCalibration) {
    ctx.out(`${pr.labelled}/${pr.total} labelled; ${ctx.thresholds.minCalibration} are needed (JF3.2)`);
    return 1;
  }
  // Jev if a key is configured, the null observer otherwise — which records
  // nothing and lets deriveFrom say so, rather than failing here.
  const measured = await measure(lf, predicate, observerFromEnv(set.model, set.version));
  writeLabelFile(labels, measured);
  try {
    const record = deriveFrom(measured, predicate, ctx.thresholds, opts.reviewer ?? lf.reviewer ?? 'unknown', corpus);
    ctx.out(`derived bands for ${id}:`);
    ctx.out(JSON.stringify(record, null, 2));
    ctx.out('');
    ctx.out(`paste this into ${file} under ${id}, and bump the set version (JF1.4)`);
    return 0;
  } catch (e) {
    if (e instanceof CalibrationIncomplete) {
      ctx.err(String((e as Error).message));
      return 1;
    }
    // A derivation refusal is a RESULT, not a crash: it is the tool saying
    // this predicate cannot be calibrated on this sample, and why.
    ctx.err(`cannot calibrate ${id}: ${(e as Error).message}`);
    return 1;
  }
}

export async function cmdAnnotate(ctx: Ctx, corpusName: string, opts: { dryRun?: boolean; budget?: number; concurrency?: number; json?: boolean; importFile?: string }) {
  const corpus = await loadCorpus(ctx.config, corpusName);
  const predFile = predicateFileFor(corpus);
  if (!predFile) throw new Error(`no predicate set for '${corpusName}' — nothing to annotate`);
  const { set } = loadPredicateSet(predFile);

  // JT7.2 — failing closed, by name. This is the check that decides whether
  // the integration is usable on a bank corpus at all, so it runs before
  // anything is resolved, let alone sent.
  const profileFile = builtinTextProfile(corpus.alphabet.corpus);
  if (!profileFile) {
    throw new Error(`corpus '${corpusName}' declares no text redaction profile (looked for text.${corpus.alphabet.corpus}.yaml). A corpus whose redaction is not declared cannot be annotated (JT7.2).`);
  }
  const profile = loadTextProfile(profileFile);
  if (set.redaction !== profileId(profile)) {
    throw new Error(`${predFile} names redaction '${set.redaction}' but the corpus profile is '${profileId(profile)}'. Update the predicate set to name the profile it was reviewed under.`);
  }

  mkdirSync(join(ctx.config.workspace, 'annotations'), { recursive: true });

  if (opts.dryRun) {
    const path = join(ctx.config.workspace, 'annotations', `${corpusName}.preview.jsonl`);
    const r = writePreview(path, corpus, set, profile);
    ctx.out(`dry run — ${r.distinct} distinct payload(s) over ${r.sites} site(s) written to`);
    ctx.out(`  ${path}`);
    ctx.out(`under ${profileId(profile)}. Nothing was sent. Read every line before configuring a key.`);
    for (const sk of r.skipped) ctx.out(`  note: ${sk.predicate} is ${sk.reason} and would not run — its text is previewed anyway`);
    return 0;
  }

  const path = annotationPath(ctx.config.workspace, corpusName, set.version);
  // Held in memory before the pass overwrites it, so the drift figure is
  // always against what was there (JF6.6).
  const previous = readAnnotations(path);

  if (opts.importFile) {
    // JF6.2, made usable: a figure carrying an annotationDigest is
    // reproducible by anyone holding that annotation file, with no key and no
    // network. This is how they hold it. The file is checked, not trusted:
    // every line must be for this predicate-set version and this corpus's
    // redaction profile, or a stale recording would be read as current.
    const incoming = readAnnotations(opts.importFile);
    if (!incoming) throw new Error(`no annotation file at ${opts.importFile}`);
    const bad = incoming.lines.find((l) => l.pv !== set.version || l.redaction !== profileId(profile));
    if (bad) throw new Error(`${opts.importFile}: line for ${bad.i}/${bad.seq} was recorded under predicate set v${bad.pv}, ${bad.redaction}; this corpus is v${set.version}, ${profileId(profile)}. Annotations made under one version are not read under another (JF1.4).`);
    const corpusIds = new Set(corpus.interactions.map((i) => i.id));
    const foreign = incoming.lines.filter((l) => !corpusIds.has(l.i)).length;
    if (foreign) throw new Error(`${opts.importFile}: ${foreign} line(s) name interactions not in '${corpusName}' — this recording is of a different corpus`);
    mkdirSync(join(ctx.config.workspace, 'annotations'), { recursive: true });
    copyFileSync(opts.importFile, incoming.partial ? path.replace(/\.jsonl$/, '.partial.jsonl') : path);
    const store = openStore(ctx.config.dbPath);
    try {
      const manifest = recordRun(store, ctx, 'annotate', corpus);
      manifest.predicateSetVersion = set.version;
      manifest.annotationDigest = incoming.digest;
      if (incoming.partial) manifest.annotationPartial = true;
      store.prepare('UPDATE runs SET manifest_json = ? WHERE id = ?').run(JSON.stringify(manifest), manifest.runId);
      ctx.out(`imported ${incoming.lines.length} recorded observation(s) for ${corpusName} — predicate set v${set.version}, digest ${incoming.digest}${incoming.partial ? ' (PARTIAL)' : ''}`);
      ctx.out(`  ${path}`);
      ctx.out(`no call was made. mine, coverage and evaluate now read this file; the digest is in manifest ${manifest.runId}`);
      if (previous && previous.digest !== incoming.digest) {
        const d = diffAnnotations(previous, incoming);
        ctx.out(`  replaced ${previous.digest}: ${d.changed} of ${d.shared} shared fact(s) differ`);
      }
      return 0;
    } finally {
      store.close();
    }
  }

  const observer = observerFromEnv(set.model, set.version);
  if (observer.name === 'null') {
    ctx.err('POLYX_JEV_KEY is not set: the observer is the null one and this pass would record nothing.');
    ctx.err('Run with --dry-run to see what would be sent, or set the key to annotate.');
    return 1;
  }

  const annotateOpts: Parameters<typeof annotate>[5] = {};
  if (opts.budget !== undefined) annotateOpts.budget = opts.budget;
  if (opts.concurrency !== undefined) annotateOpts.concurrency = opts.concurrency;
  const r = await annotate(corpus, set, profile, observer, ctx.config.workspace, annotateOpts);

  const store = openStore(ctx.config.dbPath);
  try {
    const manifest = recordRun(store, ctx, 'annotate', corpus);
    if (r.file) {
      manifest.predicateSetVersion = set.version;
      manifest.annotationDigest = r.file.digest;
      if (r.partial) manifest.annotationPartial = true;
      store.prepare('UPDATE runs SET manifest_json = ? WHERE id = ?').run(JSON.stringify(manifest), manifest.runId);
    }
    const drift = previous && r.file ? diffAnnotations(previous, r.file) : null;
    if (opts.json) {
      ctx.out(JSON.stringify({ ...r, file: r.file ? { path: r.file.path, digest: r.file.digest, partial: r.file.partial, lines: r.file.lines.length } : null, drift, manifest: manifest.runId, observer: observer.name }, null, 2));
      return 0;
    }
    ctx.out(`polyx annotate — ${corpusName}: predicate set v${set.version}, ${observer.name}, ${profileId(profile)}`);
    ctx.out(`  ${r.sites} site(s), ${r.distinct} distinct text(s): ${r.callsMade} call(s) made, ${r.callsSaved} answered from the text cache`);
    if (r.file) ctx.out(`  ${r.file.lines.length} line(s) → ${r.file.path}  digest ${r.file.digest}${r.partial ? '  PARTIAL (budget)' : ''}`);
    else ctx.out('  nothing recorded');
    if (r.models.length) {
      ctx.out(`  answered by ${r.models.join(', ')}${r.models.length > 1 ? ' — MORE THAN ONE: the vendor moved during this pass' : ''}`);
      // The dated id the risk register said did not exist. Asking for
      // `jev-latest` and recording `jev-1.13.0` is fine; asking for
      // `jev-latest` next month and getting `jev-1.14.0` is a recalibration,
      // and the predicate set should say which one it was calibrated against.
      if (set.model === 'jev-latest' && r.models.length === 1) ctx.out(`  pin it: set model: ${r.models[0]} in ${predFile} so a later answer from a different model is a recalibration, not a surprise`);
    }
    if (r.unobservable) ctx.out(`  ${r.unobservable} site(s) carry no text any predicate reads — they abstain as today`);
    for (const sk of r.skipped) ctx.out(`  skipped ${sk.predicate}: ${sk.reason}`);
    if (drift && previous) {
      ctx.out('');
      ctx.out(`drift against the previous file (${previous.digest}): ${drift.changed} of ${drift.shared} shared fact(s) changed, ${drift.moved} moved without changing`);
      const modelMoved = drift.models.before.length && drift.models.after.length && drift.models.before.join() !== drift.models.after.join();
      if (modelMoved) ctx.out(`  the model changed: ${drift.models.before.join(', ')} → ${drift.models.after.join(', ')}. Any drift above is a model change, not jitter — recalibrate (JF3.5)`);
      else if (drift.shared && drift.changed / drift.shared > 0.02) ctx.out('  more than 2% drift under the same model: a band sits where the samples are (JT4.2) — recalibrate');
      for (const [pred, x] of Object.entries(drift.byPredicate)) if (x.changed) ctx.out(`  ${pred}: ${x.changed}/${x.shared}`);
    }
    ctx.out(`  manifest ${manifest.runId}`);
    return 0;
  } finally {
    store.close();
  }
}


export async function cmdMine(ctx: Ctx, corpusName: string, opts: { json?: boolean; all?: boolean; extractor?: string; classifier?: string; segmenter?: string; scopeBy?: string; recommend?: boolean }) {
  const loadOpts: { segmenter?: string; scopeBy?: string } = {};
  if (opts.segmenter) loadOpts.segmenter = opts.segmenter;
  if (opts.scopeBy) loadOpts.scopeBy = opts.scopeBy;
  const corpus = await loadCorpus(ctx.config, corpusName, loadOpts);
  // Both implementations of each port come from polyx-lens, which vendors the
  // polyness half — so the choice is a flag rather than an optional install.
  const extractor = opts.extractor === 'polyness' ? polynessExtractor : opts.extractor === undefined || opts.extractor === 'naive' ? naiveExtractor : fail(`--extractor must be naive | polyness, got '${opts.extractor}'`);
  const classifier = opts.classifier === 'polyness' ? polynessClassifier : opts.classifier === undefined || opts.classifier === 'simple' ? simpleClassifier : fail(`--classifier must be simple | polyness, got '${opts.classifier}'`);
  const store = openStore(ctx.config.dbPath);
  try {
    const manifest = recordRun(store, ctx, 'mine', corpus);
    const requested = pendingNarrowings(store, corpusName);
    // JF6.5: read whatever annotations exist, report which, never call the
    // port. A corpus with none mines exactly as it did before observation
    // existed.
    const annotations = annotationsFor(ctx, corpus);
    if (annotations) {
      manifest.predicateSetVersion = annotations.version;
      manifest.annotationDigest = annotations.file.digest;
      if (annotations.file.partial) manifest.annotationPartial = true;
      store.prepare('UPDATE runs SET manifest_json = ? WHERE id = ?').run(JSON.stringify(manifest), manifest.runId);
    }
    const result = await mine(corpus, ctx.thresholds, { extractor, classifier, minedAt: manifest.at, requested, recommend: opts.recommend !== false, ...(annotations ? { annotations: annotations.file } : {}) });
    const persisted = persistMined(store, manifest, result.rules, result.contradictions, ctx.thresholds);
    const dir = join(ctx.config.workspace, 'reports');
    mkdirSync(dir, { recursive: true });
    const report = { manifest, extractor: result.extractor, classifier: result.classifier, stats: result.stats, persisted, contradictions: result.contradictions, rules: result.rules };
    writeFileSync(join(dir, `${manifest.runId}.mine.json`), JSON.stringify(report, null, 2));
    if (opts.json) ctx.out(JSON.stringify(report, null, 2));
    else {
      ctx.out(`polyx mine — ${corpus.name} (alphabet v${corpus.alphabet.version}, corpus ${corpus.revision}, segmenter ${corpus.segmenter}, extractor ${result.extractor}, classifier ${result.classifier})`);
      ctx.out('');
      ctx.out(renderMine(result, { all: opts.all ?? false }));
      ctx.out('');
      ctx.out(`store: ${persisted.inserted} new, ${persisted.updated} updated, ${persisted.kept} adjudicated and kept, ${persisted.reproposed} re-proposed, ${persisted.retired} retired, ${persisted.removed} removed`);
      if (result.observation) ctx.out(`observations: predicate set v${annotations!.version}, annotation ${result.observation.digest}${result.observation.partial ? ' (PARTIAL)' : ''} — ${result.observation.observed} fact(s) at ${result.observation.sites} site(s)`);
      else ctx.out('observations: none — this corpus mines over typed state only');
      ctx.out(`run ${manifest.runId} recorded`);
    }
  } finally {
    store.close();
  }
  return 0;
}

function parseCondition(s: string): Condition {
  const m = /^([A-Za-z0-9_.]+)=(.*)$/.exec(s);
  if (!m) throw new Error(`--condition expects fact=value, got '${s}'`);
  const raw = m[2]!;
  const value = raw === 'true' ? true : raw === 'false' ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  return { fact: m[1]!, op: 'eq', value };
}

function renderRule(r: Rule, detail = false): string {
  const lines = [
    `${r.id}  [${r.status}] ${r.scope}  ${r.support.holds}/${r.support.of}  ${verdict(r)}${r.window === 'interaction' ? '  (per contact)' : ''}`,
    `  ${r.text}`,
    `  ${r.evidence}`,
  ];
  if (r.conditions.length) lines.push(`  when ${r.conditions.map(renderCondition).join(' and ')}`);
  if (r.reproposedReason) lines.push(`  re-proposed: ${r.reproposedReason}`);
  if (r.suppressedBy) lines.push(`  ${r.suppressedBy}`);
  if (r.retiredReason) lines.push(`  retired: ${r.retiredReason}`);
  if (r.parentId) lines.push(`  narrowed from ${r.parentId}`);
  if (detail) {
    lines.push(`  pattern ${r.pattern}, window ${r.window}, alphabet v${r.alphabetVersion}, corpus support ${r.corpusSupport.holds}/${r.corpusSupport.of}`);
    lines.push(`  predicate: ${r.predicates.js}`);
  }
  return lines.join('\n');
}

export async function cmdReview(ctx: Ctx, corpusName: string, args: string[], opts: { json?: boolean; all?: boolean; note?: string; reviewer?: string; condition?: string; scope?: string; port?: number; sample?: number }) {
  const [sub, id, verdictArg] = args;
  if (sub === 'serve') {
    const corpus = await loadCorpus(ctx.config, corpusName);
    const o: Parameters<typeof startReviewServer>[0] = { dbPath: ctx.config.dbPath, corpus };
    if (opts.port !== undefined) o.port = opts.port;
    if (opts.sample !== undefined) o.sample = opts.sample;
    if (opts.all) o.all = true;
    o.predicates = predicateSetFor(ctx, corpusName);
    const srv = await startReviewServer(o);
    ctx.out(`review surface for ${corpusName} at ${srv.url} — one rule per screen; R real, N not real, W narrow, S skip. Ctrl-C to stop.`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => srv.close().then(resolve, resolve));
    });
    return 0;
  }
  const store = openStore(ctx.config.dbPath);
  try {
    if (sub === 'list') {
      const filter = opts.all ? { corpus: corpusName } : { corpus: corpusName, status: ['proposed' as const], ownOnly: true };
      const rules = loadRules(store, opts.scope ? { ...filter, scope: opts.scope } : filter);
      if (opts.json) ctx.out(JSON.stringify(rules, null, 2));
      else {
        ctx.out(`${rules.length} rule(s)${opts.all ? '' : ' awaiting adjudication (own evidence only; --all for every status)'}`);
        for (const r of rules) ctx.out(renderRule(r));
      }
      return 0;
    }
    if (sub === 'show') {
      if (!id) throw new Error('review show: which rule?');
      const r = loadRule(store, id, opts.scope, corpusName);
      if (!r) throw new Error(`no rule ${id}`);
      if (opts.json) {
        ctx.out(JSON.stringify({ rule: r, adjudications: adjudications(store, id, r.scope, r.corpus) }, null, 2));
        return 0;
      }
      ctx.out(renderRule(r, true));
      const corpus = await loadCorpus(ctx.config, corpusName);
      const byId = new Map(corpus.interactions.map((i) => [i.id, i]));
      const pairs = (refs: Rule['examples']) =>
        refs.flatMap((e) => {
          const interaction = byId.get(e.interactionId);
          const event = interaction?.events[e.seq];
          return interaction && event ? [{ interaction, event }] : [];
        });
      ctx.out(`\ncontradicting (${r.support.of - r.support.holds} of ${r.support.of}; showing ${r.counterexamples.length}):`);
      ctx.out(renderShown(show(pairs(r.counterexamples))));
      ctx.out(`\nsupporting (${r.support.holds} of ${r.support.of}; showing ${r.examples.length}):`);
      ctx.out(renderShown(show(pairs(r.examples))));
      const adj = adjudications(store, id, r.scope, r.corpus);
      if (adj.length) {
        ctx.out('\nadjudications:');
        for (const a of adj) {
          ctx.out(`  ${new Date(a.at).toISOString()} ${a.verdict}${a.reviewer ? ' by ' + a.reviewer : ''} at ${a.support.holds}/${a.support.of}${a.note ? ' — ' + a.note : ''}${a.condition ? ' when ' + renderCondition(a.condition) : ''}`);
        }
      }
      return 0;
    }
    if (sub === 'mark') {
      if (!id || !verdictArg) throw new Error('usage: polyx review <corpus> mark <rule-id> real|not_real|narrowed');
      if (verdictArg !== 'real' && verdictArg !== 'not_real' && verdictArg !== 'narrowed') {
        throw new Error(`verdict must be real | not_real | narrowed, got '${verdictArg}'`);
      }
      const o: Parameters<typeof adjudicate>[3] = {};
      if (opts.note) o.note = opts.note;
      if (opts.reviewer) o.reviewer = opts.reviewer;
      if (opts.condition) o.condition = parseCondition(opts.condition);
      if (opts.scope) o.scope = opts.scope;
      o.corpus = corpusName;
      o.predicates = predicateSetFor(ctx, corpusName);
      const r = adjudicate(store, id, verdictArg as ReviewVerdict, o);
      ctx.out(renderRule(r));
      return 0;
    }
    if (sub === 'pace') {
      const p = reviewPace(store);
      ctx.out(
        p.medianSeconds === null
          ? `${p.verdicts} verdict(s); not enough consecutive verdicts to measure a pace`
          : `${p.verdicts} verdict(s); median ${p.medianSeconds.toFixed(0)}s per rule (target: 90s, F5.4)`,
      );
      return 0;
    }
    throw new Error(`review: unknown subcommand '${sub}'`);
  } finally {
    store.close();
  }
}

export async function cmdEvaluate(ctx: Ctx, corpusName: string, opts: { json?: boolean; policy?: string; gold?: string; sweep?: string; scopeBy?: string }) {
  const loadOpts: { scopeBy?: string } = {};
  if (opts.scopeBy) loadOpts.scopeBy = opts.scopeBy;
  const corpus = await loadCorpus(ctx.config, corpusName, loadOpts);
  const policyFile = policyFor(ctx, corpusName, opts.policy);
  const goldFile = opts.gold ?? policyFile.replace(/\.yaml$/, '-gold.yaml');
  if (opts.sweep) {
    const grid = parseSweep(opts.sweep);
    const points = await sweep(corpus, ctx.thresholds, grid, policyFile);
    if (opts.json) ctx.out(JSON.stringify({ corpus: corpusName, corpusRevision: corpus.revision, alphabetVersion: corpus.alphabet.version, policyFile, base: ctx.thresholds, points }, null, 2));
    else {
      ctx.out(`polyx evaluate --sweep — ${corpusName} (alphabet v${corpus.alphabet.version}, corpus ${corpus.revision}) against ${policyFile}`);
      ctx.out(`base thresholds ${JSON.stringify(ctx.thresholds)}`);
      ctx.out('');
      ctx.out(renderSweep(points));
    }
    return 0;
  }
  const store = openStore(ctx.config.dbPath);
  try {
    const rules = loadRules(store, { corpus: corpusName });
    if (rules.length === 0) throw new Error(`no rules in the store for ${corpusName}: run polyx mine ${corpusName} first`);
    const manifest = recordRun(store, ctx, 'evaluate', corpus, { policyRevision: corpusRevision(policyFile) });
    const result = await evaluate(rules, policyFile, goldFile, corpus, ctx.thresholds);
    const dir = join(ctx.config.workspace, 'reports');
    mkdirSync(dir, { recursive: true });
    const report = { manifest, policyRevision: manifest.policyRevision, ...result };
    writeFileSync(join(dir, `${manifest.runId}.evaluate.json`), JSON.stringify(report, null, 2));
    if (opts.json) ctx.out(JSON.stringify(report, null, 2));
    else {
      ctx.out(renderEvaluation(result, manifest));
      ctx.out(`\nrun ${manifest.runId} recorded (policy ${report.policyRevision})`);
    }
    return result.gate.verdict === 'falsified' ? 3 : 0;
  } finally {
    store.close();
  }
}

export async function cmdCoverage(ctx: Ctx, corpusName: string, opts: { json?: boolean; assumeProposed?: boolean; scopeBy?: string }) {
  const corpus = await loadCorpus(ctx.config, corpusName, opts.scopeBy ? { scopeBy: opts.scopeBy } : {});
  const store = openStore(ctx.config.dbPath);
  try {
    const manifest = recordRun(store, ctx, 'coverage', corpus);
    // --assume-proposed is a WHAT-IF: the ceiling the advisor could reach if a
    // reviewer marked every proposed rule real. Labelled as such in the output.
    const rules = loadRules(store, { corpus: corpusName }).map((r) => (opts.assumeProposed && r.status === 'proposed' ? { ...r, status: 'real' as const } : r));
    store.prepare('DELETE FROM decision_points WHERE source = ?').run(`replay:${corpusName}`);
    // JT8.1 — the replay reads the annotation file and never calls the port,
    // so the figure is a function of the corpus plus that file and nothing
    // else. What was read is pinned in the manifest.
    const annotations = annotationsFor(ctx, corpus);
    if (annotations) {
      manifest.predicateSetVersion = annotations.version;
      manifest.annotationDigest = annotations.file.digest;
      if (annotations.file.partial) manifest.annotationPartial = true;
      store.prepare('UPDATE runs SET manifest_json = ? WHERE id = ?').run(JSON.stringify(manifest), manifest.runId);
    }
    const r = await replay(corpus, rules, store, annotations?.file ?? null);
    const dir = join(ctx.config.workspace, 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${manifest.runId}.coverage.json`), JSON.stringify({ manifest, replay: r, log: coverageSummary(store, `replay:${corpusName}`) }, null, 2));
    if (opts.json) ctx.out(JSON.stringify({ manifest, replay: r }, null, 2));
    else {
      ctx.out(renderReplay(r, corpusName));
      if (opts.assumeProposed) ctx.out('\nWHAT-IF: every proposed rule treated as real. This is the ceiling, not the served figure.');
      ctx.out(`\nrun ${manifest.runId} recorded`);
    }
    return 0;
  } finally {
    store.close();
  }
}

function policyFor(ctx: Ctx, corpusName: string, explicit?: string): string {
  const named = ctx.config.policyRoots.flatMap((d) => [join(d, `${corpusName}-guidelines.yaml`), join(d, `${corpusName}-policy.yaml`)]);
  const candidates = [explicit, ctx.config.corpora[corpusName]?.policy, ...named].filter((p): p is string => Boolean(p));
  const found = candidates.find((p) => existsSync(p));
  // The clause sets are not in this repository (config.ts, `policyRoot`), so a
  // missing one is usually a missing checkout rather than a missing file.
  if (!found) throw new Error(`no policy clause set for ${corpusName}: looked for ${candidates.join(', ')}. Clause sets live in the polyx-bench and polyx-eval checkouts; set POLYX_POLICIES or "policies" in ${'polyx.config.json'} if it is elsewhere.`);
  return found;
}

export async function cmdDiff(ctx: Ctx, corpusName: string, opts: { json?: boolean; policy?: string; out?: string }) {
  const corpus = await loadCorpus(ctx.config, corpusName);
  const policyFile = policyFor(ctx, corpusName, opts.policy);
  const store = openStore(ctx.config.dbPath);
  try {
    const rules = loadRules(store, { corpus: corpusName });
    if (rules.length === 0) throw new Error(`no rules in the store for ${corpusName}: run polyx mine ${corpusName} first`);
    const latestMine = store.prepare("SELECT id FROM runs WHERE corpus = ? AND command = 'mine' ORDER BY at DESC LIMIT 1").get(corpusName) as { id: string } | undefined;
    const pairs = latestMine
      ? (store.prepare('SELECT scope, rule_a AS a, rule_b AS b, reason FROM contradictions WHERE run_id = ?').all(latestMine.id) as Array<{ scope: string; a: string; b: string; reason: string }>)
      : [];
    const manifest = recordRun(store, ctx, 'diff', corpus, { policyRevision: corpusRevision(policyFile) });
    const d = await diff(corpus, rules, policyFile, pairs);
    const dir = join(ctx.config.workspace, 'reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${manifest.runId}.diff.json`), JSON.stringify({ manifest, diff: d }, null, 2));
    const html = renderDiffHtml(d, manifest);
    const out = opts.out ?? join(dir, `${manifest.runId}.diff.html`);
    writeFileSync(out, html);
    if (opts.json) ctx.out(JSON.stringify({ manifest, diff: d }, null, 2));
    else {
      ctx.out(renderDiff(d));
      ctx.out(`\nreport: ${out}\nrun ${manifest.runId} recorded (policy ${manifest.policyRevision})`);
    }
    return 0;
  } finally {
    store.close();
  }
}

export async function cmdGold(ctx: Ctx, corpusName: string, sub: string, opts: { policy?: string; port?: number; perStratum?: number; json?: boolean; redo?: string; rater?: string }) {
  const policyFile = policyFor(ctx, corpusName, opts.policy);
  const store = openStore(ctx.config.dbPath);
  let rules;
  try {
    rules = loadRules(store, { corpus: corpusName });
  } finally {
    store.close();
  }
  if (rules.length === 0) throw new Error(`no rules in the store for ${corpusName}: run polyx mine ${corpusName} first`);
  const perStratum = opts.perStratum ?? 12;
  if (sub === 'status') {
    const policy = loadPolicy(policyFile);
    const sample = sampleGold(rules, policy, perStratum);
    const goldFile = goldFileFor(policyFile);
    const p = progress(sample, readVerdicts(goldFile));
    if (opts.json) ctx.out(JSON.stringify({ goldFile, ...p }, null, 2));
    else {
      ctx.out(`gold alignment for ${policy.policy} v${policy.version} — ${p.rated} of ${p.sampled} pairs rated by ${p.raters.length || 'nobody'}${p.raters.length ? ` (${p.raters.join(', ')})` : ''}, ${p.doubleRated} rated by two people`);
      for (const [k, v] of Object.entries(p.byStratum)) ctx.out(`  ${k.padEnd(10)} ${v.rated}/${v.total}`);
      ctx.out(`file: ${goldFile}`);
      if (p.doubleRated === 0 && p.rated > 0) ctx.out('\nno pair has two raters yet: the inter-rater figure stays n/a, and the report says so');
    }
    return 0;
  }
  if (sub !== 'serve') throw new Error(`gold: unknown subcommand '${sub}' (serve | status)`);
  const only = opts.redo ? opts.redo.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
  if (only) {
    // Withdraw the pass being redone, keeping it on the record: a rating pass
    // that turned out to be misled is evidence about the instrument.
    const goldFile = goldFileFor(policyFile);
    const reason = `superseded: re-rated on the aligned comparison view${opts.rater ? ` (rater ${opts.rater})` : ''}`;
    const { kept, moved } = supersede(
      readVerdicts(goldFile),
      (v) => only.includes(String(v.stratum)) && (!opts.rater || v.rater === opts.rater),
      reason,
    );
    if (moved.length) {
      const policy = loadPolicy(policyFile);
      writeVerdicts(goldFile, kept, policy, [...readSuperseded(goldFile), ...moved]);
      ctx.out(`withdrew ${moved.length} verdict(s) in ${only.join(', ')} to the superseded list — kept in the file, out of the figures`);
    }
  }
  const o: Parameters<typeof startGoldServer>[0] = { rules, policyFile, perStratum };
  if (only) o.only = only;
  const cc = ctx.config.corpora[corpusName];
  if (cc) o.alphabet = loadAlphabet(cc.alphabet);
  if (opts.port !== undefined) o.port = opts.port;
  const srv = await startGoldServer(o);
  ctx.out(`gold alignment for ${corpusName} at ${srv.url} — ${srv.sample.length} pairs. Y same rule, N different, S skip. Ctrl-C to stop.`);
  ctx.out(`verdicts are written to ${goldFileFor(policyFile)} as you give them.`);
  await new Promise<void>((resolve) => process.once('SIGINT', () => srv.close().then(resolve, resolve)));
  return 0;
}

export async function main(argv: string[], io: { out?: (s: string) => void; err?: (s: string) => void; cwd?: string } = {}): Promise<number> {
  const out = io.out ?? ((s) => console.log(s));
  const err = io.err ?? ((s) => console.error(s));
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      threshold: { type: 'string', multiple: true },
      extractor: { type: 'string' },
      classifier: { type: 'string' },
      all: { type: 'boolean' },
      note: { type: 'string' },
      reviewer: { type: 'string' },
      condition: { type: 'string' },
      scope: { type: 'string' },
      port: { type: 'string' },
      policy: { type: 'string' },
      gold: { type: 'string' },
      sweep: { type: 'string' },
      'scope-by': { type: 'string' },
      'no-recommend': { type: 'boolean' },
      'assume-proposed': { type: 'boolean' },
      'per-stratum': { type: 'string' },
      redo: { type: 'string' },
      sample: { type: 'string' },
      rater: { type: 'string' },
      out: { type: 'string' },
      segmenter: { type: 'string' },
      alphabet: { type: 'string' },
      contracts: { type: 'string' },
      json: { type: 'boolean' },
      show: { type: 'string' },
      'dry-run': { type: 'boolean' },
      import: { type: 'string' },
      budget: { type: 'string' },
      concurrency: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    out(USAGE);
    return values.help ? 0 : 1;
  }
  const config = loadConfig(io.cwd ?? process.cwd(), values.config ?? undefined);
  const overrides: Record<string, number> = {};
  for (const kv of values.threshold ?? []) {
    const eq = kv.indexOf('=');
    const k = eq > 0 ? kv.slice(0, eq) : '';
    const v = eq > 0 ? kv.slice(eq + 1) : '';
    if (!k || v.trim() === '' || !Number.isFinite(Number(v))) throw new Error(`--threshold expects k=<number>, got '${kv}'`);
    overrides[k] = Number(v);
  }
  const thresholds = withThresholds({ ...config.thresholds, ...overrides });
  const ctx: Ctx = { config, thresholds, out, err };

  switch (command) {
    case 'audit': {
      const corpus = rest[0];
      if (!corpus) throw new Error('audit: which corpus?');
      corpusConfig(config, corpus);
      const opts: Parameters<typeof cmdAudit>[2] = {};
      if (values.json) opts.json = true;
      if (values.show) opts.show = values.show;
      if (values.alphabet) opts.alphabet = values.alphabet;
      if (values.segmenter) opts.segmenter = values.segmenter;
      return cmdAudit(ctx, corpus, opts);
    }
    case 'lens': {
      const corpus = rest[0];
      if (!corpus) throw new Error('lens: which corpus?');
      corpusConfig(config, corpus);
      const opts: Parameters<typeof cmdLens>[2] = {};
      if (values.json) opts.json = true;
      if (values.contracts) opts.contracts = values.contracts;
      if (values.alphabet) opts.alphabet = values.alphabet;
      if (values.segmenter) opts.segmenter = values.segmenter;
      return cmdLens(ctx, corpus, opts);
    }
    case 'alphabet': {
      const [sub, corpus, type] = rest;
      if (sub !== 'show' || !corpus || !type) throw new Error('usage: polyx alphabet show <corpus> <event-type>');
      const opts: { alphabet?: string } = {};
      if (values.alphabet) opts.alphabet = values.alphabet;
      return cmdAlphabetShow(ctx, corpus, type, opts);
    }
    case 'annotate': {
      const corpus = rest[0];
      if (!corpus) throw new Error('annotate: which corpus?');
      corpusConfig(config, corpus);
      const opts: Parameters<typeof cmdAnnotate>[2] = {};
      if (values['dry-run']) opts.dryRun = true;
      if (values.import) opts.importFile = values.import;
      if (values.json) opts.json = true;
      if (values.budget) opts.budget = Number(values.budget);
      if (values.concurrency) opts.concurrency = Number(values.concurrency);
      return cmdAnnotate(ctx, corpus, opts);
    }
    case 'calibrate': {
      const [corpus, id, sub] = rest;
      if (!corpus || !id) throw new Error('usage: polyx calibrate <corpus> <predicate-id> [sample|status|derive]');
      corpusConfig(config, corpus);
      const opts: Parameters<typeof cmdCalibrate>[4] = {};
      if (values.sample) opts.sample = Number(values.sample);
      if (values.reviewer) opts.reviewer = values.reviewer;
      if (values.port) opts.port = Number(values.port);
      return cmdCalibrate(ctx, corpus, id, sub ?? 'status', opts);
    }
    case 'predicates': {
      const corpus = rest[0];
      if (!corpus) throw new Error('predicates: which corpus?');
      corpusConfig(config, corpus);
      const opts: Parameters<typeof cmdPredicates>[2] = {};
      if (values.json) opts.json = true;
      if (values.show) opts.show = values.show;
      return cmdPredicates(ctx, corpus, opts);
    }
    case 'mine': {
      const corpus = rest[0];
      if (!corpus) throw new Error('mine: which corpus?');
      const opts: Parameters<typeof cmdMine>[2] = {};
      if (values.json) opts.json = true;
      if (values.all) opts.all = true;
      if (values.extractor) opts.extractor = values.extractor;
      if (values.classifier) opts.classifier = values.classifier;
      if (values.segmenter) opts.segmenter = values.segmenter;
      if (values['scope-by']) opts.scopeBy = values['scope-by'];
      if (values['no-recommend']) opts.recommend = false;
      return cmdMine(ctx, corpus, opts);
    }
    case 'review': {
      const [corpus, sub = 'list', ...args] = rest;
      if (!corpus) throw new Error('review: which corpus?');
      const opts: Parameters<typeof cmdReview>[3] = {};
      if (values.json) opts.json = true;
      if (values.all) opts.all = true;
      if (values.note) opts.note = values.note;
      if (values.reviewer) opts.reviewer = values.reviewer;
      if (values.condition) opts.condition = values.condition;
      if (values.scope) opts.scope = values.scope;
      if (values.port) opts.port = Number(values.port);
      if (values.sample) opts.sample = Number(values.sample);
      return cmdReview(ctx, corpus, [sub, ...args], opts);
    }
    case 'gold': {
      const corpus = rest[0];
      if (!corpus) throw new Error('gold: which corpus?');
      const opts: Parameters<typeof cmdGold>[3] = {};
      if (values.policy) opts.policy = values.policy;
      if (values.port) opts.port = Number(values.port);
      if (values['per-stratum']) opts.perStratum = Number(values['per-stratum']);
      if (values.redo) opts.redo = values.redo;
      if (values.rater) opts.rater = values.rater;
      if (values.json) opts.json = true;
      return cmdGold(ctx, corpus, rest[1] ?? 'serve', opts);
    }
    case 'evaluate': {
      const corpus = rest[0];
      if (!corpus) throw new Error('evaluate: which corpus?');
      const opts: Parameters<typeof cmdEvaluate>[2] = {};
      if (values.json) opts.json = true;
      if (values.policy) opts.policy = values.policy;
      if (values.gold) opts.gold = values.gold;
      if (values.sweep) opts.sweep = values.sweep;
      if (values['scope-by']) opts.scopeBy = values['scope-by'];
      return cmdEvaluate(ctx, corpus, opts);
    }
    case 'serve': {
      const corpus = rest[0];
      if (!corpus) throw new Error('serve: which corpus?');
      const cc = corpusConfig(config, corpus);
      // Only the alphabet, not the corpus: the advisor needs the declarations
      // (ACV §6.4) and has no use for the interactions.
      const alphabet = loadAlphabet(cc.alphabet);
      const recommendable = recommendableTypes(alphabet);
      // The live observation path (JT8.2): the corpus's predicate set and text
      // profile, and Jev if a key is configured — the null observer otherwise
      // (JT8.4). The corpus IS loaded here, once, for its revision: a
      // predicate calibrated against another revision is stale and inert.
      let observation: ServeOptions['observation'];
      const set = predicateSetFor(ctx, corpus);
      const profileFile = builtinTextProfile(alphabet.corpus);
      if (set && profileFile) {
        const loaded = await loadCorpus(config, corpus);
        observation = { observer: observerFromEnv(set.model, set.version), set, profile: loadTextProfile(profileFile), corpusRevision: loaded.revision, alphabetVersion: loaded.alphabet.version, ...(values.budget ? { budget: Number(values.budget) } : {}) };
      }
      const srv = await startAdvisorServer({ dbPath: config.dbPath, corpus, recommendable, ...(observation ? { observation } : {}), ...(values.port ? { port: Number(values.port) } : {}) });
      out(`advisor for ${corpus} at ${srv.url} — ${srv.advisor.served} rule(s) adjudicated real are served. POST /advise; GET /rules/<id>/evidence; GET /coverage. Ctrl-C to stop.`);
      if (srv.observer) out(`observer: ${observation!.observer.name} — ${srv.observer.active.length} real, calibrated predicate(s) will be asked when a request carries text${observation!.observer.name === 'null' ? ' (set POLYX_JEV_KEY to observe)' : ''}`);
      else out('observer: none — no predicate set or no text profile for this corpus; requests are answered over typed state only');
      if (srv.advisor.withheld) {
        out(`${srv.advisor.withheld} recommendation(s) adjudicated real are WITHHELD: their action is not recommendable in this alphabet (ACV 8.3). Re-mine to drop them from the store.`);
      }
      await new Promise<void>((resolve) => process.once('SIGINT', () => srv.close().then(resolve, resolve)));
      return 0;
    }
    case 'coverage': {
      const corpus = rest[0];
      if (!corpus) throw new Error('coverage: which corpus?');
      return cmdCoverage(ctx, corpus, { ...(values.json ? { json: true } : {}), ...(values['assume-proposed'] ? { assumeProposed: true } : {}), ...(values['scope-by'] ? { scopeBy: values['scope-by'] } : {}) });
    }
    case 'diff': {
      const corpus = rest[0];
      if (!corpus) throw new Error('diff: which corpus?');
      const opts: Parameters<typeof cmdDiff>[2] = {};
      if (values.json) opts.json = true;
      if (values.policy) opts.policy = values.policy;
      if (values.out) opts.out = values.out;
      return cmdDiff(ctx, corpus, opts);
    }
    default:
      err(`unknown command '${command}'\n${USAGE}`);
      return 1;
  }
}
