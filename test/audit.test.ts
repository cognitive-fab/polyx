import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { audit, figureEvents, renderAudit } from 'polyx-lens';
import { cmdAudit } from '../src/cli/main.ts';
import { loadCorpus } from 'polyx-lens';
import { openStore } from '../src/store/db.ts';
import { capture, tempWorkspace } from './helpers.ts';

test('audit figures match the planted structure', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const a = audit(corpus, ws.thresholds);
    assert.equal(a.interactions, 46);
    assert.equal(a.events, 366);
    assert.equal(a.alphabetVersion, 2);
    assert.equal(a.segmenter, 'null');
    assert.equal(a.episodes.count, 46);
    assert.equal(a.episodes.perInteraction, 1);
    assert.equal(a.actors.operators, 2);
    assert.equal(a.actors.teams, 2);
    assert.equal(a.actors.agents, 3);
    assert.deepEqual(a.outcomes, { resolved: 41, escalated: 5 });
    // unknown tail: 2 mystery buttons + 2 telemetry pings
    assert.equal(a.unknown.count, 4);
    assert.equal(a.unknown.refused, false);
    assert.deepEqual(
      a.unknown.shapes.map((s) => s.features),
      ['button=mystery-button speaker=action', 'event=telemetry-ping speaker=system'],
    );
    // every consequential, non-free action with ≥5 instances is a subject
    const subjects = Object.fromEntries(a.subjects.map((s) => [s.type, s.count]));
    assert.deepEqual(subjects, {
      'action:apply_credit': 50,
      'action:reverse_credit': 50,
      'action:issue_refund': 20,
      'action:quote_rate': 16,
      'action:offer_credit': 5,
      'action:escalate': 5,
    });
    assert.deepEqual(a.belowFloor, []);
    assert.ok(!a.subjects.some((s) => s.type === 'action:add_note'), 'free actions are not subjects');
    assert.equal(a.nothingToSay, false);
    // every episode has a consequential action except none: each flow ends in one
    assert.equal(a.episodes.zeroConsequentialShare, 0);
    const text = renderAudit(a);
    assert.match(text, /46 interactions, 366 events/);
    assert.match(text, /unknown events: 4/);
  } finally {
    ws.cleanup();
  }
});

test('the audit says nothing when there is nothing to say', async () => {
  const ws = tempWorkspace({ minInstances: 100 });
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const a = audit(corpus, ws.thresholds);
    assert.equal(a.nothingToSay, true);
    assert.equal(a.subjects.length, 0);
    assert.equal(a.belowFloor.length, 6);
    assert.match(renderAudit(a), /Nothing to say: no consequential action occurs at least 100 times/);
  } finally {
    ws.cleanup();
  }
});

test('F1.2: an alphabet that leaves >20% unknown trips the gate and the CLI refuses', async () => {
  const ws = tempWorkspace();
  try {
    // a crippled alphabet: only refunds are known
    const crippled = join(ws.dir, 'crippled.yaml');
    writeFileSync(
      crippled,
      // v3, not v2: the real synthetic alphabet is v2 now, and two audits under
      // different alphabets must be distinguishable from their stamps alone (F2.2).
      `corpus: synthetic\nversion: 3\nevent_types:\n  - id: action:issue_refund\n    match: { speaker: action, button: issue-refund }\n    consequence: compensable\n`,
    );
    const io = capture();
    const code = await cmdAudit({ config: ws.config, thresholds: ws.thresholds, out: io.out, err: io.err }, 'synthetic', { alphabet: crippled });
    assert.equal(code, 2);
    assert.match(io.text(), /EXCEEDS THE 20.0% GATE/);
    assert.match(io.text(), /alphabet v3/);
    // the run is stamped with the alphabet version that produced it (F2.2)
    const store = openStore(ws.config.dbPath);
    const rows = (store.prepare('SELECT alphabet_version, command FROM runs').all() as Array<{ alphabet_version: number; command: string }>).map((r) => ({ ...r }));
    store.close();
    assert.deepEqual(rows, [{ alphabet_version: 3, command: 'audit' }]);
  } finally {
    ws.cleanup();
  }
});

test('every figure expands to records (--show)', async () => {
  const ws = tempWorkspace();
  try {
    const corpus = await loadCorpus(ws.config, 'synthetic');
    assert.equal(figureEvents(corpus, 'unknown').length, 4);
    assert.equal(figureEvents(corpus, 'type:action:issue_refund').length, 20);
    assert.equal(figureEvents(corpus, 'subject:action:quote_rate').length, 16);
    assert.equal(figureEvents(corpus, 'interaction:syn-0001').length, 8);
    const io = capture();
    await cmdAudit({ config: ws.config, thresholds: ws.thresholds, out: io.out, err: io.err }, 'synthetic', { show: 'unknown' });
    assert.match(io.text(), /mystery-button/);
    assert.match(io.text(), /\/interactions\/3\/turns\//);
  } finally {
    ws.cleanup();
  }
});
