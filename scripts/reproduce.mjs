#!/usr/bin/env node
// The reproduction pass (TS §11, plan Phase 6 §6): a clean checkout must
// reproduce every headline figure. Runs audit → mine → evaluate → coverage
// (what-if) → diff for each corpus that is available on this machine, writes
// docs/results.json, and — when a committed docs/results.json exists —
// diffs the figures against it and exits non-zero on any change.
//
//   node scripts/reproduce.mjs            # compare with the committed figures
//   node scripts/reproduce.mjs --write    # (re)write docs/results.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const config = JSON.parse(readFileSync(join(root, 'polyx.config.json'), 'utf8'));
const bin = join(root, 'bin', 'polyx.mjs');
// Clause sets live outside this repository (src/config.ts, `policyRoot`), so a
// corpus with no reachable clause set is audited and mined but not evaluated —
// the same path a machine without that checkout has always taken for a corpus
// whose source is absent.
const configured = Array.isArray(config.policies) ? config.policies : typeof config.policies === 'string' ? [config.policies] : ['../polyx-bench/policies', '../polyx-eval/policies'];
const policyRoots = process.env.POLYX_POLICIES
  ? process.env.POLYX_POLICIES.split(/[;:](?![\\/])/).filter(Boolean).map((d) => join(process.cwd(), d))
  : configured.map((d) => join(root, d));
// `fixture:<path>` names a corpus or clause set shipped with polyx-lens, wherever
// the package installed — the same rule polyx-lens/src/config.ts applies.
const { fixturesDir } = await import('@cognitive-fab/polyx-lens');
const resolveSource = (p) => (p.startsWith('fixture:') ? join(fixturesDir(), p.slice('fixture:'.length)) : join(root, p));
const resolvePolicy = (p) => (p.startsWith('fixture:') ? resolveSource(p) : /[\\/]/.test(p) ? join(root, p) : (policyRoots.map((d) => join(d, p)).find((f) => existsSync(f)) ?? join(policyRoots[0], p)));

const run = (...args) => {
  const r = spawnSync(process.execPath, [bin, ...args, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  // 2 = unknown-rate gate tripped, 3 = falsified — both are results, not failures
  if (![0, 2, 3].includes(r.status)) throw new Error(`polyx ${args.join(' ')} failed (exit ${r.status}):\n${r.stderr}`);
  return JSON.parse(r.stdout);
};

const results = {};
for (const [name, c] of Object.entries(config.corpora)) {
  if (!existsSync(resolveSource(c.source))) {
    console.log(`skip ${name}: ${c.source} is not on this machine`);
    continue;
  }
  const hasPolicy =
    (config.corpora[name]?.policy ? existsSync(resolvePolicy(config.corpora[name].policy)) : false) ||
    policyRoots.some((d) => ['guidelines', 'policy'].some((k) => existsSync(join(d, `${name}-${k}.yaml`))));
  console.log(`reproduce ${name}${hasPolicy ? '' : ' (no policy: audit, mine, coverage only)'}`);
  const audit = run('audit', name).audit;
  const mine = run('mine', name);
  const entry = {
    corpusRevision: audit.corpusRevision,
    alphabetVersion: audit.alphabetVersion,
    interactions: audit.interactions,
    events: audit.events,
    unknownRate: audit.unknown.rate,
    rules: { proposed: mine.stats.proposed, refused: mine.stats.refused, suppressed: mine.stats.suppressed, contradicted: mine.stats.contradicted, recommendations: mine.stats.recommendations, decisionPoints: mine.stats.decisionPoints },
  };
  if (hasPolicy) {
    const ev = run('evaluate', name);
    entry.evaluation = {
      policyRevision: ev.policyRevision,
      clauses: ev.metrics.clauses,
      precision: { strict: ev.metrics.precision.strict.value, lenient: ev.metrics.precision.lenient.value, alignable: ev.metrics.precision.alignable.value },
      recall: { strict: ev.metrics.recall.strict.value, lenient: ev.metrics.recall.lenient.value },
      recallViolatedOnly: ev.controls ? { strict: ev.controls.recallViolatedOnly.strict.value, lenient: ev.controls.recallViolatedOnly.lenient.value, den: ev.controls.recallViolatedOnly.lenient.den } : null,
      refusalCorrectness: ev.metrics.refusalCorrectness.value,
      failedShare: ev.controls?.failedShare?.value ?? null,
      gate: ev.gate.verdict,
    };
    const d = run('diff', name).diff;
    entry.diff = d.counts;
  }
  const cov = run('coverage', name, '--assume-proposed').replay;
  entry.coverageCeiling = { coverage: cov.coverage, agreement: cov.agreement.value, outcomePrecision: cov.outcomePrecision.value, cleared: cov.cleared.value, warned: cov.warned.value };
  results[name] = entry;
}

const file = join(root, 'docs', 'results.json');
const prior = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { corpora: {} };
if (write || !existsSync(file)) {
  // MERGE, never replace. The loop above skips corpora that are not on this
  // machine, and `cc` in particular is private and gitignored — a wholesale
  // write from a checkout without it silently deletes committed figures, which
  // is the one way this file can start lying with nobody running anything.
  const kept = Object.keys(prior.corpora ?? {}).filter((n) => !(n in results));
  if (kept.length) console.log(`keeping committed figures for ${kept.join(', ')} — not on this machine`);
  const now = { generatedBy: 'scripts/reproduce.mjs', corpora: { ...(prior.corpora ?? {}), ...results } };
  writeFileSync(file, JSON.stringify(now, null, 2) + '\n');
  console.log(`wrote ${file}`);
  process.exit(0);
}
const committed = prior;
let diffs = 0;
const walk = (a, b, path) => {
  const scalar = (x) => x === null || typeof x !== 'object';
  if (typeof a !== typeof b || (scalar(a) || scalar(b) ? a !== b : false)) {
    console.log(`  ${path}: committed ${JSON.stringify(a)} → now ${JSON.stringify(b)}`);
    diffs++;
    return;
  }
  if (a && typeof a === 'object' && b && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
};
for (const name of Object.keys(results)) {
  if (!committed.corpora[name]) {
    console.log(`  ${name}: not in the committed figures`);
    continue;
  }
  walk(committed.corpora[name], results[name], name);
}
if (diffs) {
  console.log(`${diffs} figure(s) differ from docs/results.json — either the code changed the numbers (say so, and --write) or the reproduction failed`);
  process.exit(1);
}
console.log('every committed figure reproduced');
