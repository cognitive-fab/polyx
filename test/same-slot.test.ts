// The same-slot pattern: "read THIS file before you edit it", mined only
// where the alphabet declares the slot an identity, measured over the
// contact, with one guard set per subject however many operators found it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCorpus, parseAlphabet, type Event, type Interaction } from '@cognitive-fab/polyx-lens';
import { mine } from '../src/mine/index.ts';
import { subsumed } from '../src/mine/subsumption.ts';
import { contradictions } from '../src/mine/contradictions.ts';
import { tempWorkspace } from './helpers.ts';

const ALPHABET = (identity: boolean) =>
  parseAlphabet(
    'corpus: files\nversion: 1\nevent_types:\n' +
      ['read_file', 'edit_file', 'write_file']
        .map(
          (t, i) =>
            `  - id: action:${t}\n    match: { speaker: action, tool: T${i} }\n    consequence: ${t === 'read_file' ? 'none' : 'compensable'}\n    slots: [file]\n` +
            (identity ? '    identity: [file]\n' : ''),
        )
        .join(''),
  );

/** One contact: each step is its own episode, so the guard is always a prompt earlier than the edit. */
function contact(id: string, operatorId: string, steps: Array<[string, string]>): Interaction {
  const events: Event[] = steps.map(([type, file], seq) => ({
    seq,
    at: seq,
    episode: `${id}#${seq}`,
    kind: 'action',
    type: `action:${type}`,
    slots: { file },
    raw: { file: id, path: `/${seq}` },
  }));
  return { id, corpus: 'files', actor: { operatorId }, startedAt: Number(id.replace(/\D/g, '')), events };
}

async function mined(identity: boolean) {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const base = await loadCorpus(ws.config, 'synthetic');
    const interactions: Interaction[] = [];
    // An operator that reads before it edits — once, the wrong file.
    for (let n = 0; n < 6; n++) interactions.push(contact(`r${n}`, 'reader', [['read_file', `f${n}`], ['edit_file', `f${n}`]]));
    interactions.push(contact('r9', 'reader', [['read_file', 'other'], ['edit_file', 'f9']]));
    // One that writes a file whole and then edits it, and never reads.
    for (let n = 0; n < 6; n++) interactions.push(contact(`w${n}`, 'writer', [['write_file', `g${n}`], ['edit_file', `g${n}`]]));
    const corpus = { ...base, name: 'files', alphabet: ALPHABET(identity), interactions };
    return await mine(corpus, ws.thresholds, { minedAt: 1, recommend: false });
  } finally {
    ws.cleanup();
  }
}

test('same-slot rules are mined only where the alphabet declares an identity', async () => {
  const without = await mined(false);
  assert.equal(without.rules.filter((r) => r.pattern === 'no-X-without-prior-Y-same-S').length, 0);
});

test('one guard set per subject, the union of what each operator found, measured over the contact', async () => {
  const r = await mined(true);
  const same = r.rules.filter((x) => x.pattern === 'no-X-without-prior-Y-same-S' && x.conditions.length === 0);
  // The reader alone would propose "read it first" and the writer "write it
  // first"; scored at each other's operator the narrower one would imply the
  // wider out of the proposed set. There is one rule, with both.
  assert.deepEqual(new Set(same.map((x) => x.bindings.guards)), new Set(['action:read_file|action:write_file']));
  const at = (scope: string) => same.find((x) => x.scope === scope)!;
  assert.equal(at('reader').bindings.slot, 'file');
  assert.equal(at('reader').window, 'interaction');
  // Six of seven: the edit after reading a DIFFERENT file is the counterexample
  // the type-level rule cannot see.
  assert.deepEqual(at('reader').support, { holds: 6, of: 7 });
  assert.deepEqual(at('writer').support, { holds: 6, of: 6 });
  assert.equal(at('reader').text, 'Before you edit file, read file or write file — the same file, earlier in the contact.');
  assert.equal(at('reader').status, 'proposed');
});

test('a same-slot rule with one guard implies the type-level contact rule; a guard set implies nothing', () => {
  const base = { conditions: [], window: 'interaction' as const };
  const typeLevel = { ...base, id: 't', pattern: 'no-X-without-prior-Y', bindings: { subject: 'action:edit_file', guard: 'action:read_file' } };
  const one = { ...base, id: 's1', pattern: 'no-X-without-prior-Y-same-S', bindings: { subject: 'action:edit_file', guards: 'action:read_file', slot: 'file' } };
  const set = { ...base, id: 's2', pattern: 'no-X-without-prior-Y-same-S', bindings: { subject: 'action:edit_file', guards: 'action:read_file|action:write_file', slot: 'file' } };
  assert.deepEqual(subsumed([typeLevel, one]).get('t'), ['s1']);
  assert.equal(subsumed([typeLevel, set]).has('t'), false);
});

test('a same-slot precedence cycle is a contradiction only when both sides name one guard', () => {
  const r = (id: string, subject: string, guards: string) => ({ id, pattern: 'no-X-without-prior-Y-same-S', bindings: { subject, guards, slot: 'file' }, conditions: [], window: 'interaction' as const });
  assert.equal(contradictions([r('a', 'action:edit_file', 'action:write_file'), r('b', 'action:write_file', 'action:edit_file')], 'op').length, 1);
  assert.equal(contradictions([r('a', 'action:edit_file', 'action:read_file|action:write_file'), r('b', 'action:write_file', 'action:edit_file')], 'op').length, 0);
});
