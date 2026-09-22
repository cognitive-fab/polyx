// Every number resolves to records (TS §1.3). A RawRef is a pointer into a
// source file on the analyst's disk; this module follows it. Nothing else in
// polyx reads source content after ingestion.
import { readFileSync } from 'node:fs';
import { type Event, type Interaction, type RawRef } from '@cognitive-fab/polyx-lens';
const cache = new Map<string, unknown>();

function loadFile(file: string): unknown {
  let doc = cache.get(file);
  if (doc === undefined) {
    const text = readFileSync(file, 'utf8');
    // A Claude Code session is JSONL, and its RawRefs point at `/<line>/…`.
    // Parse it as an array of lines so the same pointer syntax resolves; a
    // line that does not parse — a truncated tail — is null, exactly as the
    // adapter skipped it.
    if (/\.jsonl$/i.test(file)) {
      doc = text.split('\n').map((l) => {
        if (!l) return null;
        try {
          return JSON.parse(l) as unknown;
        } catch {
          return null;
        }
      });
    } else {
      doc = JSON.parse(text);
    }
    cache.set(file, doc);
  }
  return doc;
}

/** Follow a JSON-pointer-ish path ('/a/0/b') into a parsed document. */
export function resolvePointer(doc: unknown, path: string): unknown {
  if (path === '' || path === '/') return doc;
  let cur: unknown = doc;
  for (const part of path.split('/').slice(1)) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) cur = cur[Number(key)];
    else if (cur !== null && typeof cur === 'object') cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur;
}

export function resolveRaw(ref: RawRef): unknown {
  return resolvePointer(loadFile(ref.file), ref.path);
}

export interface Shown {
  interaction: string;
  seq: number;
  episode: string;
  type: string;
  kind: string;
  raw: RawRef;
  record: unknown;
}

/** Expand a set of events to their source records. */
export function show(pairs: Array<{ interaction: Interaction; event: Event }>, { resolve = true } = {}): Shown[] {
  return pairs.map(({ interaction, event }) => ({
    interaction: interaction.id,
    seq: event.seq,
    episode: event.episode,
    type: event.type,
    kind: event.kind,
    raw: event.raw,
    record: resolve ? resolveRaw(event.raw) : undefined,
  }));
}

export function renderShown(rows: Shown[]): string {
  if (rows.length === 0) return '(no records)';
  return rows
    .map((r) => `${r.interaction} #${r.seq} [${r.episode}] ${r.type} (${r.kind})\n  ${r.raw.file}${r.raw.path}\n  ${JSON.stringify(r.record)}`)
    .join('\n');
}
