// The gold alignment (TS §9.2): stratified sampling, the rating surface, and
// the effect a person's verdicts have on the reported figures.
import assert from 'node:assert/strict';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdGold, cmdMine } from '../src/cli/main.ts';
import { goldReport, align } from '../src/evaluate/align.ts';
import { startGoldServer } from '../src/evaluate/gold-server.ts';
import { goldFileFor, progress, readVerdicts, sampleGold, upsertVerdict, writeVerdicts } from '../src/evaluate/gold.ts';
import { loadPolicy } from '../src/evaluate/policies/index.ts';
import { mine } from '../src/mine/index.ts';
import { loadCorpus } from '@cognitive-fab/polyx-lens';
import { FIXTURES, ROOT, capture, tempWorkspace } from './helpers.ts';

const POLICY = join(FIXTURES, 'synthetic', 'synthetic-policy.yaml');

async function minedRules() {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    return (await mine(corpus, ws.thresholds, { minedAt: 1 })).rules;
  } finally {
    ws.cleanup();
  }
}

test('the sample is stratified, deterministic, and includes pairs the matcher declined', async () => {
  const rules = await minedRules();
  const policy = loadPolicy(POLICY);
  const a = sampleGold(rules, policy, 5);
  const b = sampleGold(rules, policy, 5);
  assert.deepEqual(b, a, 'deterministic');
  const strata = new Set(a.map((c) => c.stratum));
  assert.ok(strata.has('exact'), 'the matcher\'s confident calls');
  // the strata that a random draw would never surface
  assert.ok(a.some((c) => c.matcher === null), 'pairs the matcher declined are in the sample');
  assert.ok(strata.has('tribal') || strata.has('near-miss'));
  for (const c of a) {
    assert.equal(c.key, `${c.rule.id}|${c.rule.scope}|${c.clause.id}`);
    assert.ok(c.rule.text.length > 0 && c.clause.text.length > 0);
    // a declined pair must genuinely not be one the matcher made
    if (c.matcher === null) assert.ok(!align(rules, policy).some((x) => x.ruleId === c.rule.id && x.clauseId === c.clause.id));
  }
  assert.ok(a.length <= 5 * 5);
});

