// F1.3: a corpus seeded with account numbers, emails and phone numbers produces
// zero occurrences in ANY stored artefact — checked by scanning the workspace
// files themselves (database, WAL, reports), not by unit-testing the redactor.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cmdAudit } from '../src/cli/main.ts';
import { openStore } from '../src/store/db.ts';
import { loadCorpus } from 'polyx-lens';
import { capture, FIXTURES, tempWorkspace } from './helpers.ts';

const seeded = (JSON.parse(readFileSync(join(FIXTURES, 'synthetic', 'seeded.json'), 'utf8')) as { identifiers: string[] }).identifiers;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

test('no seeded identifier reaches any stored artefact', async () => {
  const ws = tempWorkspace();
  try {
    const io = capture();
    const code = await cmdAudit({ config: ws.config, thresholds: ws.thresholds, out: io.out, err: io.err }, 'synthetic', { json: true });
    assert.equal(code, 0);
    // Also persist the canonical records themselves, so the scan covers what
    // later phases will store (evidence pointers, examples) — not only the audit.
    const corpus = await loadCorpus(ws.config, 'synthetic');
    const store = openStore(ws.config.dbPath);
    store.exec('CREATE TABLE IF NOT EXISTS scratch (id TEXT, json TEXT)');
    const ins = store.prepare('INSERT INTO scratch VALUES (?, ?)');
    for (const it of corpus.interactions) ins.run(it.id, JSON.stringify(it));
    store.close();

    const scanned = [...files(ws.dir)];
    assert.ok(scanned.some((f) => f.endsWith('polyx.db')), 'the database exists');
    assert.ok(scanned.some((f) => f.endsWith('.audit.json')), 'the audit report exists');
    const hits: string[] = [];
    for (const f of scanned) {
      const bytes = readFileSync(f);
      const text = bytes.toString('latin1');
      for (const id of seeded) if (text.includes(id)) hits.push(`${id} in ${f}`);
      // digits-only forms too — a phone number with separators stripped is still a phone number
      for (const id of seeded) {
        const digits = id.replace(/\D/g, '');
        if (digits.length >= 8 && text.includes(digits)) hits.push(`${digits} in ${f}`);
      }
    }
    assert.deepEqual(hits, []);
    // and the CLI output — which an analyst might paste anywhere
    for (const id of seeded) assert.ok(!io.text().includes(id), `${id} leaked to stdout`);
  } finally {
    ws.cleanup();
  }
});
