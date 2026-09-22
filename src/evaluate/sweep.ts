// Threshold sensitivity (TS §11, FS §10.3). The inherited floors came from
// one dev-tool corpus and are circular there; this is the first honest
// second domain, so every floor is swept and a CURVE is reported, never a
// tuned point. Mining is deterministic and in-memory, so a sweep is just the
// cartesian product of the requested values, each run stamped.
import { type LoadedCorpus } from '@cognitive-fab/polyx-lens';
import { mine } from '../mine/index.ts';
import { withThresholds, type Thresholds } from '@cognitive-fab/polyx-lens';
import { align } from './align.ts';
import { metrics, type Metrics } from './metrics.ts';
import { loadPolicy } from './policies/index.ts';

export interface SweepPoint {
  thresholds: Partial<Thresholds>;
  proposed: number;
  refused: number;
  precision: number | null;
  precisionStrict: number | null;
  recall: number | null;
  recallStrict: number | null;
  refusalCorrectness: number | null;
  metrics: Metrics;
}

/** `minInstances=3,5,10;impliesSupport=0.8,0.9` → the grid. */
export function parseSweep(spec: string): Array<Partial<Thresholds>> {
  const axes = spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((axis) => {
      const [k, vs] = axis.split('=');
      if (!k || !vs) throw new Error(`--sweep expects k=v1,v2;k2=v3, got '${axis}'`);
      const values = vs.split(',').map((v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`--sweep: '${v}' is not a number`);
        return n;
      });
      return { key: k.trim(), values };
    });
  let grid: Array<Partial<Thresholds>> = [{}];
  for (const axis of axes) {
    grid = grid.flatMap((g) => axis.values.map((v) => ({ ...g, [axis.key]: v })));
  }
  return grid;
}

export async function sweep(corpus: LoadedCorpus, base: Thresholds, grid: Array<Partial<Thresholds>>, policyFile: string): Promise<SweepPoint[]> {
  const policy = loadPolicy(policyFile);
  const out: SweepPoint[] = [];
  for (const overrides of grid) {
    const t = withThresholds({ ...base, ...overrides });
    // Policy conformance is obligations only; recommendations would be discarded by metrics().
    const result = await mine(corpus, t, { minedAt: 0, recommend: false });
    const m = metrics(result.rules, policy, align(result.rules, policy));
    out.push({
      thresholds: overrides,
      proposed: m.proposed,
      refused: m.refused,
      precision: m.precision.lenient.value,
      precisionStrict: m.precision.strict.value,
      recall: m.recall.lenient.value,
      recallStrict: m.recall.strict.value,
      refusalCorrectness: m.refusalCorrectness.value,
      metrics: m,
    });
  }
  return out;
}

const f = (v: number | null) => (v === null ? '   n/a' : v.toFixed(3).padStart(6));

export function renderSweep(points: SweepPoint[]): string {
  const keys = [...new Set(points.flatMap((p) => Object.keys(p.thresholds)))];
  const lines = [`${keys.map((k) => k.padEnd(16)).join('')}proposed refused  prec   prec.s  recall recall.s refusal`];
  for (const p of points) {
    lines.push(
      `${keys.map((k) => String(p.thresholds[k as keyof Thresholds] ?? '').padEnd(16)).join('')}${String(p.proposed).padStart(8)} ${String(p.refused).padStart(7)} ${f(p.precision)} ${f(p.precisionStrict)} ${f(p.recall)} ${f(p.recallStrict)}  ${f(p.refusalCorrectness)}`,
    );
  }
  return lines.join('\n');
}
