#!/usr/bin/env node
// Two ways to run, and the file decides which.
//
// Installed from npm, `dist/` is present and this runs the compiled
// JavaScript: Node refuses to strip types from anything under node_modules,
// on purpose, so a published package has to ship plain JS. In a checkout,
// `dist/` is usually absent and the TypeScript sources run directly under
// Node's type stripping (unflagged from 22.18), which is why a change to a
// source file is live without a build step.
//
// node:sqlite is still flagged experimental; the warning is noise for a tool
// that has chosen it deliberately, so it is silenced here and nowhere else.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.error(w);
});

const built = new URL('../dist/src/cli/main.js', import.meta.url);
const { main } = await import(existsSync(fileURLToPath(built)) ? built.href : '../src/cli/main.ts');
// exitCode, not exit(): a large --json report on a piped stdout must drain.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
