// The domain reviewer's surface (FS §S2, F5.1, F5.4). One rule per screen,
// in domain vocabulary, with the interactions that support it and THE
// INTERACTIONS THAT CONTRADICT IT, and three buttons. Nothing to navigate
// away to. A local node:http server over the SQLite store, so a verdict is
// saved the moment it is given and the time between verdicts is the pace
// figure F5.4 asks for.
//
// The page shows canonical (redacted) event timelines only. Raw source
// records — the analyst's traceability, not the reviewer's — are behind an
// explicit click.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Condition, type Event, type Interaction, type LoadedCorpus, type Rule, type PredicateSet } from 'polyx-lens';
import { renderCondition } from 'polyx-lens';
import { verdict as verdictLabel } from '../mine/index.ts';
import { resolveRaw } from '../show.ts';
import { openStore, type Store } from '../store/db.ts';
import { adjudicate, adjudications, loadRule, loadRules, reviewPace, type ReviewVerdict } from '../store/rules.ts';
import { evalCondition } from 'polyx-lens';
import { cmp } from 'polyx-lens';
import { consequentialTypes } from 'polyx-lens';
import { naiveExtractor } from 'polyx-lens';
import { decisionPoints, type DecisionPoint } from '../mine/recommend.ts';

export interface ReviewServerOptions {
  dbPath: string;
  corpus: LoadedCorpus;
  port?: number;
  host?: string;
  /** Include borrowed-evidence rules in the queue (never refused ones). */
  all?: boolean;
  /** Serve an evenly spread sample of this many rules — for a representative pace measurement (F5.4). */
  sample?: number;
  /** The corpus's predicate set, for the JF4.3 dependency check at adjudication. Null when none is declared. */
  predicates?: PredicateSet | null;
}

interface Timeline {
  interactionId: string;
  episodeId: string;
  outcome: string | null;
  events: Array<{ seq: number; type: string; kind: string; slots: Record<string, unknown>; subject: boolean; guard: boolean; inEpisode: boolean; collapsed?: number }>;
}

function timeline(byId: Map<string, Interaction>, rule: Rule, ref: Rule['examples'][number]): Timeline | null {
  const it = byId.get(ref.interactionId);
  if (!it) return null;
  const guard = rule.bindings.guard;
  return {
    interactionId: it.id,
    episodeId: ref.episodeId,
    outcome: it.outcome?.label ?? null,
    events: it.events
      .filter((e: Event) => rule.window === 'interaction' || e.episode === ref.episodeId)
      .map((e: Event) => ({
        seq: e.seq,
        type: e.type,
        kind: e.kind,
        slots: e.slots,
        subject: e.seq === ref.seq,
        guard: guard !== undefined && e.type === guard,
        inEpisode: e.episode === ref.episodeId,
      }))
      // A thirty-line timeline of "utterance" buries the four lines that
      // matter. Consecutive chat turns collapse to one row with a count.
      .reduce<Timeline['events']>((acc, e) => {
        const chat = e.kind === 'agent_utterance' || e.kind === 'customer_utterance';
        const prev = acc[acc.length - 1];
        if (chat && prev && prev.collapsed !== undefined && !prev.subject && !prev.guard) {
          prev.collapsed++;
          return acc;
        }
        acc.push(chat && !e.subject && !e.guard ? { ...e, collapsed: 1 } : e);
        return acc;
      }, []),
  };
}

