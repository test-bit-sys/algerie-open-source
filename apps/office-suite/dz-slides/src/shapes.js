/**
 * DZ-Slides: Vector Shapes & Infographic Components Generator
 * 100% Offline-First | Pure SVG & HTML5 Components | Zero External Assets
 */

export const SHAPES_DEFINITIONS = [
  {
    id: 'rect',
    nameAr: 'مستطيل قياسي',
    nameFr: 'Rectangle',
    nameEn: 'Rectangle',
    category: 'basic',
    generateHTML(color = '#3b82f6') {
      return `<div style="width: 100%; height: 100%; background: ${color}; border-radius: 4px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);"></div>`;
    }
  },
  {
    id: 'rounded-card',
    nameAr: 'بطاقة بزوايا مستديرة',
    nameFr: 'Carte arrondie',
    nameEn: 'Rounded Card',
    category: 'basic',
    generateHTML(color = '#ffffff') {
      return `<div style="width: 100%; height: 100%; background: ${color}; border: 2px solid #cbd5e1; border-radius: 14px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.08); padding: 16px; box-sizing: border-box;"><h3 style="color:#0f172a; margin:0 0 8px 0; font-size:14pt;">عنوان البطاقة</h3><p style="color:#64748b; font-size:11pt; line-height:1.6; margin:0;">أدخل النص التوضيحي أو النقاط الهامة هنا...</p></div>`;
    }
  },
  {
    id: 'circle',
    nameAr: 'دائرة منتظمة',
    nameFr: 'Cercle',
    nameEn: 'Circle',
    category: 'basic',
    generateHTML(color = '#ea580c') {
      return `<div style="width: 100%; height: 100%; background: ${color}; border-radius: 50%; box-shadow: 0 4px 10px rgba(0,0,0,0.15);"></div>`;
    }
  },
  {
    id: 'arrow-right',
    nameAr: 'سهم توجيهي (يمين)',
    nameFr: 'Flèche droite',
    nameEn: 'Arrow Right',
    category: 'arrows',
    generateHTML(color = '#059669') {
      return `<svg viewBox="0 0 100 60" style="width: 100%; height: 100%; overflow: visible;" preserveAspectRatio="none"><path d="M0,20 L60,20 L60,0 L100,30 L60,60 L60,40 L0,40 Z" fill="${color}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"/></svg>`;
    }
  },
  {
    id: 'arrow-left',
    nameAr: 'سهم توجيهي (يسار)',
    nameFr: 'Flèche gauche',
    nameEn: 'Arrow Left',
    category: 'arrows',
    generateHTML(color = '#059669') {
      return `<svg viewBox="0 0 100 60" style="width: 100%; height: 100%; overflow: visible;" preserveAspectRatio="none"><path d="M100,20 L40,20 L40,0 L0,30 L40,60 L40,40 L100,40 Z" fill="${color}" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"/></svg>`;
    }
  },
  {
    id: 'star',
    nameAr: 'نجمة خماسية',
    nameFr: 'Étoile à 5 branches',
    nameEn: '5-Point Star',
    category: 'symbols',
    generateHTML(color = '#f59e0b') {
      return `<svg viewBox="0 0 100 100" style="width: 100%; height: 100%;"><polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" fill="${color}" filter="drop-shadow(0 2px 6px rgba(0,0,0,0.25))"/></svg>`;
    }
  },
  {
    id: 'algeria-badge',
    nameAr: 'شعار الهلال والنجمة الجزائري',
    nameFr: 'Emblème Étoile & Croissant',
    nameEn: 'Algerian Crescent & Star Badge',
    category: 'national',
    generateHTML() {
      return `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle, #ffffff 60%, #f1f5f9 100%); border: 3px solid #047857; border-radius: 50%; box-shadow: 0 4px 12px rgba(0,0,0,0.15);"><svg viewBox="0 0 100 100" style="width: 75%; height: 75%;"><circle cx="45" cy="50" r="32" fill="#dc2626"/><circle cx="53" cy="50" r="26" fill="#ffffff"/><polygon points="58,40 62,48 71,48 64,53 66,62 58,56 50,62 52,53 45,48 54,48" fill="#dc2626"/></svg></div>`;
    }
  },
  {
    id: 'callout',
    nameAr: 'فقاعة محادثة وتنبيه',
    nameFr: 'Bulle de dialogue',
    nameEn: 'Speech Bubble',
    category: 'callouts',
    generateHTML(color = '#eff6ff') {
      return `<div style="width: 100%; height: 100%; background: ${color}; border: 2px solid #bfdbfe; border-radius: 12px; padding: 14px; position: relative; box-sizing: border-box;"><p style="margin: 0; color: #1e40af; font-size: 11pt; line-height: 1.5; font-weight: 600;">ملاحظة أو تنبيه رئيسي للمناقشة...</p><div style="position: absolute; bottom: -12px; right: 28px; width: 0; height: 0; border-left: 12px solid transparent; border-right: 12px solid transparent; border-top: 12px solid #bfdbfe;"></div></div>`;
    }
  },
  {
    id: 'kpi-metric',
    nameAr: 'بطاقة مؤشر رقمي (KPI Metric)',
    nameFr: 'Indicateur Clé KPI',
    nameEn: 'Key Metric Card',
    category: 'data',
    generateHTML() {
      return `<div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border: 1px solid #334155; border-radius: 12px; padding: 18px; text-align: center; color: #ffffff; width: 100%; height: 100%; box-sizing: border-box; box-shadow: 0 6px 16px rgba(0,0,0,0.2);"><span style="color: #38bdf8; font-size: 11pt; font-weight: bold; text-transform: uppercase;">نسبة الإنجاز</span><h2 style="color: #10b981; font-size: 32pt; margin: 6px 0; font-family: monospace; font-weight: 800;">98.5%</h2><p style="color: #94a3b8; font-size: 10pt; margin: 0;">الولاية: الجزائر العاصمة</p></div>`;
    }
  },
  {
    id: 'data-table',
    nameAr: 'جدول بيانات تنفيذي 3×3',
    nameFr: 'Tableau de Données 3x3',
    nameEn: '3x3 Executive Table',
    category: 'data',
    generateHTML() {
      return `<table style="width: 100%; height: 100%; border-collapse: collapse; font-size: 11pt; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); text-align: right;"><thead style="background: #1e3a8a; color: #ffffff;"><tr><th style="padding: 8px 12px; border: 1px solid #3b82f6;">المرحلة</th><th style="padding: 8px 12px; border: 1px solid #3b82f6;">النشاط المنجز</th><th style="padding: 8px 12px; border: 1px solid #3b82f6;">الحالة</th></tr></thead><tbody><tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">01</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">تحليل المتطلبات</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: bold;">مكتمل 100%</td></tr><tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">02</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">التطوير البرمجي</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: #16a34a; font-weight: bold;">مكتمل 100%</td></tr><tr><td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: 600;">03</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0;">الاختبار الميداني</td><td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: #2563eb; font-weight: bold;">قيد التنفيذ</td></tr></tbody></table>`;
    }
  },
  {
    id: 'donut-chart',
    nameAr: 'مخطط دائري بياني (Donut Chart)',
    nameFr: 'Graphique Donut SVG',
    nameEn: 'Donut Percentage Chart',
    category: 'charts',
    generateHTML() {
      return `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; box-sizing: border-box; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);"><svg viewBox="0 0 120 120" style="width: 100%; height: 100%;"><circle cx="60" cy="60" r="45" fill="none" stroke="#e2e8f0" stroke-width="16"/><circle cx="60" cy="60" r="45" fill="none" stroke="#10b981" stroke-width="16" stroke-dasharray="283" stroke-dashoffset="70" transform="rotate(-90 60 60)"/><text x="60" y="65" text-anchor="middle" font-family="monospace" font-size="20" font-weight="bold" fill="#0f172a">75%</text></svg></div>`;
    }
  },
  {
    id: 'code-block',
    nameAr: 'حاوية شيفرة برمجية (Code Block)',
    nameFr: 'Bloc de Code Source',
    nameEn: 'Source Code Snippet',
    category: 'dev',
    generateHTML() {
      return `<div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 14px; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 10pt; color: #e2e8f0; width: 100%; height: 100%; box-sizing: border-box; direction: ltr; text-align: left; overflow: hidden;"><div style="color: #64748b; margin-bottom: 8px; border-bottom: 1px solid #1e293b; padding-bottom: 4px;">// Algerian Sovereign Algorithm</div><div><span style="color: #f43f5e;">const</span> <span style="color: #38bdf8;">ecosystem</span> = <span style="color: #f43f5e;">new</span> <span style="color: #fbbf24;">DZSuite</span>({</div><div style="padding-left: 18px;">offline: <span style="color: #a7f3d0;">true</span>,</div><div style="padding-left: 18px;">wilayas: <span style="color: #f59e0b;">58</span>,</div><div style="padding-left: 18px;">currency: <span style="color: #a7f3d0;">'DZD'</span></div><div>});</div></div>`;
    }
  }
];
