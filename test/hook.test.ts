// examples/claude-code-hook/polyx-hook.mjs, run as Claude Code would run it:
// a child process, the hook event on stdin, the verdict as an exit code. The
// advisor is a real server on loopback serving a planted rule against the
// shipped Claude Code sample transcripts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixturesDir, loadAlphabet, builtinAlphabet, recommendableTypes, type Rule } from '@cognitive-fab/polyx-lens';
import { startAdvisorServer } from '../src/serve/http.ts';
import { openStore } from '../src/store/db.ts';
import { persistMined } from '../src/store/rules.ts';
import { ROOT, tempWorkspace } from './helpers.ts';

const HOOK = join(ROOT, 'examples', 'claude-code-hook', 'polyx-hook.mjs');
const TRANSCRIPT = join(fixturesDir(), 'sample', 'C--Users-sample-code-ledger-api', 'bbbb2222.jsonl');

/** "Before you push, run the tests" — real, for the ledger-api project. */
const PUSH_NEEDS_TESTS: Rule = {
  id: 'push-needs-tests',
  family: 'obligation',
  pattern: 'X-implies-prior-Y',
  bindings: { subject: 'action:git_push', guard: 'action:run_tests' },
  conditions: [],
  window: 'episode',
  support: { holds: 41, of: 47 },
  corpusSupport: { holds: 41, of: 47 },
  counterexamples: [],
  examples: [],
  provenance: { kind: 'own', level: 'operator', scope: 'ledger-api' },
  status: 'real',
  predicates: { js: '' },
  alphabetVersion: 1,
  minedAt: 0,
  text: 'Before you push, run the tests.',
  evidence: 'held 41 of 47 times',
  corpus: 'cc-sample',
  scope: 'ledger-api',
};

/**
 * Async, not spawnSync: the advisor server lives on THIS process's event
 * loop, and a synchronous spawn would block it while the child waited on it.
 */
function run(event: Record<string, unknown>, env: Record<string, string>): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--no-warnings', HOOK], { env: { ...process.env, ...env }, cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (status) => resolve({ status: status ?? -1, stdout, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

const event = (tool_name: string, tool_input: Record<string, unknown>) => ({ hook_event_name: 'PreToolUse', session_id: 'bbbb2222', transcript_path: TRANSCRIPT, tool_name, tool_input, cwd: '/tmp' });

test('the hook blocks a push that has not been preceded by a test run, in the rule\'s own words', async () => {
  const ws = tempWorkspace();
  const store = openStore(ws.config.dbPath);
  const manifest = { runId: 'r', command: 'mine', at: 0, corpus: 'cc-sample', corpusRevision: 'x', alphabetVersion: 1, alphabetFile: 'x', thresholds: ws.thresholds, seed: 1, codeCommit: null, segmenter: 'polyness' };
  // A rule row references its run, so the run has to exist first — as
  // recordRun writes it, minus loading a corpus this test does not need.
  store
    .prepare('INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(manifest.runId, manifest.command, manifest.at, manifest.corpus, manifest.corpusRevision, manifest.alphabetVersion, JSON.stringify(ws.thresholds), 1, null, JSON.stringify(manifest));
  persistMined(store, manifest, [PUSH_NEEDS_TESTS], [], ws.thresholds);
  store.close();
  const alphabet = loadAlphabet(builtinAlphabet('alphabet.cc.yaml')!);
  const srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'cc-sample', recommendable: recommendableTypes(alphabet) });
  try {
    assert.ok(alphabet.eventTypes.some((t) => t.id === 'action:git_push'), 'the alphabet types a push');
    const env = { POLYX_ADVISOR_URL: srv.url };

    // A push, cold: the guard has not happened in this episode → warn → exit 2.
    const push = await run(event('Bash', { command: 'git push origin main' }), env);
    assert.equal(push.status, 2, push.stderr);
    assert.match(push.stderr, /polyx: Before you push, run the tests\. \(held 41\/47, own@operator; action:run_tests has not happened yet in this episode\)/);

    // A read: no obligation on it, nothing recommended → allowed, silently.
    const read = await run(event('Read', { file_path: 'src/parser.ts' }), env);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.stdout, '');
    assert.equal(read.stderr, '');

    // A tool the alphabet does not know: not a decision point polyx can speak to.
    const odd = await run(event('SomeNewTool', { x: 1 }), env);
    assert.equal(odd.status, 0);
  } finally {
    await srv.close();
    ws.cleanup();
  }
});

