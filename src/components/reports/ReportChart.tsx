'use client';

// ---------- ReportChart — pure SVG charts for the report designer ----------
// column · bar · pie · donut · line. No library: SVG prints crisply and
// modern-screenshot rasterizes it for the PDF. Sizes are in px (already
// scaled by the caller). Future chart kinds: add a case here + CHART_KIND_LABELS.

import type { ChartConfig } from '@/lib/reports/types';
import type { ChartDatum } from '@/lib/reports/engine';

const fmt = (n: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 1 }).format(n);

export function ReportChart({ cfg, data, w, h, scale, title }: { cfg: ChartConfig; data: ChartDatum[]; w: number; h: number; scale: number; title: string }) {
  const fs = Math.max(6, 2.6 * scale);          // ~7.5pt
  const titleH = title ? fs * 1.8 : 0;
  const legendH = cfg.showLegend && (cfg.kind === 'pie' || cfg.kind === 'donut') ? Math.min(h * 0.35, Math.ceil(data.length / 2) * fs * 1.5 + fs) : 0;
  const plotH = Math.max(10, h - titleH - legendH);

  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-slate-400" style={{ fontSize: fs }}>لا بيانات للرسم</div>;
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} direction="rtl" style={{ fontFamily: 'inherit', display: 'block' }}>
      {title && <text x={w / 2} y={fs * 1.2} textAnchor="middle" fontSize={fs * 1.15} fontWeight={800} fill="#334155">{title}</text>}
      <g transform={`translate(0 ${titleH})`}>
        {cfg.kind === 'column' && <Columns data={data} w={w} h={plotH} fs={fs} showValues={cfg.showValues} />}
        {cfg.kind === 'bar' && <Bars data={data} w={w} h={plotH} fs={fs} showValues={cfg.showValues} />}
        {cfg.kind === 'line' && <Line data={data} w={w} h={plotH} fs={fs} showValues={cfg.showValues} />}
        {(cfg.kind === 'pie' || cfg.kind === 'donut') && <Pie data={data} w={w} h={plotH} fs={fs} donut={cfg.kind === 'donut'} showValues={cfg.showValues} />}
      </g>
      {legendH > 0 && (
        <g transform={`translate(0 ${titleH + plotH})`}>
          {data.map((d, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = w - col * (w / 2) - fs * 0.6;
            const y = fs * 1.5 * row + fs * 1.2;
            return (
              <g key={i}>
                <rect x={x - fs} y={y - fs * 0.8} width={fs} height={fs} rx={fs * 0.2} fill={d.color} />
                <text x={x - fs * 1.4} y={y} textAnchor="end" fontSize={fs * 0.95} fill="#475569" fontWeight={600}>{d.label} ({fmt(d.value)})</text>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Columns({ data, w, h, fs, showValues }: { data: ChartDatum[]; w: number; h: number; fs: number; showValues: boolean }) {
  const padB = fs * 2.4, padT = showValues ? fs * 1.4 : fs * 0.4, padX = fs * 0.6;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = w - padX * 2, plotH = h - padB - padT;
  const gap = plotW / data.length;
  const bw = Math.min(gap * 0.7, fs * 6);
  return (
    <g>
      <line x1={padX} x2={w - padX} y1={h - padB} y2={h - padB} stroke="#cbd5e1" strokeWidth={0.8} />
      {data.map((d, i) => {
        const bh = (d.value / max) * plotH;
        const x = w - padX - gap * (i + 0.5) - bw / 2;   // RTL: first on the right
        const y = h - padB - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh} rx={Math.min(3, bw / 4)} fill={d.color} />
            {showValues && <text x={x + bw / 2} y={y - fs * 0.3} textAnchor="middle" fontSize={fs * 0.9} fontWeight={800} fill="#334155">{fmt(d.value)}</text>}
            <text x={x + bw / 2} y={h - padB + fs * 1.2} textAnchor="middle" fontSize={fs * 0.85} fill="#475569" fontWeight={600}>{trunc(d.label, Math.max(4, Math.floor(gap / (fs * 0.5))))}</text>
          </g>
        );
      })}
    </g>
  );
}

function Bars({ data, w, h, fs, showValues }: { data: ChartDatum[]; w: number; h: number; fs: number; showValues: boolean }) {
  const labelW = Math.min(w * 0.35, fs * 12), valueW = showValues ? fs * 3 : fs * 0.5;
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = h / data.length;
  const bh = Math.min(gap * 0.68, fs * 3);
  const plotW = w - labelW - valueW;
  return (
    <g>
      {data.map((d, i) => {
        const bw = (d.value / max) * plotW;
        const y = gap * (i + 0.5) - bh / 2;
        const xRight = w - labelW;   // bar grows to the left from the label column
        return (
          <g key={i}>
            <text x={w - fs * 0.3} y={y + bh / 2 + fs * 0.35} textAnchor="end" fontSize={fs * 0.9} fill="#475569" fontWeight={600}>{trunc(d.label, 18)}</text>
            <rect x={xRight - bw} y={y} width={bw} height={bh} rx={Math.min(3, bh / 3)} fill={d.color} />
            {showValues && <text x={xRight - bw - fs * 0.3} y={y + bh / 2 + fs * 0.35} textAnchor="end" fontSize={fs * 0.9} fontWeight={800} fill="#334155">{fmt(d.value)}</text>}
          </g>
        );
      })}
    </g>
  );
}

function Line({ data, w, h, fs, showValues }: { data: ChartDatum[]; w: number; h: number; fs: number; showValues: boolean }) {
  const padB = fs * 2.4, padT = fs * 1.4, padX = fs * 1.2;
  const max = Math.max(...data.map((d) => d.value), 1);
  const plotW = w - padX * 2, plotH = h - padB - padT;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({ x: w - padX - step * i, y: padT + plotH - (d.value / max) * plotH }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return (
    <g>
      <line x1={padX} x2={w - padX} y1={h - padB} y2={h - padB} stroke="#cbd5e1" strokeWidth={0.8} />
      <path d={path} fill="none" stroke={data[0]?.color ?? '#4f46e5'} strokeWidth={Math.max(1, fs * 0.22)} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={fs * 0.32} fill="#fff" stroke={data[0]?.color ?? '#4f46e5'} strokeWidth={Math.max(1, fs * 0.18)} />
          {showValues && <text x={p.x} y={p.y - fs * 0.6} textAnchor="middle" fontSize={fs * 0.85} fontWeight={800} fill="#334155">{fmt(data[i].value)}</text>}
          <text x={p.x} y={h - padB + fs * 1.2} textAnchor="middle" fontSize={fs * 0.8} fill="#475569" fontWeight={600}>{trunc(data[i].label, Math.max(3, Math.floor(step / (fs * 0.5)) || 8))}</text>
        </g>
      ))}
    </g>
  );
}

function Pie({ data, w, h, fs, donut, showValues }: { data: ChartDatum[]; w: number; h: number; fs: number; donut: boolean; showValues: boolean }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const r = Math.min(w, h) / 2 - fs * 0.5;
  const cx = w / 2, cy = h / 2;
  const inner = donut ? r * 0.55 : 0;
  let a0 = -Math.PI / 2;
  const arcs = data.map((d) => {
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    const arc = { d, a0, a1 };
    a0 = a1;
    return arc;
  });
  const pt = (a: number, rad: number) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  return (
    <g>
      {arcs.map(({ d, a0, a1 }, i) => {
        if (d.value <= 0) return null;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
        let path: string;
        if (a1 - a0 >= Math.PI * 2 - 1e-6) {
          path = `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`;
          if (inner) path += ` M${cx + inner} ${cy} A${inner} ${inner} 0 1 0 ${cx - inner} ${cy} A${inner} ${inner} 0 1 0 ${cx + inner} ${cy}`;
        } else if (inner) {
          const [ix0, iy0] = pt(a0, inner), [ix1, iy1] = pt(a1, inner);
          path = `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} L${ix1} ${iy1} A${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`;
        } else {
          path = `M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
        }
        const mid = (a0 + a1) / 2;
        const [lx, ly] = pt(mid, inner ? (r + inner) / 2 : r * 0.62);
        const pct = (d.value / total) * 100;
        return (
          <g key={i}>
            <path d={path} fill={d.color} stroke="#fff" strokeWidth={Math.max(0.8, fs * 0.12)} fillRule="evenodd" />
            {showValues && pct >= 5 && <text x={lx} y={ly + fs * 0.35} textAnchor="middle" fontSize={fs * 0.85} fontWeight={800} fill="#fff">{fmt(pct)}٪</text>}
          </g>
        );
      })}
      {donut && <text x={cx} y={cy + fs * 0.4} textAnchor="middle" fontSize={fs * 1.3} fontWeight={800} fill="#334155">{fmt(total)}</text>}
    </g>
  );
}
