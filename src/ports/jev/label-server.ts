// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cognitive Fab LLC. This directory is licensed under the MIT
// License (see ./LICENSE), separately from the rest of polyx. See LICENSING.md.
//
// The calibration labelling surface (JF3.2, W3.1). One text per screen, one
// question, three keys, saved the moment it is given. The same shape as the
// gold-alignment surface, for the same reason it has that shape: a rater
// moving at speed anchors on whatever is on the screen, so the screen holds
// the text and the question and nothing else.
//
// In particular it never holds `p`. The model's answer is not in the label
// file until every item has a verdict, and this page reads the label file.
// A labeller shown 0.97 beside the text is being asked to agree, not to judge.
//
// "Unsure" is a first-class verdict, not a skip. It means the person could
// not answer the question from the text alone — and a question a person
// cannot answer from the text is one the model cannot answer from the text
// either. Enough of them on one predicate is the reviewer discovering its
// quadrant by hand (JF2.4), and `calibrate status` says so.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { progressOf, readLabelFile, writeLabelFile, type LabelFile } from './calibrate.ts';

export interface LabelServerOptions {
  labelFile: string;
  port?: number;
  host?: string;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function startLabelServer(opts: LabelServerOptions): Promise<{ port: number; url: string; server: Server; close: () => Promise<void> }> {
  const initial = readLabelFile(opts.labelFile);
  if (!initial) throw new Error(`no label file at ${opts.labelFile} — draw a sample first`);
  let lf: LabelFile = initial;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/next') {
        // Unlabelled first; then, if asked, the unsure ones for a second look.
        const revisit = url.searchParams.get('revisit') === 'unsure';
        const next = lf.items.find((i) => i.label === undefined) ?? (revisit ? lf.items.find((i) => i.label === null) : undefined);
        json(res, 200, {
          predicate: lf.predicate,
          question: lf.question,
          corpus: lf.corpus,
          labelFile: opts.labelFile,
          reviewer: lf.reviewer,
          progress: progressOf(lf),
          item: next ? { key: `${next.interactionId}|${next.seq}`, text: next.text, interactionId: next.interactionId, seq: next.seq } : null,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/label') {
        const b = await readJson(req);
        const reviewer = typeof b.reviewer === 'string' ? b.reviewer.trim() : '';
        if (!reviewer) {
          json(res, 400, { error: 'a reviewer name is required — the calibration record names who labelled it' });
          return;
        }
        if (b.label !== true && b.label !== false && b.label !== null) {
          json(res, 400, { error: 'label must be true, false, or null (unsure)' });
          return;
        }
        const i = lf.items.findIndex((x) => `${x.interactionId}|${x.seq}` === b.key);
        if (i < 0) {
          json(res, 404, { error: 'that item is not in the sample' });
          return;
        }
        const items = [...lf.items];
        items[i] = { ...items[i]!, label: b.label as boolean | null };
        lf = { ...lf, reviewer: lf.reviewer ?? reviewer, items };
        writeLabelFile(opts.labelFile, lf);
        json(res, 200, { ok: true, progress: progressOf(lf) });
        return;
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
  return {
    port,
    url: `http://${opts.host ?? '127.0.0.1'}:${port}/`,
    server,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>polyx calibrate</title>
<style>
  :root { --ink:#1b1b1b; --muted:#6b6b6b; --line:#e3e3e3; --ok:#1f7a3a; --bad:#b3261e; --dim:#5c6672; --bg:#fafaf8 }
  * { box-sizing:border-box }
  body { margin:0; font:15px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg) }
  header { display:flex; justify-content:space-between; align-items:baseline; padding:12px 24px; border-bottom:1px solid var(--line); background:#fff }
  main { max-width:760px; margin:0 auto; padding:28px 24px 140px }
  .muted { color:var(--muted); font-size:13px }
  .q { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 18px; margin:0 0 16px; font-size:17px; font-weight:600 }
  .q small { display:block; font-weight:400; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px }
  pre.text { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px 18px; margin:0 0 14px; white-space:pre-wrap; word-break:break-word; font:14px/1.55 ui-monospace,Menlo,Consolas,monospace; max-height:60vh; overflow:auto }
  .hint { text-align:center; color:var(--muted); font-size:13px; margin:14px 0 }
  footer { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line); padding:12px 24px; display:flex; gap:10px; justify-content:center; align-items:center; flex-wrap:wrap }
  button { padding:10px 20px; border-radius:6px; border:1px solid var(--line); background:#fff; font:inherit; cursor:pointer }
  button.yes { background:var(--ok); color:#fff; border-color:var(--ok) }
  button.no { background:var(--bad); color:#fff; border-color:var(--bad) }
  button.unsure { background:var(--dim); color:#fff; border-color:var(--dim) }
  input { padding:8px 10px; border:1px solid var(--line); border-radius:6px; font:inherit }
  kbd { font:11px monospace; border:1px solid rgba(255,255,255,.5); border-radius:3px; padding:0 4px; margin-left:6px }
  .done { text-align:center; padding:70px 0; color:var(--muted) }
  .done code { background:#fff; border:1px solid var(--line); padding:1px 6px; border-radius:4px }
</style>
<header>
  <div><strong>polyx calibrate</strong> <span class="muted" id="pred"></span></div>
  <div class="muted" id="progress"></div>
</header>
<main id="main"><div class="done">loading…</div></main>
<footer id="footer" hidden>
  <button class="yes" onclick="label(true)">Yes<kbd>Y</kbd></button>
  <button class="no" onclick="label(false)">No<kbd>N</kbd></button>
  <button class="unsure" onclick="label(null)">Can't tell from the text<kbd>U</kbd></button>
  <input type="text" id="reviewer" placeholder="your name" style="max-width:150px">
</footer>
<script>
let item = null, busy = false;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
try { $('#reviewer').value = localStorage.getItem('polyx.reviewer') || ''; } catch {}
$('#reviewer').addEventListener('change', () => { try { localStorage.setItem('polyx.reviewer', $('#reviewer').value); } catch {} });

async function load() {
  const r = await (await fetch('/api/next')).json();
  $('#pred').textContent = r.predicate + ' \\u00b7 ' + r.corpus;
  const p = r.progress;
  $('#progress').textContent = p.labelled + ' of ' + p.total + ' labelled \\u00b7 ' + p.trueN + ' yes, ' + p.falseN + ' no' + (p.unsure ? ', ' + p.unsure + " can't tell" : '');
  item = r.item;
  if (!item) {
    $('#footer').hidden = true;
    $('#main').innerHTML = '<div class="done">All ' + p.total + ' labelled. Saved to <code>' + esc(r.labelFile) + '</code>.' +
      (p.unsure ? '<p>' + p.unsure + " marked \\u201ccan\\u2019t tell from the text\\u201d. A question a person cannot answer from the text is one the model cannot answer from it either \\u2014 if that is many, re-read the question before deriving.</p>" : '') +
      '<p>Next: <code>polyx calibrate ' + esc(r.corpus) + ' ' + esc(r.predicate) + ' derive</code></p></div>';
    return;
  }
  $('#main').innerHTML =
    '<div class="q"><small>the question</small>' + esc(r.question) + '</div>' +
    '<pre class="text">' + esc(item.text) + '</pre>' +
    '<p class="hint">Answer from this text alone. If the text does not say, the answer is \\u201ccan\\u2019t tell\\u201d, not \\u201cno\\u201d.</p>';
  $('#footer').hidden = false;
  window.scrollTo(0, 0);
}
async function label(v) {
  if (!item || busy) return;
  if (!$('#reviewer').value.trim()) { alert('Put your name in the box first \\u2014 the calibration record names who labelled it.'); $('#reviewer').focus(); return; }
  busy = true;
  const r = await (await fetch('/api/label', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: item.key, label: v, reviewer: $('#reviewer').value }) })).json();
  busy = false;
  if (r.error) { alert(r.error); return; }
  load();
}
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'y') label(true); else if (k === 'n') label(false); else if (k === 'u') label(null);
});
load();
</script>
`;
