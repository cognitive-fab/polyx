// Adjudication persistence and the rule lifecycle (F5.2, F5.3, TS §7.6).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Rule } from '@cognitive-fab/polyx-lens';
import { cmdMine, cmdReview, recordRun } from '../src/cli/main.ts';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { openStore } from '../src/store/db.ts';
import { adjudicate, adjudicateEverywhere, adjudications, loadRule, loadRules, pendingNarrowings, persistMined, reviewPace } from '../src/store/rules.ts';
import { capture, tempWorkspace, type TempWorkspace } from './helpers.ts';

const R1 = (rules: Rule[]) =>
  rules.find((r) => r.scope === 'op-alpha' && r.pattern === 'X-implies-prior-Y' && r.bindings.subject === 'action:issue_refund' && r.bindings.guard === 'action:verify_identity' && r.conditions.length === 0)!;

async function mineInto(ws: TempWorkspace, mutate?: (rules: Rule[]) => Rule[]) {
  const corpus = await loadCorpus(ws.config, 'synthetic');
  const store = openStore(ws.config.dbPath);
  const ctx = { config: ws.config, thresholds: ws.thresholds, out: () => {}, err: () => {} };
  const manifest = recordRun(store, ctx, 'mine', corpus);
  const requested = pendingNarrowings(store, 'synthetic');
  const result = await mine(corpus, ws.thresholds, { minedAt: manifest.at, requested });
  const rules = mutate ? mutate(result.rules) : result.rules;
  const stats = persistMined(store, manifest, rules, result.contradictions, ws.thresholds);
  store.close();
  return { stats, rules };
}

test('a verdict persists across a re-mine, keyed on identity (F5.2)', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const first = await mineInto(ws);
    assert.equal(first.stats.inserted, first.rules.length);
    const id = R1(first.rules).id;
    let store = openStore(ws.config.dbPath);
    const marked = adjudicate(store, id, 'real', { note: 'yes, this is policy', reviewer: 'lead', scope: 'op-alpha', at: 1000 });
    assert.equal(marked.status, 'real');
    store.close();

    const second = await mineInto(ws);
    assert.equal(second.stats.inserted, 0);
    assert.equal(second.stats.kept, 1);
    store = openStore(ws.config.dbPath);
    const after = loadRule(store, id, 'op-alpha')!;
    assert.equal(after.status, 'real');
    assert.deepEqual(after.support, { holds: 13, of: 14 });
    const adj = adjudications(store, id, 'op-alpha');
    assert.equal(adj.length, 1);
    assert.equal(adj[0]!.note, 'yes, this is policy');
    assert.equal(adj[0]!.reviewer, 'lead');
    // the other scope of the same identity is untouched
    assert.equal(loadRule(store, id, 'op-beta')!.status, 'proposed');
    store.close();
  } finally {
    ws.cleanup();
  }
});

test('not_real is not re-proposed unless support moves ≥ δ, and then the reason is shown (F5.3)', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const first = await mineInto(ws);
    const id = R1(first.rules).id;
    let store = openStore(ws.config.dbPath);
    adjudicate(store, id, 'not_real', { scope: 'op-alpha', at: 1000 });
    store.close();

    // unchanged corpus: stays not_real
    const second = await mineInto(ws);
    assert.equal(second.stats.kept, 1);
    store = openStore(ws.config.dbPath);
    assert.equal(loadRule(store, id, 'op-alpha')!.status, 'not_real');
    assert.ok(!loadRules(store, { corpus: 'synthetic', status: ['proposed'] }).some((r) => r.id === id && r.scope === 'op-alpha'));
    store.close();

    // support moves a lot: re-proposed, with the reason
    const third = await mineInto(ws, (rules) =>
      rules.map((r) => (r.id === id && r.scope === 'op-alpha' ? { ...r, support: { holds: 7, of: 14 } } : r)),
    );
    assert.equal(third.stats.reproposed, 1);
    store = openStore(ws.config.dbPath);
    const re = loadRule(store, id, 'op-alpha')!;
    assert.equal(re.status, 'proposed');
    assert.match(re.reproposedReason!, /marked not real at 13\/14; support moved to 7\/14/);
    store.close();
  } finally {
    ws.cleanup();
  }
});

