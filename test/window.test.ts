// The contact window's vacuity test, against the fixture built for it
// (test/fixtures/window/). The synthetic oracle cannot reach this path: every
// `no-X-without-prior-Y` rule there is contradicted, subsumed or refused
// before the late loop runs. TS §7.2, §15 rev. 12.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, type Rule } from '@cognitive-fab/polyx-lens';
import { mine, type MineResult } from '../src/mine/index.ts';
import { VACUOUS_CONTACT } from '../src/mine/patterns.ts';
import { loadCorpus, registerSegmenter } from '@cognitive-fab/polyx-lens';
import { withThresholds } from '@cognitive-fab/polyx-lens';
import { FIXTURES, LOCAL_FIXTURES, ROOT, SYNTHETIC_ALPHABET } from './helpers.ts';

// One episode per customer turn, so `before` and `sessionBefore` differ — the
// null segmenter would make the two windows the same and test nothing.
registerSegmenter('window-per-intent', async () => ({
  name: 'window-per-intent',
  segment(events) {
    let n = -1;
    return new Map(
      events.map((e) => {
        if (e.kind === 'customer_intent' || e.kind === 'customer_utterance') n++;
        return [e.seq, String(Math.max(n, 0))];
      }),
    );
  },
}));

const find = (r: MineResult, pattern: string, guard: string): Rule | undefined =>
  r.rules.find((x) => x.pattern === pattern && x.bindings.subject === 'action:issue_refund' && x.bindings.guard === guard && x.conditions.length === 0);

async function mined() {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-window-'));
  const thresholds = withThresholds({ borrowedOperators: 1 });
  const config: Config = {
    root: ROOT,
    // The fixture clause set travels with the tests; the real answer keys do
    // not live in this repository at all (src/config.ts, `policyRoot`).
    policyRoots: [join(FIXTURES, 'synthetic')],
    workspace: dir,
    dbPath: join(dir, 'polyx.db'),
    corpora: {
      'synthetic-window': { adapter: 'synthetic', source: join(LOCAL_FIXTURES, 'window', 'window.json'), alphabet: SYNTHETIC_ALPHABET },
    },
    thresholds,
    segmenter: 'window-per-intent',
    seed: 1,
  };
  try {
    const corpus = await loadCorpus(config, 'synthetic-window');
    return await mine(corpus, thresholds, { minedAt: 1, recommend: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the fixture premise holds: nothing precedes the refund in its own episode, so no contact rule is subsumed', async () => {
  const result = await mined();
  const episodeRules = result.rules.filter((r) => r.pattern === 'X-implies-prior-Y' && r.bindings.subject === 'action:issue_refund');
  assert.deepEqual(episodeRules, [], 'no episode-window rule exists to subsume the contact-window ones');
  for (const r of result.rules.filter((x) => x.pattern === 'no-X-without-prior-Y')) {
    assert.ok(!r.suppressedBy?.startsWith('implied by'), `${r.bindings.guard} was subsumed, not left to the vacuity test`);
  }
});

test('a guard that always preceded the subject is uninformative and is suppressed', async () => {
  const result = await mined();
  const v = find(result, 'no-X-without-prior-Y', 'action:verify_identity')!;
  assert.ok(v, 'the verify-identity rule was mined');
  assert.deepEqual(v.support, { holds: 10, of: 10 });
  assert.equal(v.status, 'suppressed');
  assert.equal(v.suppressedBy, VACUOUS_CONTACT);
  assert.equal(v.counterexamples.length, 0);
});

test('a guard that followed the subject in three contacts is NOT vacuous — it is proposed with its counter-examples', async () => {
  const result = await mined();
  const l = find(result, 'no-X-without-prior-Y', 'action:lookup_order')!;
  assert.ok(l, 'the lookup-order rule was mined');
  // The regression: measured over the whole contact — events after the subject
  // included — this rule looks exactly like the verify-identity one above and
  // is dropped, along with three contacts that really did refund without a
  // prior lookup. Vacuity is measured over the window the rule is measured on.
  assert.deepEqual(l.support, { holds: 7, of: 10 });
  assert.equal(l.status, 'proposed');
  assert.equal(l.suppressedBy, undefined);
  assert.equal(l.window, 'interaction');
  assert.equal(l.counterexamples.length, 3);
  assert.deepEqual(
    l.counterexamples.map((c) => c.interactionId).sort(),
    ['wnd-0008', 'wnd-0009', 'wnd-0010'],
  );
});
