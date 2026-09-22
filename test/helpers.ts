// Shared test scaffolding: a throwaway workspace pointed at the fixture corpus.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alphabetsDir, fixturesDir, withThresholds, type Config, type Thresholds } from '@cognitive-fab/polyx-lens';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** The mining fixtures polyx authored — the corpus fixtures ship with the lens. */
export const LOCAL_FIXTURES = join(ROOT, 'test', 'fixtures');
/**
 * Corpus fixtures and alphabets live in polyx-lens, which owns the adapters
 * that read them and the typing that names them. Reading them from the package
 * rather than from a second copy is the point: two copies of a reviewed
 * artefact drift, and an alphabet that drifts silently changes every figure
 * derived from it.
 */
export const FIXTURES = fixturesDir();
export const SYNTHETIC_SOURCE = join(FIXTURES, 'synthetic', 'synthetic.json');
export const SYNTHETIC_ALPHABET = join(alphabetsDir(), 'alphabet.synthetic.yaml');

export interface TempWorkspace {
  dir: string;
  config: Config;
  thresholds: Thresholds;
  cleanup: () => void;
}

export function tempWorkspace(overrides: Partial<Thresholds> = {}): TempWorkspace {
  const dir = mkdtempSync(join(tmpdir(), 'polyx-'));
  const thresholds = withThresholds(overrides);
  const config: Config = {
    root: ROOT,
    // The fixture clause set travels with the tests; the real answer keys do
    // not live in this repository at all (src/config.ts, `policyRoot`).
    policyRoots: [join(FIXTURES, 'synthetic')],
    workspace: dir,
    dbPath: join(dir, 'polyx.db'),
    corpora: {
      synthetic: { adapter: 'synthetic', source: SYNTHETIC_SOURCE, alphabet: SYNTHETIC_ALPHABET },
      // The observable fixture (JT9.4): same family, same alphabet, one
      // planted rule that only an observed fact can express.
      'synthetic-observable': { adapter: 'synthetic', source: join(FIXTURES, 'synthetic-observable', 'synthetic-observable.json'), alphabet: SYNTHETIC_ALPHABET },
    },
    thresholds,
    segmenter: 'null',
    seed: 1,
  };
  return { dir, config, thresholds, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Collect output lines from a CLI invocation. */
export function capture() {
  const lines: string[] = [];
  const errs: string[] = [];
  return { lines, errs, out: (s: string) => lines.push(s), err: (s: string) => errs.push(s), text: () => lines.join('\n') };
}
