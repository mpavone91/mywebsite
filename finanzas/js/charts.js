import { eur } from './utils.js';

// Chart.js se carga como script clásico desde /vendor (ver index.html).
const Chart = window.Chart;

/**
 * Envoltorio fino sobre Chart.js.
 * Los colores salen de las custom properties del CSS para que los gráficos
 * sigan al tema claro/oscuro sin duplicar la paleta.
 */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const registry = new Map();

function mount(canvas, config) {
  registry.get(canvas)?.destroy();
  const chart = new Chart(canvas, config);
  registry.set(canvas, chart);
  return chart;
}

export function destroyCharts() {
  for (const chart of registry.values()) chart.destroy();
  registry.clear();
}

const gridColor = () => cssVar('--border', '#e4e7ec');
const textColor = () => cssVar('--text-2', '#5b6472');

const tooltipStyle = () => ({
  backgroundColor: cssVar('--text', '#10151f'),
  titleColor: cssVar('--bg', '#fff'),
  bodyColor: cssVar('--bg', '#fff'),
  padding: 10,
  cornerRadius: 8,
  displayColors: false,
});

/** Donut de gasto por categoría. `rows` = salida de categoryBreakdown(). */
export function categoryDonut(canvas, rows) {
  const total = rows.reduce((a, r) => a + r.total, 0);

  return mount(canvas, {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [{
        data: rows.map((r) => r.total),
        backgroundColor: rows.map((r) => r.color),
        borderColor: cssVar('--surface', '#fff'),
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            label: (ctx) => {
              const share = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
              return ` ${eur(ctx.parsed)} · ${share} %`;
            },
          },
        },
      },
    },
  });
}

/** Barras agrupadas: ingresos vs gastos de los últimos meses. */
export function incomeVsExpenseBars(canvas, series) {
  return mount(canvas, {
    type: 'bar',
    data: {
      labels: series.map((s) => s.label),
      datasets: [
        {
          label: 'Ingresos',
          data: series.map((s) => s.income),
          backgroundColor: cssVar('--pos', '#087f5b'),
          borderRadius: 5,
          maxBarThickness: 22,
        },
        {
          label: 'Gastos',
          data: series.map((s) => s.expense),
          backgroundColor: cssVar('--neg', '#c92a2a'),
          borderRadius: 5,
          maxBarThickness: 22,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor(), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor() }, border: { color: gridColor() } },
        y: {
          beginAtZero: true,
          grid: { color: gridColor() },
          border: { display: false },
          ticks: { color: textColor(), callback: (v) => eur(v, true) },
        },
      },
    },
  });
}

/** Línea de gasto acumulado del mes, con la proyección punteada hasta fin de mes. */
export function cumulativeSpendLine(canvas, { days, spent, projected }) {
  return mount(canvas, {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        {
          label: 'Gastado',
          data: spent,
          borderColor: cssVar('--accent', '#4f46e5'),
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: .25,
          spanGaps: false,
        },
        {
          label: 'Proyección',
          data: projected,
          borderColor: cssVar('--text-3', '#8b95a3'),
          borderDash: [5, 5],
          borderWidth: 2,
          pointRadius: 0,
          tension: .25,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: textColor(), boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle' },
        },
        tooltip: {
          ...tooltipStyle(),
          callbacks: {
            title: (items) => `Día ${items[0].label}`,
            label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}`),
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor(), maxTicksLimit: 8 }, border: { color: gridColor() } },
        y: {
          beginAtZero: true,
          grid: { color: gridColor() },
          border: { display: false },
          ticks: { color: textColor(), callback: (v) => eur(v, true) },
        },
      },
    },
  });
}