/** "Before you edit a file, read it or write it whole — the same file" — the same-slot pattern, real for ledger-api. */
const EDIT_NEEDS_SAME_FILE: Rule = {
  ...PUSH_NEEDS_TESTS,
  id: 'edit-needs-same-file',
  pattern: 'no-X-without-prior-Y-same-S',
  bindings: { subject: 'action:edit_file', guards: 'action:read_file|action:write_file', slot: 'file' },
  window: 'interaction',
  support: { holds: 87, of: 94 },
  corpusSupport: { holds: 87, of: 94 },
  text: 'Before you edit a file, read a file or write a file whole — the same file, earlier in the contact.',
};

test('the same-file rule blocks an edit to a file the session never opened, and allows one it did', async () => {
  const ws = tempWorkspace();
  const store = openStore(ws.config.dbPath);
  const manifest = { runId: 'r', command: 'mine', at: 0, corpus: 'cc-sample', corpusRevision: 'x', alphabetVersion: 1, alphabetFile: 'x', thresholds: ws.thresholds, seed: 1, codeCommit: null, segmenter: 'polyness' };
  store
    .prepare('INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(manifest.runId, manifest.command, manifest.at, manifest.corpus, manifest.corpusRevision, manifest.alphabetVersion, JSON.stringify(ws.thresholds), 1, null, JSON.stringify(manifest));
  persistMined(store, manifest, [EDIT_NEEDS_SAME_FILE], [], ws.thresholds);
  store.close();
  const alphabet = loadAlphabet(builtinAlphabet('alphabet.cc.yaml')!);
  const srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'cc-sample', recommendable: recommendableTypes(alphabet) });
  try {
    const env = { POLYX_ADVISOR_URL: srv.url };
    // src/report.ts was read earlier in the session — in an earlier episode,
    // so this passes only because the hook sends the whole contact.
    const known = await run(event('Edit', { file_path: 'src/report.ts', old_string: 'a', new_string: 'b' }), env);
    assert.equal(known.status, 0, known.stderr);
    assert.equal(known.stderr, '');

    // A file nothing in the session read or wrote: the type-level rule would
    // be satisfied by the reads of other files; this one is not.
    const guess = await run(event('Edit', { file_path: 'src/never-opened.ts', old_string: 'a', new_string: 'b' }), env);
    assert.equal(guess.status, 2, guess.stderr);
    assert.match(
      guess.stderr,
      /polyx: Before you edit a file, read a file or write a file whole — the same file, earlier in the contact\. \(held 87\/94, own@operator; action:read_file or action:write_file on the same file has not happened yet in this session\)/,
    );

    // The allowed edit was CLEARED, not abstained on: without the contact the
    // advisor cannot see a read two prompts back, and says so rather than
    // guessing — which the hook would also have let through.
    const log = openStore(ws.config.dbPath);
    const verdicts = log.prepare("SELECT verdict FROM decision_points WHERE considering = 'action:edit_file' ORDER BY id").all().map((r) => (r as { verdict: string }).verdict);
    log.close();
    assert.deepEqual(verdicts, ['clear', 'warn']);
  } finally {
    await srv.close();
    ws.cleanup();
  }
});

