// corpora/link-cc.mjs, run as the README says to run it: twice, the second
// time after Claude Code's retention has deleted a transcript from the source.
// The copy is then the only one left, and a re-run must keep it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.ts';

const SCRIPT = join(ROOT, 'corpora', 'link-cc.mjs');
const toolUse = (n: number) => `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `echo ${n}` } }] } })}\n`;
const chat = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } })}\n`;

function link(home: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', join(home, 'projects'), '--out', join(home, 'cc'), ...extra], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('a re-run adds and grows, and never deletes what the source has since lost', () => {
  const home = mkdtempSync(join(tmpdir(), 'link-cc-'));
  try {
    const p = join(home, 'projects', 'C--Users-x-code-demo');
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'old.jsonl'), toolUse(1));
    writeFileSync(join(p, 'grows.jsonl'), toolUse(2));
    writeFileSync(join(p, 'rewritten.jsonl'), toolUse(3));
    writeFileSync(join(p, 'chat-only.jsonl'), chat);

    const first = link(home);
    assert.match(first, /3 session\(s\) added/);
    assert.match(first, /skipped 1 session\(s\) with no tool call/);

    // Retention takes the oldest session; another grows; a third is rewritten
    // rather than appended to; a new one arrives.
    rmSync(join(p, 'old.jsonl'));
    appendFileSync(join(p, 'grows.jsonl'), toolUse(4));
    writeFileSync(join(p, 'rewritten.jsonl'), toolUse(99));
    writeFileSync(join(p, 'new.jsonl'), toolUse(5));

    // A dry run says so and writes nothing.
    const dry = link(home, '--dry-run');
    assert.match(dry, /dry run, nothing written: 1 session\(s\) added, 1 grown/);
    assert.ok(!existsSync(join(home, 'cc', 'C--Users-x-code-demo', 'new.jsonl')));

    const second = link(home);
    const cc = join(home, 'cc', 'C--Users-x-code-demo');
    assert.equal(readFileSync(join(cc, 'old.jsonl'), 'utf8'), toolUse(1), 'the session the source lost is still in the corpus');
    assert.equal(readFileSync(join(cc, 'grows.jsonl'), 'utf8'), toolUse(2) + toolUse(4), 'the longer copy replaced the shorter');
    assert.equal(readFileSync(join(cc, 'rewritten.jsonl'), 'utf8'), toolUse(3), 'a copy that is not an extension is never overwritten');
    assert.ok(existsSync(join(cc, 'new.jsonl')));
    assert.match(second, /1 session\(s\) added, 1 grown, 0 unchanged/);
    assert.match(second, /1 session\(s\) kept that are no longer in/);
    assert.match(second, /1 session\(s\) left as they were/);
    assert.match(second, /4 session\(s\) across 1 project/);

    // The register keeps its history: both runs, and anything written before them.
    const source = JSON.parse(readFileSync(join(home, 'cc', 'SOURCE.json'), 'utf8'));
    assert.equal(source.runs.length, 2);
    assert.deepEqual({ ...source.runs[1], at: undefined }, { at: undefined, added: 1, grown: 1, unchanged: 0, diverged: 1, retained: 1, skipped: 1 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('it warns when Claude Code will delete transcripts in 30 days or fewer, and not when it will not', () => {
  const home = mkdtempSync(join(tmpdir(), 'link-cc-'));
  try {
    mkdirSync(join(home, 'projects', 'C--Users-x-code-demo'), { recursive: true });
    assert.match(link(home), /deletes transcripts older than 30 days \(cleanupPeriodDays, its default\)/);
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 7 }));
    assert.match(link(home), /older than 7 days/);
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ cleanupPeriodDays: 365 }));
    assert.doesNotMatch(link(home), /warning/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('it still refuses to write into a directory it did not create', () => {
  const home = mkdtempSync(join(tmpdir(), 'link-cc-'));
  try {
    mkdirSync(join(home, 'projects'), { recursive: true });
    mkdirSync(join(home, 'cc'), { recursive: true });
    writeFileSync(join(home, 'cc', 'precious.txt'), 'not a corpus');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', join(home, 'projects'), '--out', join(home, 'cc')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /refusing to write into/);
    assert.equal(readFileSync(join(home, 'cc', 'precious.txt'), 'utf8'), 'not a corpus');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
