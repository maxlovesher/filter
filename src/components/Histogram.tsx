export interface HistogramData {
  r: number[];
  g: number[];
  b: number[];
  /** Share of pixels clipped to pure black / pure white (any channel). */
  clipLow: number;
  clipHigh: number;
}

export const HIST_BINS = 64;

export function computeHistogram(px: Uint8ClampedArray): HistogramData {
  const r = new Array(HIST_BINS).fill(0);
  const g = new Array(HIST_BINS).fill(0);
  const b = new Array(HIST_BINS).fill(0);
  let low = 0;
  let high = 0;
  const shift = 8 - Math.log2(HIST_BINS);
  for (let i = 0; i < px.length; i += 4) {
    r[px[i] >> shift]++;
    g[px[i + 1] >> shift]++;
    b[px[i + 2] >> shift]++;
    if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) low++;
    if (px[i] === 255 || px[i + 1] === 255 || px[i + 2] === 255) high++;
  }
  const n = Math.max(1, px.length / 4);
  return { r, g, b, clipLow: low / n, clipHigh: high / n };
}

const W = 256;
const H = 72;

function area(bins: number[], peak: number): string {
  const step = W / (bins.length - 1);
  let d = `M0,${H}`;
  bins.forEach((v, i) => {
    d += `L${(i * step).toFixed(1)},${(H - Math.min(1, v / peak) * H).toFixed(1)}`;
  });
  return `${d}L${W},${H}Z`;
}

/** Lightroom-style RGB histogram with clipping warnings. */
export function Histogram({ data }: { data: HistogramData | null }) {
  if (!data) return <div className="histogram is-empty" />;
  // Ignore the very ends when scaling so a clipped sky doesn't flatten everything else.
  const inner = [...data.r, ...data.g, ...data.b].filter((_, i) => i % HIST_BINS !== 0 && i % HIST_BINS !== HIST_BINS - 1);
  const peak = Math.max(1, ...inner) * 1.05;
  const pct = (v: number) => (v * 100 < 0.1 ? '' : `${(v * 100).toFixed(v < 0.01 ? 1 : 0)}%`);
  return (
    <div className="histogram" role="img" aria-label="Histogram of the edited image">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={area(data.r, peak)} fill="#ff5a5a" />
        <path d={area(data.g, peak)} fill="#4fd46f" />
        <path d={area(data.b, peak)} fill="#5a8cff" />
      </svg>
      <div className="histogram-clip">
        <span className={data.clipLow > 0.005 ? 'warn' : ''} title="Pixels crushed to pure black">
          {pct(data.clipLow) && `◣ ${pct(data.clipLow)}`}
        </span>
        <span className={data.clipHigh > 0.005 ? 'warn' : ''} title="Pixels blown to pure white in some channel">
          {pct(data.clipHigh) && `${pct(data.clipHigh)} ◢`}
        </span>
      </div>
    </div>
  );
}
