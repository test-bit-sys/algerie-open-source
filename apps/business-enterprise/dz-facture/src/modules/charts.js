/**
 * DZ-Facture: Pure SVG Financial Charts & Business Analytics
 * 100% Offline, Zero External Libraries, Lightweight, High Performance.
 */

import { toLocalDateKey } from './dates.js';

export class BusinessCharts {
  /**
   * Renders a responsive 7-Day Revenue SVG Bar & Area Trend Chart
   */
  static renderWeeklySalesChart(container, invoices = [], lang = 'ar') {
    if (!container) return;

    // Build last 7 days buckets with trilingual day names
    const days = [];
    const dayNamesMap = {
      ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
      fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
      en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    };
    const dayNames = dayNamesMap[lang] || dayNamesMap.ar;
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = toLocalDateKey(d);
      const dayName = dayNames[d.getDay()];
      days.push({ date: dateStr, name: dayName, total: 0 });
    }

    // Aggregate invoice sales by day
    invoices.forEach(inv => {
      const invDate = toLocalDateKey(inv.docDate || inv.createdAt);
      const bucket = days.find(d => d.date === invDate);
      if (bucket) {
        bucket.total += Number(inv.totalTTC) || 0;
      }
    });

    const maxVal = Math.max(...days.map(d => d.total), 50000);
    const width = 500;
    const height = 180;
    const padding = { top: 25, right: 20, bottom: 35, left: 55 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const barWidth = 34;
    const step = chartW / days.length;

    let barsSVG = '';
    let gridLinesSVG = '';
    let labelsSVG = '';

    // Draw horizontal grid lines (3 levels)
    for (let l = 0; l <= 3; l++) {
      const y = padding.top + (chartH / 3) * l;
      const val = Math.round(maxVal - (maxVal / 3) * l);
      gridLinesSVG += `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="currentColor" stroke-opacity="0.08" stroke-dasharray="3,3" />
        <text x="${padding.left - 8}" y="${y + 4}" font-size="9" fill="currentColor" opacity="0.6" text-anchor="end">${(val / 1000).toFixed(0)}k</text>
      `;
    }

    days.forEach((day, idx) => {
      const x = padding.left + idx * step + (step - barWidth) / 2;
      const barH = (day.total / maxVal) * chartH;
      const y = padding.top + (chartH - barH);

      barsSVG += `
        <g class="chart-bar-group">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barH, 3)}" rx="5" fill="url(#greenGrad)" opacity="0.9" style="transition:all 0.3s ease;">
            <title>${day.date} (${day.name}): ${day.total.toLocaleString('fr-DZ')} دج</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 6}" font-size="8.5" font-weight="700" fill="#008744" text-anchor="middle">
            ${day.total > 0 ? (day.total >= 1000 ? (day.total / 1000).toFixed(1) + 'k' : day.total) : ''}
          </text>
        </g>
      `;

      labelsSVG += `
        <text x="${x + barWidth / 2}" y="${height - 12}" font-size="10" font-weight="600" fill="currentColor" opacity="0.75" text-anchor="middle">${day.name}</text>
      `;
    });

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" style="overflow:visible;">
        <defs>
          <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#008744" />
            <stop offset="100%" stop-color="#02a654" stop-opacity="0.7" />
          </linearGradient>
        </defs>
        ${gridLinesSVG}
        ${barsSVG}
        ${labelsSVG}
      </svg>
    `;
  }

  /**
   * Renders Payment Breakdown Donut Chart
   */
  static renderPaymentDonut(container, invoices = [], lang = 'ar') {
    if (!container) return;

    const totals = {
      ESPECES: 0,
      VIREMENT: 0,
      CHEQUE: 0,
      A_TERME: 0
    };

    let grand = 0;
    invoices.forEach(inv => {
      const m = inv.paymentMethod || 'ESPECES';
      const amt = Number(inv.totalTTC) || 0;
      if (totals[m] !== undefined) totals[m] += amt;
      else totals.ESPECES += amt;
      grand += amt;
    });

    if (grand === 0) grand = 1;

    const colors = {
      ESPECES: '#008744',
      VIREMENT: '#0284c7',
      CHEQUE: '#d97706',
      A_TERME: '#dc2626'
    };

    const labelsMap = {
      ar: { ESPECES: 'نقداً', VIREMENT: 'تحويل', CHEQUE: 'شيك', A_TERME: 'كريدي' },
      fr: { ESPECES: 'Espèces', VIREMENT: 'Virement', CHEQUE: 'Chèque', A_TERME: 'Crédit' },
      en: { ESPECES: 'Cash', VIREMENT: 'Transfer', CHEQUE: 'Cheque', A_TERME: 'Credit' }
    };
    const labels = labelsMap[lang] || labelsMap.ar;

    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    let accumulatedOffset = 0;
    let circles = '';
    let legend = '';

    Object.keys(totals).forEach(k => {
      const val = totals[k];
      const pct = val / grand;
      const strokeDash = pct * circumference;
      const strokeOffset = circumference - accumulatedOffset;

      if (val > 0) {
        circles += `
          <circle cx="55" cy="55" r="${radius}" fill="transparent" stroke="${colors[k]}" stroke-width="16"
                  stroke-dasharray="${strokeDash} ${circumference}"
                  stroke-dashoffset="${strokeOffset}"
                  transform="rotate(-90 55 55)" />
        `;
      }

      legend += `
        <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.75rem; gap:0.5rem;">
          <span style="display:flex; align-items:center; gap:4px;">
            <span style="width:8px; height:8px; border-radius:50%; background:${colors[k]};"></span>
            <span>${labels[k]}</span>
          </span>
          <span style="font-weight:700;">${(pct * 100).toFixed(0)}%</span>
        </div>
      `;

      accumulatedOffset += strokeDash;
    });

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-around; width:100%; height:100%;">
        <svg width="110" height="110" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r="${radius}" fill="transparent" stroke="currentColor" stroke-opacity="0.08" stroke-width="16" />
          ${circles}
          <text x="55" y="58" font-size="10" font-weight="800" fill="currentColor" text-anchor="middle">DZ-Pay</text>
        </svg>
        <div style="display:flex; flex-direction:column; gap:4px; min-width:110px;">
          ${legend}
        </div>
      </div>
    `;
  }
}
