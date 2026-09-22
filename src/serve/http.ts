// `polyx serve` — the advisor over node:http (TS §2: no framework, one
// endpoint). Every response is logged as a decision point in the store.
//
//   POST /advise                      → AdviseResponse
//   GET  /rules/<id>/evidence?scope=  → the rule, its evidence sentence, examples and counter-examples
//   GET  /coverage                    → the decision-point log summarised (F7.1)
//   GET  /health
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { openStore, type Store } from '../store/db.ts';
import { loadRule, loadRules } from '../store/rules.ts';
import { Advisor, parseRequest, toRecord, type DecisionRecord } from './advisor.ts';
import { LiveObserver, type LiveObservation } from './observe.ts';
import { cmp } from '@cognitive-fab/polyx-lens';

export interface ServeOptions {
  dbPath: string;
  corpus: string;
  /**
   * Actions an advisory engine may propose (ACV §6.4/§8.3). Comes from the
   * alphabet, not from the stored rules, so a policy change takes effect on
   * restart instead of waiting for a re-mine nothing would prompt.
   */
  recommendable: ReadonlySet<string>;
  port?: number;
  host?: string;
  /**
   * The live observation path (JT8.2). Absent, the server behaves exactly as
   * it did before observation existed and logs `observer: null`. Present,
   * each request's text is redacted and observed BEFORE the advisor is
   * called; the advisor itself stays synchronous and pure.
   */
  observation?: LiveObservation;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function logDecision(store: Store, d: DecisionRecord): void {
  store
    .prepare('INSERT INTO decision_points (at, operator, considering, verdict, reason, missing_json, fired_json, source, observer, observations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(d.at, d.operator, d.considering, d.verdict, d.reason, JSON.stringify(d.missing), JSON.stringify(d.fired), d.source, d.observer, d.observations.length ? JSON.stringify(d.observations) : null);
}

export interface CoverageSummary {
  decisionPoints: number;
  answered: number;
  abstained: { uncovered: number; unknownFact: number };
  /** F7.1: answered / (answered + abstained). */
  coverage: number | null;
  /** F7.3: decision points answered without a model call. */
  inferenceDisplaced: number;
  byVerdict: Record<string, number>;
  /** The facts most often missing — what a caller should start sending. */
  missingFacts: Array<{ fact: string; count: number }>;
}

export function coverageSummary(store: Store, source?: string): CoverageSummary {
  const rows = (
    source
      ? store.prepare('SELECT verdict, reason, missing_json FROM decision_points WHERE source = ?').all(source)
      : store.prepare('SELECT verdict, reason, missing_json FROM decision_points').all()
  ) as Array<{ verdict: string; reason: string | null; missing_json: string }>;
  const byVerdict: Record<string, number> = {};
  let uncovered = 0;
  let unknownFact = 0;
  const missing = new Map<string, number>();
  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
    if (r.reason === 'uncovered') uncovered++;
    if (r.reason === 'unknown_fact') unknownFact++;
    for (const f of JSON.parse(r.missing_json) as string[]) missing.set(f, (missing.get(f) ?? 0) + 1);
  }
  const answered = rows.length - uncovered - unknownFact;
  return {
    decisionPoints: rows.length,
    answered,
    abstained: { uncovered, unknownFact },
    coverage: rows.length ? answered / rows.length : null,
    inferenceDisplaced: answered,
    byVerdict,
    missingFacts: [...missing]
      .map(([fact, count]) => ({ fact, count }))
      .sort((a, b) => b.count - a.count || cmp(a.fact, b.fact))
      .slice(0, 10),
  };
}

export async function startAdvisorServer(opts: ServeOptions): Promise<{ port: number; url: string; server: Server; advisor: Advisor; observer: LiveObserver | null; close: () => Promise<void> }> {
  const store = openStore(opts.dbPath);
  const advisor = new Advisor(loadRules(store, { corpus: opts.corpus }), opts.recommendable);
  const source = `serve:${opts.corpus}`;
  const live = opts.observation ? new LiveObserver(opts.observation) : null;
  let degraded = 0;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'POST' && url.pathname === '/advise') {
        let parsed;
        try {
          parsed = parseRequest(await readJson(req));
        } catch (e) {
          json(res, 400, { error: e instanceof Error ? e.message : String(e) });
          return;
        }
        // Observation first, then the pure call. With no live observer the
        // record says `observer: null` and nothing else about the response
        // differs from a build that never heard of observation (JF5.3).
        const resolved = live ? await live.resolve(parsed) : { observer: null, version: 0, obs: [] };
        if (resolved.observer?.startsWith('null (unreachable')) {
          // Say it once, then every hundredth time: a degraded period should be
          // visible in the log, not in a wall of identical lines.
          if (degraded++ % 100 === 0) console.error(`polyx serve: ${resolved.observer} — answering without observation`);
        }
        const out = advisor.advise(parsed, resolved.obs);
        logDecision(store, toRecord(parsed, out, source, Date.now(), resolved));
        json(res, 200, out);
        return;
      }
      const m = /^\/rules\/([^/]+)\/evidence$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const scope = url.searchParams.get('scope') ?? undefined;
        const rule = loadRule(store, decodeURIComponent(m[1]!), scope, opts.corpus);
        if (!rule) {
          json(res, 404, { error: 'no such rule' });
          return;
        }
        json(res, 200, {
          id: rule.id,
          scope: rule.scope,
          status: rule.status,
          text: rule.text,
          evidence: rule.evidence,
          support: rule.support,
          corpusSupport: rule.corpusSupport,
          outcomeSupport: rule.outcomeSupport ?? null,
          provenance: rule.provenance,
          examples: rule.examples,
          counterexamples: rule.counterexamples,
          alphabetVersion: rule.alphabetVersion,
          minedAt: rule.minedAt,
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/coverage') {
        json(res, 200, coverageSummary(store, source));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        json(res, 200, { ok: true, corpus: opts.corpus, served: advisor.served });
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
    advisor,
    observer: live,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          store.close();
          err ? reject(err) : resolve();
        });
      }),
  };
}
