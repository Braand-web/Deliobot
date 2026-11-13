import { h, type Html } from "../pages.ts";

export interface Series { name: string; color: string; values: number[] }

const H = 220, PAD_L = 44, PAD_B = 26, PAD_T = 10;

const dayLabel = (day: string) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= value) ?? value;
}

/** Grouped bars per day on one axis, a legend for two series or more, and a hover tooltip per day. */
/** `width`: the drawing's width in the same units as its text, so a full-width chart keeps small labels. */
export function barChart(days: readonly string[], series: readonly Series[], format: (value: number) => string, label: string, W = 720): Html {
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values)));
  const plotW = W - PAD_L - 6, plotH = H - PAD_B - PAD_T;
  const slot = plotW / Math.max(1, days.length);
  const gap = 2;
  const barW = Math.max(2, Math.min(14, (slot - 6) / series.length - gap));
  const y = (value: number) => PAD_T + plotH - (value / max) * plotH;
  const grid = [0, 0.5, 1].map((share) => h`<line x1="${PAD_L}" x2="${W - 6}" y1="${y(max * share)}" y2="${y(max * share)}" class="grid"/>
<text x="${PAD_L - 8}" y="${y(max * share) + 4}" text-anchor="end" class="tick">${format(max * share)}</text>`);
  const every = Math.ceil(days.length / 7);
  const groups = days.map((day, index) => {
    const x0 = PAD_L + index * slot + (slot - series.length * (barW + gap)) / 2;
    const bars = series.map((item, n) => {
      const value = item.values[index] ?? 0;
      const top = y(value), height = Math.max(0, PAD_T + plotH - top);
      return height > 0 ? h`<path d="${roundedTop(x0 + n * (barW + gap), top, barW, height)}" fill="${item.color}"/>` : "";
    });
    const tip = `${dayLabel(day)} · ${series.map((item) => `${item.name} ${format(item.values[index] ?? 0)}`).join(" · ")}`;
    return h`<g class="hit"><rect x="${PAD_L + index * slot}" y="${PAD_T}" width="${slot}" height="${plotH}" fill="transparent"><title>${tip}</title></rect>${bars}</g>
${index % every === 0 || index === days.length - 1 ? h`<text x="${PAD_L + index * slot + slot / 2}" y="${H - 6}" text-anchor="middle" class="tick">${dayLabel(day)}</text>` : ""}`;
  });
  const legend = series.length > 1 ? h`<div class="legend">${series.map((item) => h`<span><i style="background:${item.color}"></i>${item.name}</span>`)}</div>` : "";
  return h`${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${grid}${groups}</svg>`;
}

function roundedTop(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function sparkline(values: readonly number[]): Html {
  if (values.length < 2) return h``;
  const max = Math.max(...values), min = Math.min(...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - ((value - min) / (max - min || 1)) * 26}`).join(" ");
  return h`<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="var(--s1)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

/** A ring split by share, with a 2px gap between segments, and its legend carrying every value. */
export function donut(parts: ReadonlyArray<{ label: string; value: number; color: string }>, center: string, caption: string): Html {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 42, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs = total > 0 ? parts.filter((part) => part.value > 0).map((part) => {
    const length = (part.value / total) * circumference;
    const arc = h`<circle r="${radius}" cx="60" cy="60" fill="none" stroke="${part.color}" stroke-width="14" stroke-dasharray="${Math.max(0, length - 2)} ${circumference}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"><title>${part.label} : ${part.value}</title></circle>`;
    offset += length;
    return arc;
  }) : [h`<circle r="${radius}" cx="60" cy="60" fill="none" stroke="var(--line)" stroke-width="14"/>`];
  return h`<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${caption}">${arcs}<text x="60" y="58" text-anchor="middle" class="donut-n">${center}</text>
<text x="60" y="76" text-anchor="middle" class="tick">${caption}</text></svg>
<ul class="legend-list">${parts.map((part) => h`<li><i style="background:${part.color}"></i><span>${part.label}</span><b>${new Intl.NumberFormat("fr-FR").format(part.value)}</b></li>`)}</ul></div>`;
}

/** A ranked list: label, a thin bar for its share of the largest, and its value. */
export function ranking(rows: ReadonlyArray<{ label: string; value: number; hint?: string }>, empty: string): Html {
  if (rows.length === 0) return h`<p class="empty">${empty}</p>`;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return h`<ul class="rank">${rows.map((row) => h`<li title="${row.hint ?? `${row.label} : ${row.value}`}"><span class="rank-label">${row.label}</span><b>${new Intl.NumberFormat("fr-FR").format(row.value)}</b>
<span class="rank-bar"><i style="width:${Math.max(2, (row.value / max) * 100)}%"></i></span></li>`)}</ul>`;
}

export function funnel(steps: ReadonlyArray<[string, number]>): Html {
  const first = Math.max(steps[0]?.[1] ?? 0, 1);
  return h`<ol class="funnel">${steps.map(([label, value], index) => {
    const previous = index > 0 ? steps[index - 1]![1] : null;
    const rate = previous && value <= previous ? `${Math.round((value / previous) * 100)} %` : "";
    return h`<li><div class="funnel-head"><span>${label}</span><b>${new Intl.NumberFormat("fr-FR").format(value)}</b>${rate ? h`<em>${rate} de l'étape précédente</em>` : ""}</div>
<span class="rank-bar"><i style="width:${Math.max(1, (value / first) * 100)}%"></i></span></li>`;
  })}</ol>`;
}
