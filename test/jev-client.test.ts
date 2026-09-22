// The Jev client and observer, against an injected fetch. No key, no
// network: what is pinned here is the wire shape the harness measured (A2),
// the backoff on 429/529, and that a whole battery rides one call.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Predicate } from '@cognitive-fab/polyx-lens';
import { JevClient, JevError, JEV_URL } from '../src/ports/jev/client.ts';
import { jevObserver, observerFromEnv } from '../src/ports/jev/observer.ts';

const PREDS: Predicate[] = [
  { id: 'a', fact: 'obs.a', status: 'real', quadrant: 'text-unknown', source: 'event.text', window: 'event', question: 'A?', criteria: { true: 'yes', false: 'no' }, bands: { assertAt: 0.85, refuteAt: -1 } },
  { id: 'b', fact: 'obs.b', status: 'real', quadrant: 'text-closed', source: 'event.text', window: 'event', question: 'B?', bands: { assertAt: 0.85, refuteAt: 0.15 } },
];

const reply = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('one call carries the whole battery keyed by predicate id, and answers come back under the same keys', async () => {
  const seen: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const fetchStub: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, auth: headers.get('authorization') });
    return reply({ model: 'jev-1.13.0', answers: { a: { type: 'noul', noul: 0.93, confidence: 0.9 }, b: { type: 'noul', noul: 0.04 } }, usage: { input_tokens: 120, output_tokens: 8 } });
  };
  const obs = jevObserver({ key: 'k', model: 'jev-latest', version: 3, fetch: fetchStub });
  const out = await obs.observe('some text', PREDS);

  assert.equal(seen.length, 1, 'a battery is one call');
  assert.equal(seen[0]!.url, JEV_URL);
  assert.equal(seen[0]!.auth, 'Bearer k');
  assert.deepEqual(seen[0]!.body, {
    state: 'some text',
    model: 'jev-latest',
    questions: { a: { type: 'noul', instructions: 'A?', criteria: { true: 'yes', false: 'no' } }, b: { type: 'noul', instructions: 'B?' } },
  });
  assert.deepEqual(out, [
    { predicate: 'a', fact: 'obs.a', value: true, p: 0.93, raw: { confidence: 0.9 }, model: 'jev-1.13.0' },
    { predicate: 'b', fact: 'obs.b', value: false, p: 0.04, model: 'jev-1.13.0' },
  ]);
  // `type` echoes the question and is not retained; the answering model is.
  assert.equal(obs.client.stats.inputTokens, 120);
  assert.equal(obs.name, 'jev:jev-latest');
  assert.equal(obs.version, 3);
});

test('whatever else an answer carries is retained verbatim, and nothing is retained when there is nothing (W0.3)', async () => {
  const fetchStub: typeof fetch = async () => reply({ answers: { a: { noul: 0.5, entropy: 0.71, foo: [1, 2] }, b: { noul: 0.5 } } });
  const out = await jevObserver({ key: 'k', model: 'm', version: 1, fetch: fetchStub }).observe('t', PREDS);
  assert.deepEqual(out[0]!.raw, { entropy: 0.71, foo: [1, 2] });
  assert.equal('raw' in out[1]!, false);
  assert.equal(out[0]!.value, null, 'p = 0.5 is in the withheld band');
});

test('429 and 529 back off and retry; anything else is an error with the body', async () => {
  let n = 0;
  const flaky: typeof fetch = async () => (n++ < 2 ? reply({ error: 'slow down' }, 429) : reply({ answers: { a: { noul: 0.9 } } }));
  const c = new JevClient({ key: 'k', fetch: flaky, retries: 4, baseDelayMs: 1 });
  const r = await c.ask({ state: 's', model: 'm', questions: { a: { type: 'noul', instructions: 'A?' } } });
  assert.equal(r.answers.a!.noul, 0.9);
  assert.equal(c.stats.retries, 2);
  assert.equal(c.stats.calls, 1, 'retries are not calls');

  const dead: typeof fetch = async () => reply({ error: 'still busy' }, 529);
  await assert.rejects(new JevClient({ key: 'k', fetch: dead, retries: 1, baseDelayMs: 1 }).ask({ state: 's', model: 'm', questions: {} }), (e: unknown) => e instanceof JevError && e.status === 529);

  const forbidden: typeof fetch = async () => reply({ error: 'bad key' }, 403);
  await assert.rejects(new JevClient({ key: 'k', fetch: forbidden }).ask({ state: 's', model: 'm', questions: {} }), /jev 403: .*bad key/);
});

test('a missing answer is a contract violation, not something to paper over', async () => {
  const fetchStub: typeof fetch = async () => reply({ answers: { a: { noul: 0.9 } } });
  await assert.rejects(jevObserver({ key: 'k', model: 'm', version: 1, fetch: fetchStub }).observe('t', PREDS), /no noul for 'b'/);
});

test('with no key the observer is the null one, by name (JT8.4)', () => {
  const o = observerFromEnv('jev-latest', 7, {});
  assert.equal(o.name, 'null');
  assert.equal(o.version, 7);
  assert.equal(observerFromEnv('jev-latest', 7, { POLYX_JEV_KEY: 'k' }).name, 'jev:jev-latest');
  assert.throws(() => new JevClient({ key: '' }), /use nullObserver/);
});
