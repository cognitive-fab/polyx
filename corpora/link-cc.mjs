// Freeze a copy of the local Claude Code transcripts as a polyx corpus.
//
// The transcripts under ~/.claude/projects are live: every session you run
// appends to them, and a corpus that changes while you mine it cannot produce
// a reproducible figure. So this copies rather than links, and the copy is the
// corpus. Re-run it to take a new revision; the manifest records which one.
//
// Only sessions that contain at least one tool call are copied — a session
// with no actions contributes no events and would only inflate the interaction
// count. Nothing is rewritten: the files land byte-identical so that every
// `--show` pointer resolves into the real transcript.
//
// This corpus is PRIVATE. It is one person's own machine, it contains file
// paths, host names and shell commands, and it is never redistributed. See
// DATASETS.md.
//
// Usage: node corpora/link-cc.mjs [--root <dir>] [--out <dir>]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = arg('root', join(homedir(), '.claude', 'projects'));
const out = arg('out', join(here, 'cc'));

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`no transcript root at ${root} — pass --root`);
  process.exit(1);
}

/** A session is worth copying only if the agent actually did something in it. */
function hasToolUse(text) {
  for (const line of text.split('\n')) {
    if (!line || !line.includes('"tool_use"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const content = o?.message?.content;
    if (Array.isArray(content) && content.some((b) => b?.type === 'tool_use')) return true;
  }
  return false;
}

// `--out` is a path this script DELETES. It only ever owns a directory it
// created, so refuse anything else: absent is fine, empty is fine, and a
// directory carrying the SOURCE.json this script writes is a previous run.
// Without this, `--out ~/code/polyx` deleted the repository before the first
// check ran.
if (existsSync(out)) {
  const entries = readdirSync(out);
  if (entries.length && !existsSync(join(out, 'SOURCE.json'))) {
    console.error(`refusing to replace ${out}: not empty and not a previous link-cc output (no SOURCE.json)`);
    process.exit(1);
  }
  rmSync(out, { recursive: true, force: true });
}
mkdirSync(out, { recursive: true });

let projects = 0;
let copied = 0;
let skipped = 0;
let bytes = 0;

for (const project of readdirSync(root).sort()) {
  const dir = join(root, project);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
  const sessions = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  let kept = 0;
  for (const session of sessions) {
    const src = join(dir, session);
    let text;
    try {
      text = readFileSync(src, 'utf8');
    } catch {
      continue;
    }
    if (!hasToolUse(text)) {
      skipped++;
      continue;
    }
    if (kept === 0) mkdirSync(join(out, project), { recursive: true });
    copyFileSync(src, join(out, project, session));
    bytes += Buffer.byteLength(text);
    kept++;
    copied++;
  }
  if (kept > 0) projects++;
}

// A tiny register beside the corpus, so a reader of `.polyx` can tell where
// the copy came from without guessing. The manifest hashes the files.
writeFileSync(
  join(out, 'SOURCE.json'),
  `${JSON.stringify({ root, takenAt: new Date().toISOString(), projects, sessions: copied }, null, 2)}\n`,
);

console.log(`copied ${copied} sessions across ${projects} projects (${(bytes / 1e6).toFixed(1)} MB)`);
console.log(`skipped ${skipped} sessions with no tool call`);
console.log(`corpus at ${out}`);
