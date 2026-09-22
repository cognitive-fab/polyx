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
// A re-run ADDS; it never deletes. Claude Code removes transcripts older
// than `cleanupPeriodDays` (30 by default), so the copy is soon the only one
// left: on 2026-09-22, 100 of the 141 sessions in the first cc corpus were
// already gone from ~/.claude/projects. The first version of this script
// deleted its output before copying, so re-running it as documented would
// have destroyed them. Now a session that disappeared from the source is
// kept, a session that grew is replaced by the longer copy, and a session
// whose live copy no longer starts with the corpus copy is left alone and
// reported — a transcript is append-only, so that is not one to overwrite.
//
// This corpus is PRIVATE. It is one person's own machine, it contains file
// paths, host names and shell commands, and it is never redistributed. See
// DATASETS.md.
//
// Usage: node corpora/link-cc.mjs [--root <dir>] [--out <dir>] [--dry-run]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
const dryRun = process.argv.includes('--dry-run');

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

// `--out` only ever holds what this script put there. Absent is fine, empty is
// fine, and a directory carrying the SOURCE.json this script writes is a
// previous run; anything else is refused. The first version deleted `--out`
// before this check existed, and `--out ~/code/polyx` took the repository.
let previous = {};
if (existsSync(out)) {
  const entries = readdirSync(out);
  if (entries.length && !existsSync(join(out, 'SOURCE.json'))) {
    console.error(`refusing to write into ${out}: not empty and not a previous link-cc output (no SOURCE.json)`);
    process.exit(1);
  }
  if (entries.length) previous = JSON.parse(readFileSync(join(out, 'SOURCE.json'), 'utf8'));
}
if (!dryRun) mkdirSync(out, { recursive: true });

const tally = { added: 0, grown: 0, unchanged: 0, diverged: 0, retained: 0, skipped: 0 };
const diverged = [];
let bytes = 0;
const live = new Set();

for (const project of readdirSync(root).sort()) {
  const dir = join(root, project);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
  for (const session of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const src = join(dir, session);
    let text;
    try {
      text = readFileSync(src, 'utf8');
    } catch {
      continue;
    }
    if (!hasToolUse(text)) {
      tally.skipped++;
      continue;
    }
    live.add(`${project}/${session}`);
    const dest = join(out, project, session);
    if (existsSync(dest)) {
      const kept = readFileSync(dest, 'utf8');
      if (kept === text) {
        tally.unchanged++;
        continue;
      }
      if (!text.startsWith(kept)) {
        tally.diverged++;
        diverged.push(`${project}/${session}`);
        continue;
      }
      tally.grown++;
    } else tally.added++;
    bytes += Buffer.byteLength(text);
    if (dryRun) continue;
    mkdirSync(join(out, project), { recursive: true });
    copyFileSync(src, dest);
  }
}

// What the corpus holds now: everything still here, whether or not the
// source still has it. A session only in the corpus is the one to protect.
let projects = 0;
let sessions = 0;
if (existsSync(out)) {
  for (const project of readdirSync(out).sort()) {
    const dir = join(out, project);
    if (!statSync(dir).isDirectory()) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    if (!files.length) continue;
    projects++;
    sessions += files.length;
    for (const s of files) if (!live.has(`${project}/${s}`)) tally.retained++;
  }
}
// A dry run wrote nothing, so the count is what the corpus would hold.
if (dryRun) sessions += tally.added;

const takenAt = new Date().toISOString();
if (!dryRun) {
  // A tiny register beside the corpus, so a reader of `.polyx` can tell where
  // the copy came from without guessing. The manifest hashes the files.
  // Earlier fields (a note on a merge, say) are kept, and every run appends
  // its tally, so the register is the corpus's history, not just its last run.
  const runs = Array.isArray(previous.runs) ? previous.runs : [];
  writeFileSync(
    join(out, 'SOURCE.json'),
    `${JSON.stringify({ ...previous, root, takenAt, projects, sessions, runs: [...runs, { at: takenAt, ...tally }] }, null, 2)}\n`,
  );
}

console.log(`${dryRun ? 'dry run, nothing written: ' : ''}${tally.added} session(s) added, ${tally.grown} grown, ${tally.unchanged} unchanged (${(bytes / 1e6).toFixed(1)} MB)`);
console.log(`${tally.retained} session(s) kept that are no longer in ${root} — the corpus is their only copy`);
if (diverged.length) {
  console.log(`${diverged.length} session(s) left as they were: the live copy no longer starts with the corpus copy`);
  for (const d of diverged.slice(0, 10)) console.log(`  ${d}`);
}
console.log(`skipped ${tally.skipped} session(s) with no tool call`);
console.log(`corpus at ${out}: ${sessions} session(s) across ${projects} project(s)`);

// The setting that decides how long the source keeps anything. Read from the
// settings file beside the transcript root, which is where Claude Code keeps
// it; unset means Claude Code's default of 30 days.
const settingsFile = join(dirname(root), 'settings.json');
let period = 30;
try {
  const s = JSON.parse(readFileSync(settingsFile, 'utf8'));
  if (Number.isFinite(s.cleanupPeriodDays)) period = s.cleanupPeriodDays;
} catch {
  // no settings file: the default applies
}
if (period <= 30) {
  console.log(
    `\nwarning: Claude Code deletes transcripts older than ${period} days (cleanupPeriodDays${existsSync(settingsFile) ? ` in ${settingsFile}` : ', its default'}).` +
      `\nRun this at least that often, or raise it — e.g. "cleanupPeriodDays": 365 in ~/.claude/settings.json.`,
  );
}