function queue(store: Store, corpusName: string, all: boolean, sample?: number): Rule[] {
  const rules = loadRules(store, { corpus: corpusName, status: ['proposed'], ownOnly: !all });
  // Most support first, and a rule with counter-evidence after one without:
  // the reviewer is being asked to make a decision, and the decisions are
  // the ones lower down.
  if (!sample || sample >= rules.length) return rules;
  // A pace measurement (F5.4) taken over the first N would time the N EASIEST
  // rules — highest support, no counter-examples to read — and flatter the
  // surface. Spread the sample evenly across the support range instead, so the
  // reviewer meets the hard decisions in proportion.
  return Array.from({ length: sample }, (_, k) => rules[Math.round((k * (rules.length - 1)) / (sample - 1))]!);
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

export interface RecommendationContext {
  /** Decision points whose facts match the rule's antecedent. */
  matched: number;
  /** What the agents actually did in those — the real alternatives to this rule. */
  did: Array<{ action: string; n: number }>;
  /** How often this action is taken across ALL decision points in the scope. */
  baseline: { n: number; of: number };
  /** Of the matches with a known outcome, how many ended well. */
  outcome: { holds: number; of: number } | null;
}

/**
 * A recommendation has no guard, so "what came first" and "counter-examples"
 * — an obligation's evidence — say nothing about it. What decides a
 * recommendation is LIFT: how often this action is taken in general, against
 * how often it is taken when the antecedent holds. A rule that takes a 29%
 * action to 100% is a claim; one that takes a 97% action to 100% is noise.
 */
export function recommendationContext(points: DecisionPoint[], rule: Rule): RecommendationContext {
  const action = rule.bindings.action!;
  const matched = points.filter((p) => rule.conditions.every((c) => evalCondition(c, p.facts) === true));
  const counts = new Map<string, number>();
  for (const p of matched) counts.set(p.action, (counts.get(p.action) ?? 0) + 1);
  const withOutcome = matched.filter((p) => p.good !== null);
  return {
    matched: matched.length,
    did: [...counts].map(([a, n]) => ({ action: a, n })).sort((x, y) => y.n - x.n || cmp(x.action, y.action)),
    baseline: { n: points.filter((p) => p.action === action).length, of: points.length },
    outcome: withOutcome.length ? { holds: withOutcome.filter((p) => p.good).length, of: withOutcome.length } : null,
  };
}

export function ruleView(store: Store, corpus: LoadedCorpus, byId: Map<string, Interaction>, rule: Rule, points?: DecisionPoint[]) {
  return {
    rule: {
      id: rule.id,
      scope: rule.scope,
      status: rule.status,
      text: rule.text,
      evidence: rule.evidence,
      support: rule.support,
      corpusSupport: rule.corpusSupport,
      provenance: verdictLabel(rule),
      window: rule.window,
      pattern: rule.pattern,
      bindings: rule.bindings,
      conditions: rule.conditions.map(renderCondition),
      reproposedReason: rule.reproposedReason ?? null,
      alphabetVersion: rule.alphabetVersion,
      family: rule.family,
      outcomeSupport: rule.outcomeSupport ?? null,
      labels: Object.fromEntries(corpus.alphabet.eventTypes.filter((t) => t.label).map((t) => [t.id, t.label])),
    },
    context: rule.family === 'recommendation' && points ? recommendationContext(points, rule) : null,
    supporting: rule.examples.map((r) => timeline(byId, rule, r)).filter(Boolean),
    contradicting: rule.counterexamples.map((r) => timeline(byId, rule, r)).filter(Boolean),
    adjudications: adjudications(store, rule.id, rule.scope, rule.corpus),
  };
}

export async function startReviewServer(opts: ReviewServerOptions): Promise<{ port: number; url: string; server: Server; close: () => Promise<void> }> {
  const store = openStore(opts.dbPath);
  const byId = new Map(opts.corpus.interactions.map((i) => [i.id, i]));
  const corpusName = opts.corpus.name;
  const all = opts.all ?? false;
  const sample = opts.sample;
  // Recomputed once, not per request: on ABCD this is 5,174 decision points.
  let points: DecisionPoint[] | undefined;
  const decisions = async () => (points ??= decisionPoints(await naiveExtractor.extract(opts.corpus.interactions, consequentialTypes(opts.corpus.alphabet))));

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/queue') {
        const q = queue(store, corpusName, all, sample);
        json(res, 200, {
          corpus: corpusName,
          alphabetVersion: opts.corpus.alphabet.version,
          remaining: q.length,
          reviewed: loadRules(store, { corpus: corpusName, status: ['real', 'not_real', 'narrowed'] }).length,
          pace: reviewPace(store),
          queue: q.map((r) => ({ id: r.id, scope: r.scope, text: r.text, support: r.support })),
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/rule') {
        const id = url.searchParams.get('id');
        const scope = url.searchParams.get('scope') ?? undefined;
        const rule = id ? loadRule(store, id, scope, corpusName) : queue(store, corpusName, all, sample)[0];
        if (!rule) {
          json(res, 200, { done: true });
          return;
        }
        json(res, 200, ruleView(store, opts.corpus, byId, rule, rule.family === 'recommendation' ? await decisions() : undefined));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/raw') {
        const id = url.searchParams.get('interaction');
        const seq = Number(url.searchParams.get('seq'));
        const it = id ? byId.get(id) : undefined;
        const ev = it?.events[seq];
        if (!ev) {
          json(res, 404, { error: 'no such event' });
          return;
        }
        json(res, 200, { raw: ev.raw, record: resolveRaw(ev.raw) });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/adjudicate') {
        const body = await readJson(req);
        const id = String(body.id ?? '');
        const scope = typeof body.scope === 'string' ? body.scope : undefined;
        const v = body.verdict;
        if (v !== 'real' && v !== 'not_real' && v !== 'narrowed') {
          json(res, 400, { error: 'verdict must be real | not_real | narrowed' });
          return;
        }
        const o: Parameters<typeof adjudicate>[3] = {};
        if (scope) o.scope = scope;
        o.corpus = corpusName;
        if (typeof body.note === 'string' && body.note) o.note = body.note;
        if (typeof body.reviewer === 'string' && body.reviewer) o.reviewer = body.reviewer;
        if (body.condition && typeof body.condition === 'object') o.condition = body.condition as Condition;
        o.predicates = opts.predicates ?? null;
        const rule = adjudicate(store, id, v as ReviewVerdict, o);
        json(res, 200, { ok: true, status: rule.status });
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          store.close();
          err ? reject(err) : resolve();
        });
      }),
  };
}

