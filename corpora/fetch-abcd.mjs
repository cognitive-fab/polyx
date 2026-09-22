#!/usr/bin/env node
// Fetch ABCD (MIT — Chen et al., 2021, https://github.com/asappresearch/abcd)
// into corpora/abcd/. Nothing here is committed or redistributed; see
// DATASETS.md for the terms it is used under.
//
//   node corpora/fetch-abcd.mjs
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, 'abcd');
mkdirSync(dest, { recursive: true });

const BASE = 'https://github.com/asappresearch/abcd/raw/master/data/';
const FILES = [
  { name: 'abcd_v1.1.json', from: 'abcd_v1.1.json.gz', gunzip: true },
  { name: 'guidelines.json', from: 'guidelines.json' },
  { name: 'ontology.json', from: 'ontology.json' },
  { name: 'kb.json', from: 'kb.json' },
  { name: 'utterances.json', from: 'utterances.json' },
];

for (const f of FILES) {
  const path = join(dest, f.name);
  if (existsSync(path) && statSync(path).size > 0) {
    console.log(`have ${f.name}`);
    continue;
  }
  const url = BASE + f.from;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    continue;
  }
  const body = Readable.fromWeb(res.body);
  if (f.gunzip) await pipeline(body, createGunzip(), createWriteStream(path));
  else await pipeline(body, createWriteStream(path));
  console.log(`  wrote ${f.name} (${(statSync(path).size / 1e6).toFixed(1)} MB)`);
}
