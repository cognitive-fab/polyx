#!/usr/bin/env node
// Gather the τ²-bench retail results files — one per backbone — into one
// directory, so `tau2-retail-all` can be mined with `--scope-by backbone`
// (FS §6.4: where does borrowed evidence land across backbones?).
//
//   git clone https://github.com/sierra-research/tau2-bench corpora/tau2-src
//   node corpora/link-tau2.mjs
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'tau2-src', 'data', 'tau2', 'results', 'final');
const dest = join(here, 'tau2', 'retail-all');
mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (!/_retail_(default|base)_/.test(f) || !f.endsWith('.json')) continue;
  copyFileSync(join(src, f), join(dest, f));
  n++;
  console.log('copied', f);
}
console.log(`${n} file(s) in ${dest}`);
