import { escapeHtml, formatCompact, formatNumber } from "./formatters.js";

const MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

function monthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return MONTH_FORMATTER.format(new Date(Date.UTC(year, monthNumber - 1, 1)))
    .replace(/\./g, "")
    .replace(" de ", " ");
}

function barChart(items, valueKey, options) {
  if (!items.length) {
    return '<div class="chart-empty">Sin datos con fecha en este alcance.</div>';
  }

  const width = 760;
  const height = 250;
  const padding = { top: 20, right: 18, bottom: 44, left: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...items.map((item) => Number(item[valueKey]) || 0), 1);
  const slotWidth = plotWidth / items.length;
  const barWidth = Math.max(5, Math.min(30, slotWidth * 0.62));
  const labelEvery = Math.max(1, Math.ceil(items.length / 9));
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = (maxValue / 4) * index;
    const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
    return `
      <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid-line"></line>
      <text x="${padding.left - 9}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${escapeHtml(options.axisFormat(value))}</text>
    `;
  }).join("");

  const bars = items
    .map((item, index) => {
      const value = Number(item[valueKey]) || 0;
      const barHeight = value === 0 ? 2 : (value / maxValue) * plotHeight;
      const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
      const y = padding.top + plotHeight - barHeight;
      const showLabel = index % labelEvery === 0 || index === items.length - 1;
      return `
        <g class="chart-bar-group">
          <title>${escapeHtml(monthLabel(item.month))}: ${escapeHtml(options.tooltipFormat(value))}</title>
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="${Math.min(5, barWidth / 2)}" fill="${options.color}"></rect>
          ${showLabel ? `<text x="${x + barWidth / 2}" y="${height - 19}" text-anchor="middle" class="chart-axis-label">${escapeHtml(monthLabel(item.month))}</text>` : ""}
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.ariaLabel)}">
      ${grid}
      <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}" class="chart-axis-line"></line>
      ${bars}
    </svg>
  `;
}

function updateSummary(element, total, count, suffix) {
  if (!element) return;
  const average = count ? total / count : 0;
  element.textContent = `${formatNumber(total)} ${suffix} · ${formatNumber(average)} por mes`;
}

export function renderMonthlyCharts(monthlySeries) {
  const items = monthlySeries?.items || [];
  const definitions = [
    {
      chartId: "monthlyPostsChart",
      summaryId: "monthlyPostsSummary",
      valueKey: "posts",
      color: "#3b6ef5",
      suffix: "publicaciones",
      ariaLabel: "Publicaciones por mes",
    },
    {
      chartId: "monthlyLikesChart",
      summaryId: "monthlyLikesSummary",
      valueKey: "likes",
      color: "#ef5f57",
      suffix: "likes",
      ariaLabel: "Likes por mes",
    },
    {
      chartId: "monthlyCollaborationsChart",
      summaryId: "monthlyCollaborationsSummary",
      valueKey: "collaborations",
      color: "#1d9a6c",
      suffix: "colaboraciones",
      ariaLabel: "Colaboraciones por mes",
    },
  ];

  for (const definition of definitions) {
    const container = document.getElementById(definition.chartId);
    if (!container) continue;
    container.innerHTML = barChart(items, definition.valueKey, {
      color: definition.color,
      ariaLabel: definition.ariaLabel,
      axisFormat: formatCompact,
      tooltipFormat: formatNumber,
    });
    updateSummary(
      document.getElementById(definition.summaryId),
      items.reduce((total, item) => total + Number(item[definition.valueKey] || 0), 0),
      items.length,
      definition.suffix,
    );
  }
}