const PAGE = /* html */ `<!doctype html>
<meta charset="utf-8">
<title>polyx review</title>
<style>
  :root { --ink:#1b1b1b; --muted:#6b6b6b; --line:#e3e3e3; --ok:#1f7a3a; --bad:#b3261e; --mark:#fff3bf; --bg:#fafaf8; }
  * { box-sizing:border-box }
  body { margin:0; font:15px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color:var(--ink); background:var(--bg) }
  header { display:flex; justify-content:space-between; align-items:baseline; padding:12px 24px; border-bottom:1px solid var(--line); background:#fff; position:sticky; top:0 }
  header .muted { color:var(--muted); font-size:13px }
  main { max-width:1100px; margin:0 auto; padding:20px 24px 80px }
  h1 { font-size:22px; margin:0 0 6px; font-weight:600 }
  .evidence { color:var(--muted); margin:0 0 10px }
  .meta { display:flex; gap:18px; flex-wrap:wrap; font-size:13px; color:var(--muted); margin-bottom:18px }
  .meta b { color:var(--ink) }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:20px }
  @media (max-width:800px) { .cols { grid-template-columns:1fr } }
  section h2 { font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px }
  .tl { background:#fff; border:1px solid var(--line); border-radius:6px; padding:8px 10px; margin-bottom:10px; font-size:13px }
  .tl .hd { display:flex; justify-content:space-between; color:var(--muted); margin-bottom:4px }
  .tl ol { list-style:none; margin:0; padding:0 }
  .tl li { padding:1px 4px; border-radius:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
  .tl li.subject { background:var(--mark); font-weight:600 }
  .tl li.guard { color:var(--ok); font-weight:600 }
  .tl li.out { opacity:.45 }
  .tl li .slots { color:var(--muted) }
  .tl li a { color:var(--muted); text-decoration:none; margin-left:10px; font-size:11px; border-bottom:1px dotted var(--line) }
  .tl li .marker { font-size:10px; text-transform:uppercase; letter-spacing:.06em; margin-left:10px; padding:1px 6px; border-radius:8px; background:#fff3bf; color:#7a5b00 }
  .tl li .marker.g { background:#e6f4ea; color:#1f7a3a }
  .lift { background:#fff; border:1px solid var(--line); border-radius:8px; padding:14px 16px; margin:0 0 16px }
  .lift h2 { font-size:15px; margin:0 0 10px; font-weight:600; text-transform:none; letter-spacing:0; color:var(--ink) }
  .lift h3 { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:14px 0 6px }
  .lift table { width:100%; border-collapse:collapse; margin-bottom:8px }
  .lift td, .lift th { padding:6px 8px; border-bottom:1px solid var(--line); text-align:left; font-weight:400; font-size:14px }
  .lift th { color:var(--muted) }
  .lift td.pc { text-align:right; font-weight:700; width:60px }
  .lift tr.hi td, .lift tr.hi th { background:#fff8e1; color:var(--ink) }
  .lift ul { margin:0; padding-left:20px; font-size:14px }
  .lift p { font-size:14px; margin:6px 0 0 }
  .tl li.chat { color:#9a9a9a; font-style:italic; font-size:12px }
  .legend { font-size:13px; color:var(--muted); margin:0 0 12px; line-height:1.7 }
  .legend b { color:var(--ink) }
  .legend .sw { display:inline-block; width:11px; height:11px; border-radius:2px; vertical-align:-1px; margin-right:4px }
  .contra .tl { border-color:#f1c4c0 }
  footer { position:fixed; bottom:0; left:0; right:0; background:#fff; border-top:1px solid var(--line); padding:12px 24px; display:flex; gap:10px; align-items:center; flex-wrap:wrap }
  footer input[type=text] { flex:1; min-width:200px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; font:inherit }
  button { padding:9px 14px; border-radius:6px; border:1px solid var(--line); background:#fff; font:inherit; cursor:pointer }
  button.real { background:var(--ok); color:#fff; border-color:var(--ok) }
  button.not { background:var(--bad); color:#fff; border-color:var(--bad) }
  kbd { font:11px monospace; border:1px solid var(--line); border-radius:3px; padding:0 4px; margin-left:6px; opacity:.8 }
  .done { text-align:center; padding:80px 0; color:var(--muted) }
  .raw { font:12px monospace; white-space:pre-wrap; background:#f3f3f0; padding:6px; border-radius:4px; margin:4px 0 }
</style>
<header>
  <div><strong>polyx review</strong> <span class="muted" id="corpus"></span></div>
  <div class="muted" id="progress"></div>
</header>
<main id="main"><div class="done">loading…</div></main>
<footer id="footer" hidden>
  <button class="real" onclick="mark('real')" title="yes, this operation follows this rule — the advisor may serve it">Real<kbd>R</kbd></button>
  <button class="not" onclick="mark('not_real')" title="a coincidence, not a policy — not re-proposed unless its support moves">Not real<kbd>N</kbd></button>
  <button onclick="narrow()" title="true, but too broad — you name a condition and the next mine emits a narrower rule">Needs narrowing<kbd>W</kbd></button>
  <input type="text" id="note" placeholder="note (optional)">
  <input type="text" id="reviewer" placeholder="your name" style="max-width:160px">
  <button onclick="skip()">Skip<kbd>S</kbd></button>
</footer>
<script>
let current = null; let skipped = new Set();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
try { $('#reviewer').value = localStorage.getItem('polyx.reviewer') || ''; } catch {}
$('#reviewer').addEventListener('change', () => { try { localStorage.setItem('polyx.reviewer', $('#reviewer').value); } catch {} });

async function load() {
  const q = await (await fetch('/api/queue')).json();
  $('#corpus').textContent = q.corpus + ' · alphabet v' + q.alphabetVersion;
  const pace = q.pace.medianSeconds == null ? '' : ' · median ' + Math.round(q.pace.medianSeconds) + 's per rule';
  $('#progress').textContent = q.remaining + ' to review · ' + q.reviewed + ' reviewed' + pace;
  const next = q.queue.find((r) => !skipped.has(r.id + '|' + r.scope));
  if (!next) { current = null; $('#footer').hidden = true; $('#main').innerHTML = '<div class="done">' + (q.remaining ? 'Everything left was skipped. Reload to see it again.' : 'Nothing left to review.') + '</div>'; return; }
  const v = await (await fetch('/api/rule?id=' + next.id + '&scope=' + encodeURIComponent(next.scope))).json();
  current = v.rule; render(v); $('#footer').hidden = false; $('#note').value = '';
}
function label(t, labels) { return labels[t] || t.replace(/^[a-z]+:/, '').replace(/[_-]+/g, ' '); }
function tl(t, r, kind) {
  const items = t.events.map((e) => {
    const cls = [e.subject ? 'subject' : '', e.guard ? 'guard' : '', e.inEpisode ? '' : 'out'].filter(Boolean).join(' ');
    if (e.collapsed) return '<li class="chat">' + e.collapsed + (e.collapsed > 1 ? ' messages' : ' message') + '</li>';
    const slots = Object.keys(e.slots).length ? ' <span class="slots">' + esc(JSON.stringify(e.slots)) + '</span>' : '';
    const mark = e.subject ? '<span class="marker">the action</span>' : e.guard ? '<span class="marker g">must come first</span>' : '';
    return '<li class="' + cls + '">' + esc(label(e.type, r.labels)) + slots + mark +
      '<a href="#" title="show the original dataset record behind this event" onclick="return raw(this,\\'' + esc(t.interactionId) + '\\',' + e.seq + ')">source&nbsp;record</a></li>';
  }).join('');
  return '<div class="tl"><div class="hd"><span>' + esc(t.interactionId) + '</span><span>' + (t.outcome ? 'outcome: ' + esc(t.outcome) : '') + '</span></div><ol>' + items + '</ol></div>';
}
function render(v) {
  const r = v.rule;
  const s = r.support, cs = r.corpusSupport;
  const pct = s.of ? Math.round(100 * s.holds / s.of) : 0;
  // A recommendation has no guard, so an obligation's evidence — what came
  // first, what contradicted it — says nothing about it. What decides one is
  // LIFT: how often this action happens anyway, against how often it happens
  // when the conditions hold.
  const ctx = v.context;
  let rec = '';
  if (ctx) {
    const base = ctx.baseline.of ? (100 * ctx.baseline.n / ctx.baseline.of) : 0;
    const alts = ctx.did.filter((d) => d.action !== r.bindings.action);
    const hits = ctx.matched - alts.reduce((a, d) => a + d.n, 0);
    const here = ctx.matched ? (100 * hits / ctx.matched) : 0;
    rec =
      '<div class="lift"><h2>Is this a rule, or just what usually happens?</h2>' +
      '<table><tbody>' +
      '<tr><th>' + esc(label(r.bindings.action, r.labels)) + ', across every decision point</th>' +
      '<td>' + ctx.baseline.n + ' of ' + ctx.baseline.of + '</td><td class="pc">' + base.toFixed(0) + '%</td></tr>' +
      '<tr class="hi"><th>… when this rule’s conditions hold</th>' +
      '<td>' + hits + ' of ' + ctx.matched + '</td><td class="pc">' + here.toFixed(0) + '%</td></tr>' +
      '</tbody></table>' +
      '<p>' + (base >= 90
        ? '<b>Careful:</b> this is what happens almost always anyway, so the conditions may be adding nothing.'
        : 'The conditions take a ' + base.toFixed(0) + '% action to ' + here.toFixed(0) + '%. Is that a rule this business follows, or a coincidence of this data?') + '</p>' +
      '<h3>What else the agents did in these ' + ctx.matched + ' situations</h3>' +
      (alts.length
        ? '<ul>' + alts.map((d) => '<li>' + esc(label(d.action, r.labels)) + ' — ' + d.n + ' time' + (d.n > 1 ? 's' : '') + '</li>').join('') + '</ul>'
        : '<p class="muted">Nothing else — all ' + ctx.matched + ' took this action.</p>') +
      (ctx.outcome
        ? '<h3>How those ended</h3><p>' + ctx.outcome.holds + ' of ' + ctx.outcome.of + ' resolved' +
          (ctx.outcome.holds < ctx.outcome.of ? ' — <b>' + (ctx.outcome.of - ctx.outcome.holds) + ' did not.</b> A rule can faithfully reproduce something agents do badly.' : '.') + '</p>'
        : '') +
      '</div>';
  }
  $('#main').innerHTML =
    '<h1>' + esc(r.text) + '</h1>' +
    '<p class="evidence">' + esc(r.evidence) + '</p>' +
    (r.reproposedReason ? '<p class="evidence">Back on the list: ' + esc(r.reproposedReason) + '</p>' : '') +
    '<div class="meta"><span>support <b>' + s.holds + '/' + s.of + '</b> (' + pct + '%)</span>' +
    (cs.of !== s.of ? '<span>across the operator <b>' + cs.holds + '/' + cs.of + '</b></span>' : '') +
    '<span>provenance <b>' + esc(r.provenance) + '</b></span><span>window <b>' + esc(r.window) + '</b></span>' +
    (r.conditions.length ? '<span>when <b>' + esc(r.conditions.join(' and ')) + '</b></span>' : '') +
    '<span class="muted">' + esc(r.id) + ' · ' + esc(r.scope) + '</span></div>' +
    rec +
    '<p class="legend">Each block below is <b>one conversation, in order</b>. ' +
    '<span class="sw" style="background:#fff3bf"></span><b>Highlighted</b> is the action the rule is about' +
    (ctx ? '. ' : '; <span class="sw" style="background:#e6f4ea"></span><b>green</b> is what the rule says must come first. ') +
    'Faded lines are outside the episode. <i>source record</i> opens the original dataset entry — for spot-checking, ignore it otherwise.</p>' +
    '<div class="cols"><section class="contra"><h2>Contradicting — ' + (s.of - s.holds) + ' of ' + s.of + (v.contradicting.length < s.of - s.holds ? ' (showing ' + v.contradicting.length + ')' : '') + '</h2>' +
    (v.contradicting.length ? v.contradicting.map((t) => tl(t, r, 'c')).join('') : '<p class="evidence">None. Every instance in the history satisfies this rule.</p>') + '</section>' +
    '<section><h2>Supporting — ' + s.holds + ' of ' + s.of + (v.supporting.length < s.holds ? ' (showing ' + v.supporting.length + ')' : '') + '</h2>' + v.supporting.map((t) => tl(t, r, 's')).join('') + '</section></div>';
  window.scrollTo(0, 0);
}
async function raw(a, id, seq) {
  const r = await (await fetch('/api/raw?interaction=' + encodeURIComponent(id) + '&seq=' + seq)).json();
  const pre = document.createElement('div'); pre.className = 'raw'; pre.textContent = r.raw.file + r.raw.path + '\\n' + JSON.stringify(r.record);
  a.parentElement.appendChild(pre); a.remove(); return false;
}
async function mark(verdict, condition) {
  if (!current) return;
  const body = { id: current.id, scope: current.scope, verdict, note: $('#note').value, reviewer: $('#reviewer').value };
  if (condition) body.condition = condition;
  const r = await (await fetch('/api/adjudicate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.error) { alert(r.error); return; }
  load();
}
function narrow() {
  const s = prompt('Narrow to which condition? fact=value, e.g. episode.intent=intent:refund_initiate');
  if (!s) return;
  const m = /^([A-Za-z0-9_.]+)=(.*)$/.exec(s.trim());
  if (!m) { alert('fact=value'); return; }
  const raw = m[2]; const value = raw === 'true' ? true : raw === 'false' ? false : /^-?\\d+(\\.\\d+)?$/.test(raw) ? Number(raw) : raw;
  mark('narrowed', { fact: m[1], op: 'eq', value });
}
function skip() { if (current) { skipped.add(current.id + '|' + current.scope); load(); } }
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'r' || e.key === 'R') mark('real');
  else if (e.key === 'n' || e.key === 'N') mark('not_real');
  else if (e.key === 'w' || e.key === 'W') narrow();
  else if (e.key === 's' || e.key === 'S') skip();
});
load();
</script>
`;
