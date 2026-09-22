#!/usr/bin/env node
// Generates the contact-window fixture corpus. Deterministic: same code, same
// bytes. Run `node test/fixtures/window/generate.mjs` and commit the output;
// the tests read window.json, never this script.
//
// WHY A SECOND ORACLE. The synthetic corpus cannot exercise the contact
// window's vacuity test: every `no-X-without-prior-Y` rule there is
// contradicted, subsumed or refused before the late loop runs, so the path
// never fires. This corpus is built for exactly that path, and for the one
// question the test has to answer — over WHICH window (TS §15, rev. 12).
//
// PLANTED STRUCTURE — ten contacts, two episodes each (segmented at each
// customer turn, so `before` and `sessionBefore` differ):
//
//   ep 1: refund_request, verify-identity, [lookup-order in 7 of 10]
//   ep 2: complaint,      issue-refund,    [lookup-order in 3 of 10, AFTER]
//
//   V  no issue-refund without a prior verify-identity   10/10 before it
//      → nothing could have violated it: suppressed, uninformative.
//   L  no issue-refund without a prior lookup-order       7/10 before it,
//      3/10 only after it
//      → proposed, with three counter-examples. Rev. 11's test, which read
//        the whole contact including what followed the subject, cannot tell
//        L from V and drops both.
//
// No action precedes issue-refund inside its own episode, so the
// episode-window pattern proposes nothing and neither rule is subsumed:
// both reach the late vacuity loop, which is the point.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const T0 = Date.UTC(2026, 1, 2, 9, 0, 0);
const CONTACTS = 10;
const LOOKUP_BEFORE = 7;

const customer = (intent, slots, text) => ({ speaker: 'customer', intent, slots, text });
const action = (button, slots = {}) => ({ speaker: 'action', button, slots });

const interactions = [];
for (let i = 0; i < CONTACTS; i++) {
  const before = i < LOOKUP_BEFORE;
  const turns = [
    customer('refund_request', { order_id: `ORD-2${String(i).padStart(3, '0')}` }, 'I would like a refund.'),
    action('verify-identity', { account_id: 'ACC-99887766' }),
    ...(before ? [action('lookup-order', { order_id: `ORD-2${String(i).padStart(3, '0')}` })] : []),
    customer('complaint', { account_id: 'ACC-99887766' }, 'And while you are here, this took far too long.'),
    action('issue-refund', { amount: 20 + i, order_id: `ORD-2${String(i).padStart(3, '0')}` }),
    ...(before ? [] : [action('lookup-order', { order_id: `ORD-2${String(i).padStart(3, '0')}` })]),
  ];
  interactions.push({
    id: `wnd-${String(i + 1).padStart(4, '0')}`,
    operator: 'op-alpha',
    team: 't-alpha',
    agent: 'a1',
    startedAt: T0 + i * 3600_000,
    outcome: 'resolved',
    turns,
  });
}

writeFileSync(join(here, 'window.json'), JSON.stringify({ corpus: 'synthetic', interactions }, null, 1) + '\n');
console.log(`wrote ${interactions.length} interactions, ${interactions.reduce((s, i) => s + i.turns.length, 0)} turns`);
