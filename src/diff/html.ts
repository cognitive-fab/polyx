// The three-region report as HTML (TS §10): every finding linked to its
// interactions, every alignment labelled proposed-for-confirmation.
// Self-contained, no scripts, no external resources — a file a compliance
// officer can open, print, or attach.
import { type InstanceRef, type Manifest } from '@cognitive-fab/polyx-lens';
import type { ClauseFinding, Diff, RuleFinding } from './index.ts';

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const refs = (list: InstanceRef[], label: string) =>
  list.length ? `<p class="refs"><span>${esc(label)}</span> ${list.map((i) => `<code>${esc(i.interactionId)}#${i.seq}</code>`).join(' ')}</p>` : '';

function ruleCard(f: RuleFinding): string {
  return `<article class="card">
  <h3>${esc(f.rule.text)}</h3>
  <p class="meta"><b>${esc(f.rule.support)}</b> · ${esc(f.rule.provenance)} · ${esc(f.rule.status)} · ${esc(f.rule.scope)} · <code>${esc(f.rule.id)}</code></p>
  <p class="evidence">${esc(f.rule.evidence)}</p>
  ${f.alignments.map((a) => `<p class="align"><span class="tag">alignment · ${esc(a.kind)} · proposed for confirmation</span> ${esc(a.clauseId)} — ${esc(a.clauseText)}</p>`).join('')}
  ${f.writtenElsewhere?.length ? `<p class="align"><span class="tag bad">extended beyond the policy</span> the rulebook states this pair, but only for ${esc(f.writtenElsewhere.join(', '))}</p>` : ''}
  ${refs(f.contradicting, 'contradicting')}
  ${refs(f.supporting, 'supporting')}
</article>`;
}

function clauseCard(g: ClauseFinding): string {
  const tag =
    g.kind === 'violated'
      ? `<span class="tag bad">violated ${g.violated} of ${g.exercised} times — your reps ignore this</span>`
      : g.kind === 'kept-not-mined'
        ? `<span class="tag">kept ${g.exercised} of ${g.exercised} times — below a mining floor, not a compliance problem</span>`
        : `<span class="tag muted">never exercised — this situation never arose in the corpus</span>`;
  return `<article class="card">
  <h3>${esc(g.clause.text)}</h3>
  <p class="meta"><code>${esc(g.clause.id)}</code>${g.clause.when ? ` · when ${esc(g.clause.when)}` : ''}</p>
  <p>${tag}</p>
  ${refs(g.violations, 'violations')}
  ${refs(g.kept, 'kept')}
</article>`;
}

