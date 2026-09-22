// examples/jev-observation/README.md, run. Every command on that page goes
// through `main` here with the same arguments, and the numbers the page
// quotes are asserted — so the page cannot drift from the code without this
// going red. A walkthrough that has stopped being true is worse than none.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '@cognitive-fab/polyx-lens';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { main } from '../src/cli/main.ts';
import { tempWorkspace } from './helpers.ts';

const CORPUS = 'synthetic-observable';

/** A config file in the temp workspace, the way a reader's would be — `fixture:` sources and all. */
function configFile(ws: ReturnType<typeof tempWorkspace>): string {
  const file = join(ws.dir, 'polyx.config.json');
  writeFileSync(
    file,
    JSON.stringify({
      workspace: '.',
      seed: 1,
      corpora: {
        synthetic: { adapter: 'synthetic', source: 'fixture:synthetic/synthetic.json', alphabet: 'alphabet.synthetic.yaml' },
        [CORPUS]: { adapter: 'synthetic', source: `fixture:${CORPUS}/${CORPUS}.json`, alphabet: 'alphabet.synthetic.yaml' },
      },
    }),
  );
  return file;
}

/** As bin/polyx.mjs does it: a thrown error is printed and exits 1. */
async function run(ws: ReturnType<typeof tempWorkspace>, ...argv: string[]): Promise<{ code: number; text: string }> {
  const lines: string[] = [];
  try {
    const code = await main(['--config', configFile(ws), ...argv], { out: (s) => lines.push(s), err: (s) => lines.push(s), cwd: ws.dir });
    return { code, text: lines.join('\n') };
  } catch (e) {
    lines.push(e instanceof Error ? e.message : String(e));
    return { code: 1, text: lines.join('\n') };
  }
}

