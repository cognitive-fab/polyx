// The reviewer's surface: one rule per screen, both kinds of evidence, a
// verdict saved the moment it is given (F5.1, F5.2, F5.4).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cmdMine } from '../src/cli/main.ts';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { startReviewServer } from '../src/review/server.ts';
import { openStore } from '../src/store/db.ts';
import { loadRule, reviewPace } from '../src/store/rules.ts';
import { capture, tempWorkspace } from './helpers.ts';

test('review server: queue, rule view with contradicting evidence, adjudicate, pace', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  let srv: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  try {
    await cmdMine({ config: ws.config, thresholds: ws.thresholds, ...capture() }, 'synthetic', {});
    const corpus = await loadCorpus(ws.config, 'synthetic');
    srv = await startReviewServer({ dbPath: ws.config.dbPath, corpus });
    const get = async (p: string) => (await fetch(srv!.url.replace(/\/$/, '') + p)).json() as Promise<Record<string, unknown>>;

    const page = await (await fetch(srv.url)).text();
    assert.match(page, /polyx review/);
    assert.match(page, /Not real/);

    const q = (await get('/api/queue')) as { remaining: number; reviewed: number; queue: Array<{ id: string; scope: string }> };
    assert.equal(q.remaining, 13); // 7 obligations + 6 recommendations
    assert.equal(q.reviewed, 0);

    // the planted slip is the rule with one counter-example; find it
    const r1 = q.queue.find((r) => r.scope === 'op-alpha' && (loadRuleText(ws.config.dbPath, r.id, r.scope) ?? '').includes("verify the customer's identity") && (loadRuleText(ws.config.dbPath, r.id, r.scope) ?? '').startsWith('Before you issue a refund'))!;
    const v = (await get(`/api/rule?id=${r1.id}&scope=${r1.scope}`)) as { rule: { support: { holds: number; of: number } }; contradicting: Array<{ interactionId: string; events: Array<{ subject: boolean; guard: boolean; type: string }> }>; supporting: unknown[] };
    assert.deepEqual(v.rule.support, { holds: 13, of: 14 });
    assert.equal(v.contradicting.length, 1);
    assert.equal(v.contradicting[0]!.interactionId, 'syn-0008');
    assert.ok(v.contradicting[0]!.events.some((e) => e.subject && e.type === 'action:issue_refund'));
    assert.ok(!v.contradicting[0]!.events.some((e) => e.guard), 'no guard in the contradicting episode');
    assert.ok(v.supporting.length >= 1);

    // raw is behind an explicit request, and resolves to the source record
    const raw = (await get('/api/raw?interaction=syn-0008&seq=2')) as { raw: { path: string }; record: { button: string } };
    assert.equal(raw.raw.path, '/interactions/7/turns/2');
    assert.equal(raw.record.button, 'lookup-order');

    const post = async (body: unknown) =>
      (await fetch(srv!.url + 'api/adjudicate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
    assert.deepEqual(await post({ id: r1.id, scope: r1.scope, verdict: 'real', note: 'policy', reviewer: 'lead' }), { ok: true, status: 'real' });
    assert.match(String((await post({ id: r1.id, scope: r1.scope, verdict: 'maybe' })).error), /verdict must be/);
    assert.match(String((await post({ id: r1.id, scope: r1.scope, verdict: 'narrowed' })).error), /needs a condition/);

    const q2 = (await get('/api/queue')) as { remaining: number; reviewed: number };
    assert.equal(q2.remaining, 12);
    assert.equal(q2.reviewed, 1);
    const store = openStore(ws.config.dbPath);
    assert.equal(loadRule(store, r1.id, r1.scope)!.status, 'real');
    assert.equal(reviewPace(store).verdicts, 1);
    store.close();
  } finally {
    await srv?.close();
    ws.cleanup();
  }
});

function loadRuleText(dbPath: string, id: string, scope: string): string | undefined {
  const store = openStore(dbPath);
  try {
    return loadRule(store, id, scope)?.text;
  } finally {
    store.close();
  }
}
