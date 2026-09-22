// The gold-alignment surface (TS §9.2). One rule-and-clause pair per screen,
// three keys, saved the moment it is given. Lives under src/evaluate because
// it reads the answer key; the boundary check keeps it unreachable from the
// miner.
//
// The page shows the matcher's own call ONLY AFTER the rater has answered.
// Showing it first would anchor the rater on the thing being scored, and the
// whole point of the exercise is an independent judgement.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Alphabet, type Rule } from '@cognitive-fab/polyx-lens';
import { loadPolicy, type Policy } from './policies/index.ts';
import { goldFileFor, progress, readSuperseded, readVerdicts, sampleGold, upsertVerdict, writeVerdicts, type GoldCandidate, type GoldVerdict } from './gold.ts';
export interface GoldServerOptions {
  rules: Rule[];
  policyFile: string;
  perStratum?: number;
  port?: number;
  host?: string;
  /** Renders both sides of a pair in one vocabulary — without it the two sides use different notation. */
  alphabet?: Alphabet;
  /** Serve only these strata, for re-rating a pass the surface misled. */
  only?: string[];
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

export async function startGoldServer(opts: GoldServerOptions): Promise<{ port: number; url: string; server: Server; sample: GoldCandidate[]; close: () => Promise<void> }> {
  const policy: Policy = loadPolicy(opts.policyFile);
  const all = sampleGold(opts.rules, policy, opts.perStratum ?? 12, opts.alphabet);
  const sample = opts.only?.length ? all.filter((c) => opts.only!.includes(c.stratum)) : all;
  const goldFile = goldFileFor(opts.policyFile);
  let verdicts = readVerdicts(goldFile);
  const superseded = readSuperseded(goldFile);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/next') {
        const rater = url.searchParams.get('rater') ?? '';
        const mine = new Set(verdicts.filter((v) => v.rater === rater).map((v) => `${v.rule}|${v.clause}`));
        const remaining = sample.filter((c) => !mine.has(`${c.rule.id}|${c.clause.id}`));
        json(res, 200, {
          policy: `${policy.policy} v${policy.version}`,
          goldFile,
          progress: progress(sample, verdicts),
          mine: sample.length - remaining.length,
          total: sample.length,
          pair: remaining[0] ?? null,
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rate') {
        const b = await readJson(req);
        const rater = typeof b.rater === 'string' ? b.rater.trim() : '';
        if (!rater) {
          json(res, 400, { error: 'a rater name is required — the inter-rater figure needs to know who said what' });
          return;
        }
        if (b.verdict !== 'confirmed' && b.verdict !== 'rejected') {
          json(res, 400, { error: 'verdict must be confirmed | rejected' });
          return;
        }
        const pair = sample.find((c) => c.rule.id === b.rule && c.clause.id === b.clause);
        if (!pair) {
          json(res, 404, { error: 'that pair is not in the sample' });
          return;
        }
        const v: GoldVerdict = { rule: pair.rule.id, clause: pair.clause.id, verdict: b.verdict, rater, at: Date.now(), stratum: pair.stratum, matcher: pair.matcher };
        if (typeof b.note === 'string' && b.note.trim()) v.note = b.note.trim();
        verdicts = upsertVerdict(verdicts, v);
        writeVerdicts(goldFile, verdicts, policy, superseded);
        // The matcher's call is revealed only now, after the rater committed.
        json(res, 200, { ok: true, matcher: pair.matcher, stratum: pair.stratum, agreed: (pair.matcher !== null) === (b.verdict === 'confirmed') });
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
    sample,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>polyx gold alignment</title>
<style>
  :root { --ink:#1b1b1b; --muted:#6b6b6b; --line:#e3e3e3; --ok:#1f7a3a; --bad:#b3261e; --bg:#fafaf8 }
  * { box-sizing:border-box }
  body { margin:0; font:15px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif; color:var(--ink); background:var(--bg) }
  header { display:flex; justify-content:space-between; align-items:baseline; padding:12px 24px; border-bottom:1px solid var(--line); background:#fff }
  main { max-width:760px; margin:0 auto; padding:28px 24px 120px }
  .muted { color:var(--muted); font-size:13px }
  .card { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px 18px; margin:0 0 14px }
  .card h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 8px }
  .card p.big { font-size:17px; margin:0 0 8px; font-weight:600 }
  .q { text-align:center; font-size:16px; margin:22px 0 14px }
  footer { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line); padding:12px 24px; display:flex; gap:10px; justify-content:center; align-items:center; flex-wrap:wrap }
  button { padding:10px 20px; border-radius:6px; border:1px solid var(--line); background:#fff; font:inherit; cursor:pointer }
  button.yes { background:var(--ok); color:#fff; border-color:var(--ok) }
  button.no { background:var(--bad); color:#fff; border-color:var(--bad) }
  input { padding:8px 10px; border:1px solid var(--line); border-radius:6px; font:inherit }
  kbd { font:11px monospace; border:1px solid rgba(255,255,255,.5); border-radius:3px; padding:0 4px; margin-left:6px }
  button:not(.yes):not(.no) kbd { border-color:var(--line) }
  table.cmp { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--line); border-radius:8px; overflow:hidden; margin:0 0 12px }
  table.cmp th, table.cmp td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); font-size:15px }
  table.cmp thead th { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600 }
  table.cmp tbody th { color:var(--muted); font-weight:500; font-size:13px; width:110px }
  table.cmp td.op { text-align:center; color:var(--muted); width:24px }
  table.cmp td.flag { color:var(--bad); font-size:11px; font-weight:700; letter-spacing:.04em; width:76px }
  table.cmp tr.differs td { background:#fdecea }
  table.cmp tr.differs td.op { color:var(--bad); font-weight:700 }
  .warn { text-align:center; color:#8a1c14; font-size:14px; margin:0 0 14px }
  .ok { text-align:center; color:var(--ok); font-size:14px; margin:0 0 14px }
  .verdict { text-align:center; padding:10px; border-radius:6px; margin:12px 0; font-size:14px }
  .verdict.agree { background:#eaf6ee; color:#1f7a3a } .verdict.differ { background:#fdecea; color:#8a1c14 }
  .done { text-align:center; padding:70px 0; color:var(--muted) }
</style>
<header>
  <div><strong>polyx gold alignment</strong> <span class="muted" id="policy"></span></div>
  <div class="muted" id="progress"></div>
</header>
<main id="main"><div class="done">loading…</div></main>
<footer id="footer" hidden>
  <button class="yes" onclick="rate('confirmed')">Same rule<kbd>Y</kbd></button>
  <button class="no" onclick="rate('rejected')">Different<kbd>N</kbd></button>
  <button onclick="skip()">Skip<kbd>S</kbd></button>
  <input type="text" id="note" placeholder="note (optional)">
  <input type="text" id="rater" placeholder="your name" style="max-width:150px">
</footer>
<script>
let pair = null, busy = false, skipped = new Set();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
try { $('#rater').value = localStorage.getItem('polyx.rater') || ''; } catch {}
$('#rater').addEventListener('change', () => { try { localStorage.setItem('polyx.rater', $('#rater').value); } catch {} load(); });

async function load() {
  const r = await (await fetch('/api/next?rater=' + encodeURIComponent($('#rater').value))).json();
  $('#policy').textContent = r.policy;
  $('#progress').textContent = r.mine + ' of ' + r.total + ' rated by you · ' + r.progress.rated + ' pairs rated in all' + (r.progress.doubleRated ? ' · ' + r.progress.doubleRated + ' by two people' : '');
  pair = r.pair && !skipped.has(r.pair.key) ? r.pair : null;
  if (!pair) {
    const left = r.total - r.mine;
    $('#footer').hidden = true;
    $('#main').innerHTML = '<div class="done">' + (left ? 'Everything left was skipped. Reload to see it again.' : 'All ' + r.total + ' pairs rated. Saved to ' + esc(r.goldFile) + ' \\u2014 run <code>polyx evaluate abcd</code> to see the matcher scored against you.') + '</div>';
    return;
  }
  render(pair); $('#footer').hidden = false; $('#note').value = '';
}
function render(p) {
  const rows = p.compare.map((r) =>
    '<tr class="' + (r.same ? 'same' : 'differs') + '"><th>' + esc(r.field) + '</th>' +
    '<td>' + esc(r.rule) + '</td>' +
    '<td class="op">' + (r.same ? '=' : '\\u2260') + '</td>' +
    '<td>' + esc(r.clause) + '</td>' +
    '<td class="flag">' + (r.same ? '' : 'DIFFERS') + '</td></tr>').join('');
  const nDiff = p.compare.filter((r) => !r.same).length;
  $('#main').innerHTML =
    '<table class="cmp"><thead><tr><th></th><th>polyx mined this</th><th></th><th>the rulebook says this</th><th></th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table>' +
    (nDiff
      ? '<p class="warn">' + nDiff + (nDiff > 1 ? ' fields differ' : ' field differs') + '. Read the marked row before answering.</p>'
      : '<p class="ok">Every field matches.</p>') +
    '<div class="card"><h2>the mined rule, in full</h2><p>' + esc(p.rule.text) + '</p>' +
    '<p class="muted">' + esc(p.rule.evidence) + '</p></div>' +
    '<div class="card"><h2>the written clause, in full</h2><p>' + esc(p.clause.text) + '</p>' +
    '<p class="muted">' + esc(p.clause.id) + '</p></div>' +
    '<p class="q">Are these <b>the same rule</b>?</p>';
  window.scrollTo(0, 0);
}
async function rate(verdict) {
  if (!pair || busy) return;
  if (!$('#rater').value.trim()) { alert('Put your name in the box first \\u2014 the inter-rater figure needs to know who said what.'); $('#rater').focus(); return; }
  busy = true;
  const r = await (await fetch('/api/rate', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rule: pair.rule.id, clause: pair.clause.id, verdict, note: $('#note').value, rater: $('#rater').value }) })).json();
  busy = false;
  if (r.error) { alert(r.error); return; }
  // the matcher's call, revealed only now
  const d = document.createElement('div');
  d.className = 'verdict ' + (r.agreed ? 'agree' : 'differ');
  d.textContent = r.agreed
    ? 'The matcher agreed (' + (r.matcher || 'declined to pair these') + ').'
    : 'The matcher DISAGREED \\u2014 it said ' + (r.matcher ? r.matcher : 'these are not the same rule') + '. Noted.';
  $('#main').appendChild(d);
  setTimeout(load, r.agreed ? 320 : 1100);
}
function skip() { if (pair) { skipped.add(pair.key); load(); } }
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'y') rate('confirmed'); else if (k === 'n') rate('rejected'); else if (k === 's') skip();
});
load();
</script>
`;