test('a real rule whose support falls below the floor is retired with its reason, and a vanished rule is retired too', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const first = await mineInto(ws);
    const id = R1(first.rules).id;
    let store = openStore(ws.config.dbPath);
    adjudicate(store, id, 'real', { scope: 'op-alpha' });
    const other = first.rules.find((r) => r.status === 'proposed' && r.scope === 'op-beta')!;
    adjudicate(store, other.id, 'real', { scope: 'op-beta' });
    store.close();

    const second = await mineInto(ws, (rules) =>
      rules
        .filter((r) => !(r.id === other.id && r.scope === 'op-beta'))
        .map((r) => (r.id === id && r.scope === 'op-alpha' ? { ...r, support: { holds: 2, of: 2 } } : r)),
    );
    assert.equal(second.stats.retired, 2);
    store = openStore(ws.config.dbPath);
    const a = loadRule(store, id, 'op-alpha')!;
    assert.equal(a.status, 'retired');
    assert.match(a.retiredReason!, /fell below the floor/);
    const b = loadRule(store, other.id, 'op-beta')!;
    assert.equal(b.status, 'retired');
    assert.match(b.retiredReason!, /not mined by run/);
    store.close();
  } finally {
    ws.cleanup();
  }
});

test('narrowed: the reviewer names a condition, the next mine emits the child linked to its parent', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const first = await mineInto(ws);
    const parent = R1(first.rules);
    let store = openStore(ws.config.dbPath);
    adjudicate(store, parent.id, 'narrowed', { scope: 'op-alpha', condition: { fact: 'episode.intent', op: 'eq', value: 'intent:refund_request' }, note: 'only for refund requests' });
    assert.equal(pendingNarrowings(store, 'synthetic').length, 1);
    store.close();

    const second = await mineInto(ws);
    store = openStore(ws.config.dbPath);
    const child = loadRules(store, { corpus: 'synthetic', scope: 'op-alpha' }).find((r) => r.parentId === parent.id)!;
    assert.ok(child, 'child rule exists');
    assert.deepEqual(child.conditions, [{ fact: 'episode.intent', op: 'eq', value: 'intent:refund_request' }]);
    assert.equal(child.status, 'proposed');
    assert.notEqual(child.id, parent.id);
    assert.match(child.text, /when episode\.intent = intent:refund_request/);
    assert.deepEqual(child.support, { holds: 13, of: 14 });
    assert.equal(loadRule(store, parent.id, 'op-alpha')!.status, 'narrowed');
    assert.ok(second.stats.inserted >= 1);
    store.close();
  } finally {
    ws.cleanup();
  }
});

test('the review CLI: list, show with both kinds of evidence, mark, pace', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await cmdMine(ctx, 'synthetic', {});
    const list = capture();
    await cmdReview({ ...ctx, out: list.out }, 'synthetic', ['list'], {});
    assert.match(list.text(), /awaiting adjudication/);
    assert.match(list.text(), /Before you issue a refund, verify the customer's identity/);
    const store = openStore(ws.config.dbPath);
    const id = R1(loadRules(store, { corpus: 'synthetic' })).id;
    store.close();

    const shown = capture();
    await cmdReview({ ...ctx, out: shown.out }, 'synthetic', ['show', id], { scope: 'op-alpha' });
    assert.match(shown.text(), /contradicting \(1 of 14; showing 1\)/);
    assert.match(shown.text(), /syn-0008/);
    assert.match(shown.text(), /supporting \(13 of 14/);
    assert.match(shown.text(), /predicate:/);

    const mark = capture();
    await cmdReview({ ...ctx, out: mark.out }, 'synthetic', ['mark', id, 'real'], { scope: 'op-alpha', reviewer: 'lead' });
    assert.match(mark.text(), /\[real\]/);
    await assert.rejects(() => cmdReview(ctx, 'synthetic', ['mark', id, 'maybe'], { scope: 'op-alpha' }), /verdict must be/);
    await assert.rejects(() => cmdReview(ctx, 'synthetic', ['mark', id, 'real'], {}), /say which with --scope/);

    const s2 = openStore(ws.config.dbPath);
    assert.equal(reviewPace(s2).verdicts, 1);
    assert.equal(reviewPace(s2).medianSeconds, null);
    s2.close();
  } finally {
    ws.cleanup();
  }
});