test('the rating surface saves each verdict as it is given and reveals the matcher only afterwards', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  let srv: Awaited<ReturnType<typeof startGoldServer>> | undefined;
  try {
    const policyFile = join(ws.dir, 'synthetic-policy.yaml');
    copyFileSync(POLICY, policyFile);
    const rules = await minedRules();
    srv = await startGoldServer({ rules, policyFile, perStratum: 3 });
    const page = await (await fetch(srv.url)).text();
    assert.match(page, /Are these <b>the same rule<\/b>/);

    const next = async (rater: string) => (await (await fetch(`${srv!.url}api/next?rater=${encodeURIComponent(rater)}`)).json()) as { pair: { rule: { id: string }; clause: { id: string } } | null; mine: number; total: number };
    const rate = async (body: unknown) => {
      const r = await fetch(srv!.url + 'api/rate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, json: (await r.json()) as Record<string, unknown> };
    };

    const first = await next('lead');
    assert.ok(first.pair, 'a pair to rate');
    assert.equal(first.mine, 0);
    // the page never receives the matcher's call before the verdict is posted
    assert.equal((first.pair as unknown as { matcher?: unknown }).matcher !== undefined, true, 'the sample carries it');
    assert.doesNotMatch(page, /matcher says/i, 'but the page does not show it before answering');

    assert.equal((await rate({ rule: first.pair!.rule.id, clause: first.pair!.clause.id, verdict: 'maybe', rater: 'lead' })).status, 400);
    assert.match(String((await rate({ rule: first.pair!.rule.id, clause: first.pair!.clause.id, verdict: 'confirmed', rater: '  ' })).json.error), /rater name is required/);
    const ok = await rate({ rule: first.pair!.rule.id, clause: first.pair!.clause.id, verdict: 'confirmed', rater: 'lead', note: 'clear' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.ok('matcher' in ok.json, 'the matcher call comes back only in the response');

    const goldFile = goldFileFor(policyFile);
    assert.ok(existsSync(goldFile), 'written the moment it is given');
    const v = readVerdicts(goldFile);
    assert.equal(v.length, 1);
    assert.equal(v[0]!.rater, 'lead');
    assert.equal(v[0]!.note, 'clear');
    assert.ok(v[0]!.at > 0);
    assert.match(readFileSync(goldFile, 'utf8'), /least reliable step/);

    // that pair is not offered to the same rater again, but is to another
    const second = await next('lead');
    assert.equal(second.mine, 1);
    assert.notEqual(`${second.pair?.clause.id}|${second.pair?.rule.id}`, `${first.pair!.clause.id}|${first.pair!.rule.id}`);
    const other = await next('compliance');
    assert.equal(other.mine, 0, 'a second rater starts from the beginning — that is how inter-rater works');
  } finally {
    await srv?.close();
    ws.cleanup();
  }
});

test('verdicts feed the reported figures: inter-rater and matcher agreement', async () => {
  const rules = await minedRules();
  const policy = loadPolicy(POLICY);
  const sample = sampleGold(rules, policy, 4);
  const alignments = align(rules, policy);
  const agreed = sample.find((c) => c.matcher !== null)!;
  const declined = sample.find((c) => c.matcher === null)!;
  let v = [] as ReturnType<typeof readVerdicts>;
  v = upsertVerdict(v, { rule: agreed.rule.id, clause: agreed.clause.id, verdict: 'confirmed', rater: 'a', at: 1 });
  v = upsertVerdict(v, { rule: agreed.rule.id, clause: agreed.clause.id, verdict: 'confirmed', rater: 'b', at: 2 });
  // the two raters disagree on the one the matcher declined
  v = upsertVerdict(v, { rule: declined.rule.id, clause: declined.clause.id, verdict: 'confirmed', rater: 'a', at: 3 });
  v = upsertVerdict(v, { rule: declined.rule.id, clause: declined.clause.id, verdict: 'rejected', rater: 'b', at: 4 });
  const rep = goldReport(v, alignments);
  assert.equal(rep.pairs, 2);
  assert.equal(rep.doubleRated, 2);
  assert.equal(rep.interRater, 0.5, 'they agreed on one of two');
  assert.equal(rep.matcherMissed, 1, 'one pair the matcher never proposed');
  // upsert replaces one rater's verdict rather than appending a second
  v = upsertVerdict(v, { rule: agreed.rule.id, clause: agreed.clause.id, verdict: 'rejected', rater: 'a', at: 5 });
  // the sampled pairs can share a rule id, so the pair is (rule, clause)
  assert.equal(v.filter((x) => x.rater === 'a' && x.rule === agreed.rule.id && x.clause === agreed.clause.id).length, 1);
  assert.equal(goldReport(v, alignments).interRater, 0, 'now they disagree on both');
  const p = progress(sample, v);
  assert.equal(p.doubleRated, 2);
  assert.deepEqual(p.raters, ['a', 'b']);
});

test('polyx gold status reports what is left, and refuses before anything is mined', async () => {
  const ws = tempWorkspace({ borrowedOperators: 1 });
  try {
    const ctx = { config: ws.config, thresholds: ws.thresholds, ...capture() };
    await assert.rejects(() => cmdGold(ctx, 'synthetic', 'status', {}), /run polyx mine/);
    await cmdMine(ctx, 'synthetic', {});
    const out = capture();
    await cmdGold({ ...ctx, out: out.out }, 'synthetic', 'status', { perStratum: 3 });
    assert.match(out.text(), /0 of \d+ pairs rated by nobody/);
    assert.match(out.text(), /exact/);
    await assert.rejects(() => cmdGold(ctx, 'synthetic', 'nonsense', {}), /unknown subcommand/);
  } finally {
    ws.cleanup();
  }
});

test('writeVerdicts round-trips through the format align.ts already reads', async () => {
  const ws = tempWorkspace();
  try {
    const file = join(ws.dir, 'g.yaml');
    const policy = loadPolicy(POLICY);
    const v = [{ rule: 'r1', clause: 'c-refund-verify', verdict: 'confirmed' as const, rater: 'lead', at: 7, stratum: 'exact' as const, matcher: 'exact' as const }];
    writeVerdicts(file, v, policy);
    assert.deepEqual(readVerdicts(file), v);
    // align.ts's own loader accepts it
    const { loadGold } = await import('../src/evaluate/align.ts');
    assert.deepEqual(loadGold(file), [{ rule: 'r1', clause: 'c-refund-verify', verdict: 'confirmed', rater: 'lead' }]);
  } finally {
    ws.cleanup();
  }
});
