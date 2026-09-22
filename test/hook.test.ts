// examples/claude-code-hook/polyx-hook.mjs, run as Claude Code would run it:
// a child process, the hook event on stdin, the verdict as an exit code. The
// advisor is a real server on loopback serving a planted rule against the
// shipped Claude Code sample transcripts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixturesDir, loadAlphabet, builtinAlphabet, recommendableTypes, type Rule } from 'polyx-lens';
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