test('a subagent is judged on its own transcript: an edit to the file it just wrote is not a guess', async () => {
  const ws = tempWorkspace();
  const home = mkdtempSync(join(tmpdir(), 'hook-subagent-'));
  const store = openStore(ws.config.dbPath);
  const manifest = { runId: 'r', command: 'mine', at: 0, corpus: 'cc-sample', corpusRevision: 'x', alphabetVersion: 1, alphabetFile: 'x', thresholds: ws.thresholds, seed: 1, codeCommit: null, segmenter: 'polyness' };
  store
    .prepare('INSERT INTO runs (id, command, at, corpus, corpus_revision, alphabet_version, thresholds_json, seed, code_commit, manifest_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(manifest.runId, manifest.command, manifest.at, manifest.corpus, manifest.corpusRevision, manifest.alphabetVersion, JSON.stringify(ws.thresholds), 1, null, JSON.stringify(manifest));
  persistMined(store, manifest, [EDIT_NEEDS_SAME_FILE], [], ws.thresholds);
  store.close();
  const alphabet = loadAlphabet(builtinAlphabet('alphabet.cc.yaml')!);
  const srv = await startAdvisorServer({ dbPath: ws.config.dbPath, corpus: 'cc-sample', recommendable: recommendableTypes(alphabet) });
  try {
    // The session's transcript, and beside it a subagent's, as Claude Code lays them out.
    const project = join(home, 'C--Users-sample-code-ledger-api');
    const agents = join(project, 'bbbb2222', 'subagents');
    mkdirSync(agents, { recursive: true });
    const main = join(project, 'bbbb2222.jsonl');
    copyFileSync(TRANSCRIPT, main);
    const rec = (o: object) => JSON.stringify({ sessionId: 'bbbb2222', promptId: 'p9', timestamp: '2026-05-04T10:00:00.000Z', ...o });
    const call = (id: string, name: string, input: object) => rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
    // The subagent writes a file nobody else has touched, and its next edit is
    // already recorded when the hook runs — which is how Claude Code writes it.
    writeFileSync(
      join(agents, 'agent-a2b213fe.jsonl'),
      [
        rec({ type: 'user', message: { role: 'user', content: 'write the inventory' } }),
        call('toolu_w', 'Write', { file_path: 'docs/inventory.md', content: 'x' }),
        rec({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_w', is_error: false }] } }),
        call('toolu_e', 'Edit', { file_path: 'docs/inventory.md', old_string: 'x', new_string: 'y' }),
      ].join('\n') + '\n',
    );
    const env = { POLYX_ADVISOR_URL: srv.url };
    const edit = (extra: Record<string, unknown>) => ({ hook_event_name: 'PreToolUse', session_id: 'bbbb2222', transcript_path: main, tool_name: 'Edit', tool_input: { file_path: 'docs/inventory.md', old_string: 'x', new_string: 'y' }, cwd: '/tmp', tool_use_id: 'toolu_e', ...extra });

    // Named by agent_id, and found by tool_use_id when it is not: both allowed.
    for (const extra of [{ agent_id: 'a2b213fe' }, {}]) {
      const r = await run(edit(extra), env);
      assert.equal(r.status, 0, `${JSON.stringify(extra)}: ${r.stderr}`);
    }
    // The same edit judged against the session's transcript — what the hook
    // did before — is refused: the session never saw the file.
    const blind = await run({ ...edit({}), tool_use_id: 'toolu_not_recorded' }, env);
    assert.equal(blind.status, 2, blind.stderr);

    const log = openStore(ws.config.dbPath);
    const verdicts = log.prepare("SELECT verdict FROM decision_points WHERE considering = 'action:edit_file' ORDER BY id").all().map((r) => (r as { verdict: string }).verdict);
    log.close();
    assert.deepEqual(verdicts, ['clear', 'clear', 'warn']);
  } finally {
    await srv.close();
    ws.cleanup();
    rmSync(home, { recursive: true, force: true });
  }
});

test('the hook fails open when the advisor is down, and closed when told to', async () => {
  const dead = { POLYX_ADVISOR_URL: 'http://127.0.0.1:1' };
  const open = await run(event('Bash', { command: 'git push' }), dead);
  assert.equal(open.status, 0);
  assert.match(open.stderr, /advisor unreachable/);
  assert.match(open.stderr, /allowing the tool/);
  const closed = await run(event('Bash', { command: 'git push' }), { ...dead, POLYX_HOOK_STRICT: '1' });
  assert.equal(closed.status, 2);
  assert.match(closed.stderr, /blocked/);
});

test('events the hook does not handle pass through untouched', async () => {
  const r = await run({ hook_event_name: 'PostToolUse', transcript_path: TRANSCRIPT, tool_name: 'Bash' }, {});
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
});