export function renderDiffHtml(d: Diff, manifest: Manifest): string {
  const c = d.counts;
  return `<!doctype html>
<meta charset="utf-8">
<title>polyx conformance diff — ${esc(d.corpus)}</title>
<style>
  body { margin:0; font:15px/1.45 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color:#1b1b1b; background:#fafaf8 }
  main { max-width:960px; margin:0 auto; padding:28px 24px 80px }
  h1 { font-size:24px; margin:0 0 4px } h2 { font-size:18px; margin:36px 0 10px; padding-bottom:4px; border-bottom:1px solid #e3e3e3 }
  h3 { font-size:15px; margin:0 0 4px; font-weight:600 }
  .stamp { color:#6b6b6b; font-size:13px } .stamp code { font-size:12px }
  .summary { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin:18px 0 }
  .summary div { background:#fff; border:1px solid #e3e3e3; border-radius:6px; padding:10px 12px } .summary b { font-size:22px; display:block }
  .card { background:#fff; border:1px solid #e3e3e3; border-radius:6px; padding:12px 14px; margin:0 0 10px }
  .meta, .evidence, .refs { color:#6b6b6b; font-size:13px; margin:2px 0 }
  .refs code { margin-right:4px } .refs span { font-weight:600 }
  .align { font-size:13px; margin:4px 0 }
  .tag { display:inline-block; font-size:12px; padding:1px 8px; border-radius:10px; background:#eef2f6; color:#3a4a5a; margin-right:6px }
  .tag.bad { background:#fdecea; color:#8a1c14 } .tag.muted { background:#f0f0ee; color:#666 }
  .note { background:#fff8e1; border:1px solid #f1e2a6; border-radius:6px; padding:10px 12px; font-size:13px }
  .small { font-size:13px; color:#6b6b6b }
</style>
<main>
<h1>Conformance diff — ${esc(d.corpus)}</h1>
<p class="stamp">against <b>${esc(d.policy.name)}</b> v${d.policy.version} · alphabet v${manifest.alphabetVersion} · corpus <code>${esc(manifest.corpusRevision)}</code> · segmenter ${esc(manifest.segmenter)} · seed ${manifest.seed} · commit <code>${esc(manifest.codeCommit ?? 'none')}</code> · run <code>${esc(manifest.runId)}</code></p>
<p class="stamp">thresholds <code>${esc(JSON.stringify(manifest.thresholds))}</code></p>
<div class="summary">
  <div><b>${c.tribal}</b>followed, never written</div>
  <div><b>${c.tribalExtended}</b>&hellip; of those, written for another flow</div>
  <div><b>${c.confirmed}</b>confirmed</div>
  <div><b>${c.gap.violated}</b>written, violated</div>
  <div><b>${c.gap.keptNotMined}</b>written, kept, not mined</div>
  <div><b>${c.gap.neverExercised}</b>written, never exercised</div>
  <div><b>${c.contradictions}</b>contradictions</div>
</div>
<p class="note">Every alignment between a mined rule and a written clause is a <b>proposal for confirmation</b>. Alignment is the least reliable step in this system; a person decides. Every finding names the interactions behind it (<code>interaction#event</code>); <code>polyx review ${esc(d.corpus)} show &lt;rule&gt;</code> and <code>polyx audit ${esc(d.corpus)} --show interaction:&lt;id&gt;</code> resolve them to source records.</p>

<h2>Followed, never written — tribal knowledge (${c.tribal})</h2>
<p class="small">Two different findings, kept apart: <b>${c.tribalExtended}</b> are practices the policy <i>does</i> state — for a different flow, so the reps have extended them somewhere the policy never covered; <b>${c.tribalNovel}</b> appear nowhere in the rulebook at all.</p>
${d.tribal.map(ruleCard).join('\n') || '<p class="small">None.</p>'}

<h2>Confirmed — written and followed (${c.confirmed})</h2>
${d.confirmed.map(ruleCard).join('\n') || '<p class="small">None.</p>'}

<h2>Written, not mined — compliance gap (${d.gap.length})</h2>
<p class="small">Three different things, kept apart: a clause the reps <b>violated</b> is a finding; a clause the corpus <b>never exercised</b> is not; a clause <b>kept every time</b> but below a mining floor is a question for the thresholds, not for the reps.</p>
${d.gap.map(clauseCard).join('\n') || '<p class="small">None.</p>'}

<h2>Contradictions within the mined set (${c.contradictions})</h2>
${d.contradictions.map((x) => `<article class="card"><p>${esc(x.reason)}</p><p class="meta"><code>${esc(x.a.id)}</code> ${esc(x.a.text)} (${esc(x.a.support)})</p><p class="meta"><code>${esc(x.b.id)}</code> ${esc(x.b.text)} (${esc(x.b.support)})</p></article>`).join('\n') || '<p class="small">None.</p>'}

${d.undecided.length ? `<h2>Awaiting alignment (${d.undecided.length})</h2><p class="small">The matcher could only propose a correspondence; a person decides which region these belong to.</p>${d.undecided.map(ruleCard).join('\n')}` : ''}

<h2>Clauses polyx cannot state (${c.inexpressible})</h2>
<p class="small">Real guidance outside the rule language. Counted here so "recovered" is never read as "recovered the whole policy".</p>
${d.inexpressible.map((i) => `<p class="small"><code>${esc(i.id)}</code> ${esc(i.text)} <span class="tag muted">${esc(i.reason)}</span></p>`).join('\n')}
</main>
`;
}
