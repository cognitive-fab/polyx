#!/usr/bin/env node
// NOTICE is a build artefact (TS §6). Apache-2.0 requires the licence text,
// the NOTICE contents and marking of modifications for every Apache-2.0
// component polyx carries. This check fails the build when a known component
// is present without its attribution.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const notice = existsSync(join(ROOT, 'NOTICE')) ? readFileSync(join(ROOT, 'NOTICE'), 'utf8') : '';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const failures = [];
if (!notice.trim()) failures.push('NOTICE is missing or empty');

const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
const adapters = existsSync(join(ROOT, 'src', 'ports', 'polyness')) || existsSync(join(ROOT, 'src', 'adapters', 'polyness'));
if (('polyness' in deps || adapters) && !/polyness[\s\S]*Apache/i.test(notice)) {
  failures.push('polyness is present but NOTICE does not attribute it under Apache-2.0');
}
// The front half is a separate package under a separate licence. Apache-2.0
// wants attribution whether or not the dependency is ours, and this one is the
// dependency the licence split rests on: if it stops being attributed, the
// split has probably stopped being real too.
if ('@cognitive-fab/polyx-lens' in deps && !/polyx-lens[\s\S]*Apache/i.test(notice)) {
  failures.push('polyx-lens is a dependency but NOTICE does not attribute it under Apache-2.0');
}
if (!existsSync(join(ROOT, 'DATASETS.md'))) failures.push('DATASETS.md is missing');

// The licence is a build artefact too. A BUSL file with an unfilled parameter
// is worse than no licence: it reads as licensed and grants nothing. The
// parameters are the whole business model, so an empty one fails the build the
// same way a missing attribution does.
const licenseFile = join(ROOT, 'LICENSE');
if (!existsSync(licenseFile)) {
  failures.push('LICENSE is missing');
} else {
  const license = readFileSync(licenseFile, 'utf8');
  if (!/Business Source License 1\.1/.test(license)) failures.push('LICENSE is not BUSL 1.1');
  for (const p of ['Licensor', 'Licensed Work', 'Additional Use Grant', 'Change Date', 'Change License']) {
    const m = new RegExp(`^${p}:\\s*(\\S.*)$`, 'm').exec(license);
    if (!m) failures.push(`LICENSE parameter '${p}' is missing or empty`);
    else if (/TODO|TBD|FIXME|<[^>]+>/.test(m[1])) failures.push(`LICENSE parameter '${p}' is still a placeholder`);
  }
  if (pkg.license !== 'BUSL-1.1') failures.push(`package.json license is '${pkg.license}', not 'BUSL-1.1'`);
  if (!existsSync(join(ROOT, 'LICENSING.md'))) failures.push('LICENSING.md is missing');
}

// The MIT carve-out for the Jev adapter is a claim about a directory, and a
// claim about a directory is only true if every file in it says so. A file
// added there without the header would be BUSL by default — the opposite of
// what the directory promises — and the LICENSE parameter naming the
// exclusion has to stay in place or the carve-out is a NOTICE line and
// nothing more.
const jevDir = join(ROOT, 'src', 'ports', 'jev');
if (existsSync(jevDir)) {
  if (!existsSync(join(jevDir, 'LICENSE')) || !/MIT License/.test(readFileSync(join(jevDir, 'LICENSE'), 'utf8'))) {
    failures.push('src/ports/jev/LICENSE is missing or is not the MIT License');
  }
  for (const name of readdirSync(jevDir)) {
    if (!/\.(ts|mjs|js)$/.test(name)) continue;
    const head = readFileSync(join(jevDir, name), 'utf8').split(String.fromCharCode(10)).slice(0, 3).join(' ');
    if (!/SPDX-License-Identifier: MIT/.test(head)) failures.push(`src/ports/jev/${name} lacks the SPDX MIT header`);
  }
  if (existsSync(licenseFile) && !/excluding the directory\s+src\/ports\/jev\//.test(readFileSync(licenseFile, 'utf8'))) {
    failures.push("LICENSE's Licensed Work parameter does not exclude src/ports/jev/");
  }
  if (!/src\/ports\/jev[\s\S]*MIT/.test(notice)) failures.push('NOTICE does not state the MIT carve-out for src/ports/jev/');
}

if (failures.length) {
  for (const f of failures) console.error('NOTICE check: ' + f);
  process.exit(1);
}
console.log('notice ok');
