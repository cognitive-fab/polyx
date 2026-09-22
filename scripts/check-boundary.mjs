#!/usr/bin/env node
// The answer-key boundary (TS §12, §14). Guidelines and policy clause sets are
// EVALUATION input and must be structurally unreachable from the thing being
// tested. This check fails the build if any module outside the evaluation
// side imports from src/evaluate/ or names a policies/guidelines path.
//
// Leaking the answer key into the miner is the single most likely way the
// evaluation quietly becomes worthless. Treat a failure here as a correctness
// bug, not hygiene: every number produced since the leak is suspect.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg >= 0 ? process.argv[rootArg + 1] : fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

// Only these may know that policies exist.
const ALLOWED = ['evaluate', 'diff', 'cli'];

const FORBIDDEN = [
  /from\s+['"][^'"]*\/evaluate\//,
  /import\s*\(\s*['"][^'"]*\/evaluate\//,
  /['"`][^'"`]*guidelines[^'"`]*['"`]/i,
  /['"`][^'"`]*\bpolicies\/[^'"`]*['"`]/,
  // a path assembled from pieces is still a path
  /['"`]policies['"`]\s*[,)\]]/,
  /['"`]evaluate['"`]\s*,/,
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|mjs|js)$/.test(name)) yield p;
  }
}

const failures = [];
const jevFailures = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const top = rel.split('/')[0];
  if (ALLOWED.includes(top)) continue;
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return;
    for (const re of FORBIDDEN) {
      if (re.test(line)) failures.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  });
}

// ---------------------------------------------------------------------------
// The observation boundary (JT1.1, JT1.2). A SEPARATE rule set, deliberately:
// it guards a different thing for a different reason, and folding it into the
// list above by widening ALLOWED would quietly weaken the answer-key check.
//
// Two claims are being kept true here.
//
//   JT1.1  The vendor is reachable from exactly one directory. Nothing else
//          may import a Jev symbol, name the `typesafe` package, or read the
//          key — so "swap the vendor and nothing above the port changes" is a
//          property of the tree rather than an intention.
//   JT1.2  The MINING path cannot call the model AT ALL. Not "does not":
//          cannot. Mining reads annotations from a frozen store, as data, like
//          the corpus. A Jev call is not bit-stable — identical inputs return
//          probabilities a quantum apart — so a call anywhere under src/mine/
//          would break byte-for-byte reproducibility outright rather than
//          bending it, and every figure mined since would be unreproducible.
const JEV_DIR = 'ports/jev';
const JEV_FORBIDDEN = [
  [/from\s+['"][^'"]*\/ports\/jev\//, 'imports the Jev adapter'],
  [/import\s*\(\s*['"][^'"]*\/ports\/jev\//, 'dynamically imports the Jev adapter'],
  [/from\s+['"]typesafe(\/|['"])/, 'imports the vendor package'],
  [/\bPOLYX_JEV_KEY\b|\bTYPESAFE_API_KEY\b/, 'reads the vendor API key'],
  [/\bapi\.typesafe\.ai\b/, 'names the vendor endpoint'],
];
// `cli` dispatches `polyx annotate` and so may name the directory; it may not
// reach past it into the vendor.
const JEV_ALLOWED_TOP = ['cli'];

// The port type itself is harmless everywhere except here: these three read
// recorded answers and must never be able to ask for a fresh one.
const NO_OBSERVER = ['mine', 'evaluate', 'diff'];
const OBSERVER_IMPORT = /\b(Observer|nullObserver)\b/;

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  const top = rel.split('/')[0];
  const inJevDir = rel.startsWith(JEV_DIR + '/');
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    const t = line.trimStart();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (!inJevDir && !JEV_ALLOWED_TOP.includes(top)) {
      for (const [re, what] of JEV_FORBIDDEN) {
        if (re.test(line)) jevFailures.push(`${rel}:${i + 1}: ${what} — ${t}`);
      }
    }
    if (NO_OBSERVER.includes(top) && /^\s*import\b/.test(t) && OBSERVER_IMPORT.test(line)) {
      jevFailures.push(`${rel}:${i + 1}: src/${top}/ imports the observation port — it must read annotations, never call the model — ${t}`);
    }
  });
}

if (failures.length) {
  console.error('BOUNDARY VIOLATION — the answer key is reachable from the mining side:');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
if (jevFailures.length) {
  console.error('BOUNDARY VIOLATION — the model is reachable from a path that must be reproducible offline:');
  for (const f of jevFailures) console.error('  ' + f);
  process.exit(1);
}
console.log(`boundary ok — no module outside src/{${ALLOWED.join(',')}} reaches evaluation input`);
console.log(`boundary ok — the vendor is reachable only from src/${JEV_DIR}/, and src/{${NO_OBSERVER.join(',')}}/ cannot call it`);
