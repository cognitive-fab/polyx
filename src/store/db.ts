// The store (TS §2). SQLite via node:sqlite. Rules, adjudications, evidence
// pointers and run metadata — derived artefacts only. A corpus stays on disk
// as files, and nothing here ever holds free text.
//
// Migrations are append-only and tracked in `user_version`. A database from
// an older build is upgraded in place; one from a newer build is refused.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  // v1 — Phase 0
  `
  CREATE TABLE runs (
    id               TEXT PRIMARY KEY,
    command          TEXT NOT NULL,
    at               INTEGER NOT NULL,
    corpus           TEXT NOT NULL,
    corpus_revision  TEXT NOT NULL,
    alphabet_version INTEGER NOT NULL,
    thresholds_json  TEXT NOT NULL,
    seed             INTEGER NOT NULL,
    code_commit      TEXT,
    manifest_json    TEXT NOT NULL
  );
  CREATE TABLE rules (
    id                  TEXT PRIMARY KEY,
    family              TEXT NOT NULL,
    pattern             TEXT NOT NULL,
    bindings_json       TEXT NOT NULL,
    conditions_json     TEXT NOT NULL,
    window              TEXT NOT NULL,
    text                TEXT NOT NULL,
    support_holds       INTEGER NOT NULL,
    support_of          INTEGER NOT NULL,
    counterexamples_json TEXT NOT NULL,
    examples_json       TEXT NOT NULL,
    provenance_json     TEXT NOT NULL,
    status              TEXT NOT NULL,
    predicate_js        TEXT NOT NULL,
    alphabet_version    INTEGER NOT NULL,
    mined_at            INTEGER NOT NULL,
    suppressed_by       TEXT,
    corpus              TEXT NOT NULL,
    scope               TEXT NOT NULL,
    run_id              TEXT NOT NULL REFERENCES runs(id),
    retired_reason      TEXT
  );
  CREATE INDEX rules_corpus_scope ON rules(corpus, scope);
  CREATE INDEX rules_status ON rules(status);
  CREATE TABLE adjudications (
    rule_id        TEXT NOT NULL,
    at             INTEGER NOT NULL,
    verdict        TEXT NOT NULL,
    note           TEXT,
    support_holds  INTEGER NOT NULL,
    support_of     INTEGER NOT NULL,
    reviewer       TEXT,
    PRIMARY KEY (rule_id, at)
  );
  CREATE TABLE evidence (
    rule_id        TEXT NOT NULL,
    interaction_id TEXT NOT NULL,
    episode_id     TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    holds          INTEGER NOT NULL,
    PRIMARY KEY (rule_id, interaction_id, seq)
  );
  `,
  // v2 — Phase 2: lifecycle columns, contradictions, narrowing
  `
  ALTER TABLE rules ADD COLUMN corpus_support_holds INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE rules ADD COLUMN corpus_support_of INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE rules ADD COLUMN evidence TEXT NOT NULL DEFAULT '';
  ALTER TABLE rules ADD COLUMN parent_id TEXT;
  ALTER TABLE rules ADD COLUMN reproposed_reason TEXT;
  CREATE TABLE contradictions (
    run_id   TEXT NOT NULL REFERENCES runs(id),
    rule_a   TEXT NOT NULL,
    rule_b   TEXT NOT NULL,
    reason   TEXT NOT NULL,
    PRIMARY KEY (run_id, rule_a, rule_b)
  );
  `,
  // v3 — Phase 2: a rule's IDENTITY is what it says (TS §7.5); a rule ROW is
  // that identity mined for one scope (operator), with its own support,
  // status and adjudications. Same rule, two operators, two rows (rev. 2).
  `
  CREATE TABLE rules_v3 (
    id                  TEXT NOT NULL,
    scope               TEXT NOT NULL,
    family              TEXT NOT NULL,
    pattern             TEXT NOT NULL,
    bindings_json       TEXT NOT NULL,
    conditions_json     TEXT NOT NULL,
    window              TEXT NOT NULL,
    text                TEXT NOT NULL,
    support_holds       INTEGER NOT NULL,
    support_of          INTEGER NOT NULL,
    corpus_support_holds INTEGER NOT NULL DEFAULT 0,
    corpus_support_of   INTEGER NOT NULL DEFAULT 0,
    counterexamples_json TEXT NOT NULL,
    examples_json       TEXT NOT NULL,
    provenance_json     TEXT NOT NULL,
    status              TEXT NOT NULL,
    predicate_js        TEXT NOT NULL,
    alphabet_version    INTEGER NOT NULL,
    mined_at            INTEGER NOT NULL,
    suppressed_by       TEXT,
    corpus              TEXT NOT NULL,
    run_id              TEXT NOT NULL REFERENCES runs(id),
    retired_reason      TEXT,
    evidence            TEXT NOT NULL DEFAULT '',
    parent_id           TEXT,
    reproposed_reason   TEXT,
    PRIMARY KEY (id, scope)
  );
  INSERT INTO rules_v3 SELECT id, scope, family, pattern, bindings_json, conditions_json, window, text, support_holds, support_of,
    corpus_support_holds, corpus_support_of, counterexamples_json, examples_json, provenance_json, status, predicate_js,
    alphabet_version, mined_at, suppressed_by, corpus, run_id, retired_reason, evidence, parent_id, reproposed_reason FROM rules;
  DROP TABLE rules;
  ALTER TABLE rules_v3 RENAME TO rules;
  CREATE INDEX rules_corpus_scope ON rules(corpus, scope);
  CREATE INDEX rules_status ON rules(status);
  CREATE TABLE adjudications_v3 (
    rule_id        TEXT NOT NULL,
    scope          TEXT NOT NULL,
    at             INTEGER NOT NULL,
    verdict        TEXT NOT NULL,
    note           TEXT,
    support_holds  INTEGER NOT NULL,
    support_of     INTEGER NOT NULL,
    reviewer       TEXT,
    PRIMARY KEY (rule_id, scope, at)
  );
  INSERT INTO adjudications_v3 SELECT a.rule_id, COALESCE((SELECT r.scope FROM rules r WHERE r.id = a.rule_id LIMIT 1), ''), a.at, a.verdict, a.note, a.support_holds, a.support_of, a.reviewer FROM adjudications a;
  DROP TABLE adjudications;
  ALTER TABLE adjudications_v3 RENAME TO adjudications;
  DROP TABLE evidence;
  CREATE TABLE evidence (
    rule_id        TEXT NOT NULL,
    scope          TEXT NOT NULL,
    interaction_id TEXT NOT NULL,
    episode_id     TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    holds          INTEGER NOT NULL,
    PRIMARY KEY (rule_id, scope, interaction_id, seq)
  );
  `,
  // v4 — Phase 5: recommendation outcomes; the advisor's decision-point log
  `
  ALTER TABLE rules ADD COLUMN outcome_holds INTEGER;
  ALTER TABLE rules ADD COLUMN outcome_of INTEGER;
  CREATE TABLE decision_points (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    operator    TEXT NOT NULL,
    considering TEXT,
    verdict     TEXT NOT NULL,
    reason      TEXT,
    missing_json TEXT,
    fired_json  TEXT NOT NULL,
    source      TEXT NOT NULL
  );
  CREATE INDEX decision_points_operator ON decision_points(operator, source);
  `,
  // v5 — the row key is (id, corpus, scope): the same rule mined for two
  // corpora that share an operator name (τ² retail under four backbones) is
  // two rows, not one overwriting the other (rev. 5).
  `
  CREATE TABLE rules_v5 (
    id                  TEXT NOT NULL,
    corpus              TEXT NOT NULL,
    scope               TEXT NOT NULL,
    family              TEXT NOT NULL,
    pattern             TEXT NOT NULL,
    bindings_json       TEXT NOT NULL,
    conditions_json     TEXT NOT NULL,
    window              TEXT NOT NULL,
    text                TEXT NOT NULL,
    support_holds       INTEGER NOT NULL,
    support_of          INTEGER NOT NULL,
    corpus_support_holds INTEGER NOT NULL DEFAULT 0,
    corpus_support_of   INTEGER NOT NULL DEFAULT 0,
    counterexamples_json TEXT NOT NULL,
    examples_json       TEXT NOT NULL,
    provenance_json     TEXT NOT NULL,
    status              TEXT NOT NULL,
    predicate_js        TEXT NOT NULL,
    alphabet_version    INTEGER NOT NULL,
    mined_at            INTEGER NOT NULL,
    suppressed_by       TEXT,
    run_id              TEXT NOT NULL REFERENCES runs(id),
    retired_reason      TEXT,
    evidence            TEXT NOT NULL DEFAULT '',
    parent_id           TEXT,
    reproposed_reason   TEXT,
    outcome_holds       INTEGER,
    outcome_of          INTEGER,
    PRIMARY KEY (id, corpus, scope)
  );
  INSERT INTO rules_v5 SELECT id, corpus, scope, family, pattern, bindings_json, conditions_json, window, text, support_holds, support_of,
    corpus_support_holds, corpus_support_of, counterexamples_json, examples_json, provenance_json, status, predicate_js,
    alphabet_version, mined_at, suppressed_by, run_id, retired_reason, evidence, parent_id, reproposed_reason, outcome_holds, outcome_of FROM rules;
  DROP TABLE rules;
  ALTER TABLE rules_v5 RENAME TO rules;
  CREATE INDEX rules_corpus_scope ON rules(corpus, scope);
  CREATE INDEX rules_status ON rules(status);
  CREATE TABLE adjudications_v5 (
    rule_id        TEXT NOT NULL,
    corpus         TEXT NOT NULL,
    scope          TEXT NOT NULL,
    at             INTEGER NOT NULL,
    verdict        TEXT NOT NULL,
    note           TEXT,
    support_holds  INTEGER NOT NULL,
    support_of     INTEGER NOT NULL,
    reviewer       TEXT,
    PRIMARY KEY (rule_id, corpus, scope, at)
  );
  INSERT INTO adjudications_v5 SELECT a.rule_id, COALESCE((SELECT r.corpus FROM rules r WHERE r.id = a.rule_id AND r.scope = a.scope LIMIT 1), ''), a.scope, a.at, a.verdict, a.note, a.support_holds, a.support_of, a.reviewer FROM adjudications a;
  DROP TABLE adjudications;
  ALTER TABLE adjudications_v5 RENAME TO adjudications;
  DROP TABLE evidence;
  CREATE TABLE evidence (
    rule_id        TEXT NOT NULL,
    corpus         TEXT NOT NULL,
    scope          TEXT NOT NULL,
    interaction_id TEXT NOT NULL,
    episode_id     TEXT NOT NULL,
    seq            INTEGER NOT NULL,
    holds          INTEGER NOT NULL,
    PRIMARY KEY (rule_id, corpus, scope, interaction_id, seq)
  );
  `,
  // v6 — a contradiction is between two rule ROWS of one operator
  `
  CREATE TABLE contradictions_v6 (
    run_id   TEXT NOT NULL REFERENCES runs(id),
    scope    TEXT NOT NULL,
    rule_a   TEXT NOT NULL,
    rule_b   TEXT NOT NULL,
    reason   TEXT NOT NULL,
    PRIMARY KEY (run_id, scope, rule_a, rule_b)
  );
  INSERT INTO contradictions_v6 SELECT run_id, '', rule_a, rule_b, reason FROM contradictions;
  DROP TABLE contradictions;
  ALTER TABLE contradictions_v6 RENAME TO contradictions;
  `,
  // v7 — observation on the decision log (JT8.3). Which observer answered,
  // and every observation with its p: the log becomes a growing annotation
  // file for live traffic, replayable later with no key. No text, ever.
  `
  ALTER TABLE decision_points ADD COLUMN observer TEXT;
  ALTER TABLE decision_points ADD COLUMN observations_json TEXT;
  `,
];

export type Store = DatabaseSync;

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`database is at schema v${current}; this build knows v${MIGRATIONS.length}`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
