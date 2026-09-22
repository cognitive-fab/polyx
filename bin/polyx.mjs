#!/usr/bin/env node
// Runs the TypeScript sources directly under Node's type stripping (Node ≥ 22.13
// with --experimental-strip-types, default on ≥ 23.6). `npm run build` emits
// dist/ for environments that want plain JS.
//
// node:sqlite is still flagged experimental; the warning is noise for a tool
// that has chosen it deliberately, so it is silenced here and nowhere else.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.error(w);
});

const { main } = await import('../src/cli/main.ts');
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
