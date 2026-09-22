#!/usr/bin/env node
// A Claude Code PreToolUse hook that asks polyx before a tool runs.
//
// Claude Code hands this script the session so far (`transcript_path`) and
// the tool it is about to call (`tool_name`, `tool_input`) on stdin. The hook
// types the session exactly as the corpus was typed — the same adapter, the
// same alphabet, the same segmenter — so that "the episode so far" here is
// the same object the rules were mined over. Then one POST per considered
// action, and the verdict decides:
//
//   warn       exit 2 — the tool does not run, and the model is told why,
//              in the rule's own words with its support
//   recommend  allow, and hand the recommendation to the model as context
//   clear      allow, silently
//   abstain    allow, silently; what would have resolved it is logged
//
// Nothing about polyx is imported into the agent's process. This script
// depends on polyx-lens (Apache-2.0) to type the transcript and on fetch to
// reach the advisor, which runs as its own process on loopback.
//
// It FAILS OPEN. A hook that blocked every tool when the advisor was down
// would be hostile, so an unreachable server allows the call and says so on
// stderr once. Set POLYX_HOOK_STRICT=1 to fail closed instead.
//
// Configuration, all optional:
//   POLYX_ADVISOR_URL   default http://127.0.0.1:7777
//   POLYX_ALPHABET      default: the alphabet.cc.yaml shipped with polyx-lens
//   POLYX_OPERATOR      default: the project the transcript belongs to
//   POLYX_HOOK_STRICT   1 to block when the advisor cannot be reached
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { applyAlphabet, builtinAlphabet, ccTextSource, loadAlphabet, projectOf, segmenterFor, toRaw } from 'polyx-lens';

const ADVISOR = (process.env.POLYX_ADVISOR_URL ?? 'http://127.0.0.1:7777').replace(/\/$/, '');
const STRICT = process.env.POLYX_HOOK_STRICT === '1';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * The events of the current episode, with the pending tool call typed the
 * way the adapter would have typed it after the fact.
 *
 * The pending call is appended to the transcript as one more assistant
 * record and the whole thing is run through `toRaw`, so the hook never
 * re-implements how a Bash command is split into segments or how a verb is
 * recognised. Whatever the adapter emits for the last record is what is
 * being considered; a Bash command with three segments is three
 * considerations.
 */
async function episodeSoFar(hook, alphabet) {
  const transcript = readFileSync(hook.transcript_path, 'utf8');
  const lines = transcript.split('\n');
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const pendingLine = lines.length;
  const pending = JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: { role: 'assistant', content: [{ type: 'tool_use', name: hook.tool_name, input: hook.tool_input ?? {} }] },
  });
  const project = process.env.POLYX_OPERATOR ?? projectOf(basename(dirname(hook.transcript_path)));
  const raw = toRaw([...lines, pending].join('\n'), hook.transcript_path, project);
  if (!raw) return { operator: project, before: [], considering: [] };
  const typed = applyAlphabet(alphabet, raw);
  // The same segmenter the corpus was mined under: an obligation is measured
  // "in the same episode", and the episode has to mean the same thing here.
  const segmenter = await segmenterFor('polyness');
  const local = await segmenter.segment(typed.events, { interactionId: raw.id });
  const isPending = (e) => e.raw.path === `/${pendingLine}` || e.raw.path.startsWith(`/${pendingLine}/`);
  const pendingEvents = typed.events.filter(isPending);
  const episode = pendingEvents.length ? local.get(pendingEvents[0].seq) : local.get(typed.events[typed.events.length - 1]?.seq);
  const before = typed.events.filter((e) => !isPending(e) && local.get(e.seq) === episode);
  // The one field observation needs (JT8.2): what was SAID at each event, as
  // the adapter's own text source reads it from the record the event points
  // at. The advisor redacts it under the corpus profile before anything sees
  // it; with no key on the server side it is simply ignored.
  const parsed = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  });
  const textOf = (e) => {
    const [, li, ...rest] = e.raw.path.split('/');
    let node = parsed[Number(li)] ?? null;
    for (const part of rest) {
      if (part === 'segment') return null; // a shell segment is an argument, not an utterance
      node = node == null ? null : Array.isArray(node) ? node[Number(part)] : node[part];
    }
    return node == null ? null : ccTextSource.text(node);
  };
  return {
    operator: typed.actor.operatorId,
    before: before.map((e) => {
      const text = textOf(e);
      return text ? { type: e.type, kind: e.kind, slots: e.slots, text } : { type: e.type, kind: e.kind, slots: e.slots };
    }),
    considering: pendingEvents.map((e) => e.type).filter((t) => t !== 'unknown'),
  };
}

async function advise(req) {
  const res = await fetch(`${ADVISOR}/advise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  if (!res.ok) throw new Error(`advisor ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const hook = await readStdin();
if (hook.hook_event_name && hook.hook_event_name !== 'PreToolUse') process.exit(0);
if (!hook.transcript_path || !hook.tool_name) process.exit(0);

const alphabet = loadAlphabet(process.env.POLYX_ALPHABET ?? builtinAlphabet('alphabet.cc.yaml'));
const { operator, before, considering } = await episodeSoFar(hook, alphabet);

// An action the alphabet does not know is not a decision point polyx can
// speak to. Allow it; the audit is where unknown actions get counted.
if (considering.length === 0) process.exit(0);

const warnings = [];
const recommendations = [];
const abstentions = [];
try {
  for (const action of considering) {
    const out = await advise({ operator, episode: { events: before }, considering: action });
    for (const w of out.warnings ?? []) warnings.push({ action, rule: w.rule, unsatisfied: w.unsatisfied });
    for (const a of out.actions ?? []) for (const r of a.rules) recommendations.push({ action: a.type, rule: r });
    if (out.abstention?.reason === 'unknown_fact') abstentions.push({ action, missing: out.abstention.missing });
  }
} catch (e) {
  const msg = `polyx: advisor unreachable at ${ADVISOR} (${e instanceof Error ? e.message : String(e)})`;
  if (STRICT) {
    console.error(`${msg} — POLYX_HOOK_STRICT is set, so the tool is blocked`);
    process.exit(2);
  }
  console.error(`${msg} — allowing the tool; set POLYX_HOOK_STRICT=1 to block instead`);
  process.exit(0);
}

if (warnings.length) {
  // Exit 2 blocks the tool and feeds stderr back to the model. The message
  // is the rule in its own words, with the number that backs it: not "you
  // may not", but "this held 41 of 47 times, and the thing it needs has not
  // happened yet".
  const lines = warnings.map((w) => `polyx: ${w.rule.text} (held ${w.rule.support}, ${w.rule.provenance}; ${w.unsatisfied} has not happened yet in this episode)`);
  console.error([...new Set(lines)].join('\n'));
  process.exit(2);
}

if (recommendations.length) {
  const context = [...new Set(recommendations.map((r) => `polyx recommends ${r.action}: ${r.rule.text} (${r.rule.support})`))].join('\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: context } }));
  process.exit(0);
}

// Cleared, uncovered, or abstained on an unknown fact: the tool runs. An
// abstention names what would have resolved it, which is worth a line in
// the log and nothing in the model's context.
if (abstentions.length && process.env.POLYX_HOOK_VERBOSE) {
  for (const a of abstentions) console.error(`polyx: abstained on ${a.action} — unknown: ${a.missing.join(', ')}`);
}
process.exit(0);
