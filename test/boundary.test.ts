// TS §12: the answer key must be structurally unreachable from the miner. The
// check passes on this tree, and fails on a tree where mine/ imports policies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from './helpers.ts';

const SCRIPT = join(ROOT, 'scripts', 'check-boundary.mjs');

test('the repository passes the boundary check', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test('a miner that imports the policy set fails the boundary check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'mine'), { recursive: true });
    writeFileSync(join(dir, 'src', 'mine', 'cheat.ts'), "import { clauses } from '../evaluate/policies/abcd.ts';\nexport const x = clauses;\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /BOUNDARY VIOLATION/);
    assert.match(r.stderr, /mine\/cheat\.ts:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a miner that reads a guidelines file by name fails the boundary check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'mine'), { recursive: true });
    writeFileSync(join(dir, 'src', 'mine', 'peek.ts'), "export const f = 'corpora/abcd/guidelines.json';\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The observation boundary (JT1.1, JT1.2). Same discipline, different claim:
// the vendor must be reachable from one directory, and the mining path must
// not be able to reach it at all.

test('a module outside src/ports/jev/ that imports the Jev adapter fails the check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'serve'), { recursive: true });
    writeFileSync(join(dir, 'src', 'serve', 'leak.ts'), "import { jevObserver } from '../ports/jev/observer.ts';\nexport const o = jevObserver;\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reachable from a path that must be reproducible offline/);
    assert.match(r.stderr, /serve\/leak\.ts:1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reading the vendor key outside the port fails the check, even with nothing sent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'store'), { recursive: true });
    writeFileSync(join(dir, 'src', 'store', 'sneak.ts'), 'export const on = Boolean(process.env.POLYX_JEV_KEY);\n');
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /reads the vendor API key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the mining path may not import the observation port at all (JT1.2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'mine'), { recursive: true });
    // Not the adapter — the PORT. Mining reads recorded answers from the
    // annotation store; a live call there would end byte-for-byte
    // reproducibility, because the model is not bit-stable.
    writeFileSync(join(dir, 'src', 'mine', 'ask.ts'), "import { type Observer } from '@cognitive-fab/polyx-lens';\nexport type O = Observer;\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /must read annotations, never call the model/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Jev adapter itself may import the vendor — that is what the directory is for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-boundary-'));
  try {
    mkdirSync(join(dir, 'src', 'ports', 'jev'), { recursive: true });
    writeFileSync(join(dir, 'src', 'ports', 'jev', 'client.ts'), "const key = process.env.POLYX_JEV_KEY;\nexport const url = 'https://api.typesafe.ai/v1/systemone';\nexport const k = key;\n");
    const r = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
