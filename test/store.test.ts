import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate, openStore, SCHEMA_VERSION } from '../src/store/db.ts';

test('an empty database migrates to the current schema, and again is a no-op', () => {
  const db = openStore(':memory:');
  const v = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert.equal(v(), SCHEMA_VERSION);
  migrate(db);
  assert.equal(v(), SCHEMA_VERSION);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  assert.deepEqual(tables, ['adjudications', 'contradictions', 'decision_points', 'evidence', 'rules', 'runs', 'sqlite_sequence']);
  db.close();
});

test('a database from a newer build is refused', () => {
  const db = openStore(':memory:');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 5}`);
  assert.throws(() => migrate(db), /this build knows/);
  db.close();
});