test('the walkthrough runs, and says what the page says', async () => {
  const ws = tempWorkspace();
  try {
    // 1. What is declared.
    const predicates = await run(ws, 'predicates', CORPUS);
    assert.equal(predicates.code, 0);
    assert.match(predicates.text, /real\s+states_double_charge/);
    assert.match(predicates.text, /declared 1, emitting 1, inert 0/);

    // 2. See what would leave the machine.
    const dry = await run(ws, 'annotate', CORPUS, '--dry-run');
    assert.equal(dry.code, 0);
    assert.match(dry.text, /13 distinct payload\(s\) over 30 site\(s\)/);
    assert.match(dry.text, /Nothing was sent/);
    const preview = readFileSync(join(ws.dir, 'annotations', `${CORPUS}.preview.jsonl`), 'utf8').trim().split('\n');
    assert.equal(preview.length, 13);
    const first = JSON.parse(preview[0]!) as { before: string; after: string; fired: Record<string, number> };
    assert.match(first.before, /ACC-55667788/);
    assert.doesNotMatch(first.after, /ACC-55667788/);
    assert.deepEqual(first.fired, { 'literal→account': 1 });

    // 3. Install the recorded answers.
    const committed = join(fixturesDir(), CORPUS, `${CORPUS}@1.jsonl`);
    const imported = await run(ws, 'annotate', CORPUS, '--import', committed);
    assert.equal(imported.code, 0, imported.text);
    assert.match(imported.text, /imported 30 recorded observation\(s\)/);
    assert.match(imported.text, /digest 39e93b226b4ac904/);
    assert.match(imported.text, /no call was made/);

    // 4. Mine.
    const mined = await run(ws, 'mine', CORPUS, '--threshold', 'minInstances=3');
    assert.equal(mined.code, 0, mined.text);
    assert.match(mined.text, /2f663a4cec907cc9\s+\[proposed\] op-alpha\s+5\/5/);
    assert.match(mined.text, /When obs\.states_double_charge = true, escalate to a supervisor\./);
    assert.match(mined.text, /observations: predicate set v1, annotation 39e93b226b4ac904 — 5 fact\(s\) at 10 site\(s\)/);

    // 5. Adjudicate.
    const marked = await run(ws, 'review', CORPUS, 'mark', '2f663a4cec907cc9', 'real', '--reviewer', 'jjd');
    assert.equal(marked.code, 0, marked.text);
    assert.match(marked.text, /\[real\]/);

    // 6. Replay.
    const cov = await run(ws, 'coverage', CORPUS);
    assert.equal(cov.code, 0, cov.text);
    assert.match(cov.text, /coverage\s+50\.0%\s+\(5 answered; 0 abstained as uncovered, 5 as unknown-fact\)/);
    assert.match(cov.text, /verdicts\s+recommend 5, abstain 5/);
    assert.match(cov.text, /agreement\s+100\.0%\s+\(5\/5/);
    assert.match(cov.text, /facts most often missing: obs\.states_double_charge \(5\)/);
    assert.match(cov.text, /answered\s+0 without observation, 5 because of it/);
    assert.match(cov.text, /yield\s+5 abstention\(s\) resolved, 0 warning\(s\) newly raised/);

    // …and without the file.
    const file = join(ws.dir, 'annotations', `${CORPUS}@1.jsonl`);
    renameSync(file, `${file}.aside`);
    const without = await run(ws, 'coverage', CORPUS);
    assert.equal(without.code, 0, without.text);
    assert.match(without.text, /coverage\s+0\.0%\s+\(0 answered; 0 abstained as uncovered, 10 as unknown-fact\)/);
    assert.match(without.text, /observation\s+none — replayed over typed state only/);
    renameSync(`${file}.aside`, file);
    assert.ok(existsSync(file));
  } finally {
    ws.cleanup();
  }
});

test('an import is checked, not trusted: the wrong version or the wrong corpus is refused', async () => {
  const ws = tempWorkspace();
  try {
    mkdirSync(join(ws.dir, 'annotations'), { recursive: true });
    const committed = readFileSync(join(fixturesDir(), CORPUS, `${CORPUS}@1.jsonl`), 'utf8');
    const wrongVersion = join(ws.dir, 'v2.jsonl');
    writeFileSync(wrongVersion, committed.replace(/"pv":1/g, '"pv":2'));
    const a = await run(ws, 'annotate', CORPUS, '--import', wrongVersion);
    assert.equal(a.code, 1);
    assert.match(a.text, /recorded under predicate set v2/);
    assert.match(a.text, /JF1\.4/);

    const wrongCorpus = join(ws.dir, 'other.jsonl');
    writeFileSync(wrongCorpus, committed.replace(/"i":"obs-/g, '"i":"elsewhere-'));
    const b = await run(ws, 'annotate', CORPUS, '--import', wrongCorpus);
    assert.equal(b.code, 1);
    assert.match(b.text, /recording is of a different corpus/);
  } finally {
    ws.cleanup();
  }
});

test('the README run block still resolves: the first command a reader types works on a fresh checkout', async () => {
  const ws = tempWorkspace();
  try {
    const r = await run(ws, 'audit', 'synthetic');
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /46 interactions, 366 events/);
  } finally {
    ws.cleanup();
  }
});

test('a larger calibration draw keeps every verdict already given', async () => {
  const ws = tempWorkspace();
  try {
    // The observable fixture has a real predicate; its corpus is small, so
    // draw 6 then 12. The first six of twelve are the same six.
    const first = await run(ws, 'calibrate', CORPUS, 'states_double_charge', 'sample', '--sample', '6');
    assert.equal(first.code, 0, first.text);
    const file = join(ws.dir, 'labels', `${CORPUS}.states_double_charge.yaml`);
    // Label three, as the page would.
    const lf = parseYaml(readFileSync(file, 'utf8')) as { items: Array<{ label?: boolean | null }> };
    lf.items[0]!.label = true;
    lf.items[1]!.label = false;
    lf.items[2]!.label = null;
    writeFileSync(file, stringifyYaml(lf));
    const before = await run(ws, 'calibrate', CORPUS, 'states_double_charge', 'status');
    assert.match(before.text, /3\/6 labelled/);
    const again = await run(ws, 'calibrate', CORPUS, 'states_double_charge', 'sample', '--sample', '12');
    assert.match(again.text, /3 already labelled, kept/);
    const after = await run(ws, 'calibrate', CORPUS, 'states_double_charge', 'status');
    assert.match(after.text, /3\/12 labelled \(1 true, 1 false, 1 unsure\)/);
  } finally {
    ws.cleanup();
  }
});