test('real everywhere: one verdict, recorded row by row at each row\'s own support, and nothing else touched', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    // One planted row that only BORROWS R1: proposed at an operator whose own
    // history breaks it — the shape that first shipped real at 0/21.
    const { rules } = await mineInto(ws, (rs) => [...rs, { ...R1(rs), scope: 'op-zeta', provenance: { kind: 'borrowed', foundIn: ['op-alpha'] }, support: { holds: 1, of: 20 }, corpusSupport: { holds: 1, of: 20 } }]);
    // A rule proposed for more than one operator, so "everywhere" means something.
    const byId = new Map<string, Rule[]>();
    for (const r of rules) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
    // …and, where the corpus has one, a row that only BORROWS it: proposed
    // because other operators keep the rule, while this one does not.
    const own = (rs: Rule[]) => rs.filter((r) => r.status === 'proposed' && r.provenance.kind === 'own');
    const candidates = [...byId].filter(([, rs]) => own(rs).length >= 2);
    const [id, rows] = candidates.find(([, rs]) => rs.some((r) => r.status === 'proposed' && r.provenance.kind === 'borrowed'))!;
    const proposed = own(rows).map((r) => r.scope).sort();
    const borrowed = rows.filter((r) => r.status === 'proposed' && r.provenance.kind === 'borrowed').map((r) => r.scope);
    const store = openStore(ws.config.dbPath);
    try {
      // A person already ruled on one row: that ruling stands.
      const ruled = proposed[0]!;
      adjudicate(store, id, 'not_real', { scope: ruled, corpus: 'synthetic', at: 1 });
      const { marked, skipped } = adjudicateEverywhere(store, id, 'real', { corpus: 'synthetic', reviewer: 'lead', at: 2 });
      assert.deepEqual(marked.map((r) => r.scope).sort(), proposed.slice(1));
      assert.ok(marked.every((r) => r.status === 'real'));
      assert.deepEqual({ ...skipped.find((s) => s.scope === ruled)!, support: undefined }, { scope: ruled, status: 'not_real', support: undefined });
      // A borrowed row is never marked: "everywhere" is every project whose own history keeps the rule.
      for (const scope of borrowed) assert.equal(skipped.find((s) => s.scope === scope)?.borrowed, true, scope);
      assert.equal(marked.length + skipped.length, rows.length, 'every row is either marked or named');
      // The trail is what separate marks would have left: one per row, at that row's support.
      for (const r of marked) {
        const a = adjudications(store, id, r.scope, 'synthetic').at(-1)!;
        assert.equal(a.verdict, 'real');
        assert.equal(a.reviewer, 'lead');
        assert.deepEqual(a.support, rows.find((x) => x.scope === r.scope)!.support);
      }
    } finally {
      store.close();
    }
    // One project or all of them — not both.
    await assert.rejects(cmdReview({ config: ws.config, thresholds: ws.thresholds, out: () => {}, err: () => {} }, 'synthetic', ['mark', id, 'real'], { everywhere: true, scope: 'op-alpha' }), /contradict each other/);
  } finally {
    ws.cleanup();
  }
});
