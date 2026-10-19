/**
 * DZ-Slides (DZ-Impress Pro) — Authentic Algerian Presentation Templates
 * Tailored for Algerian Universities (USTHB, UMC, ESI, ENP), Startup Incubators,
 * and National Enterprises (Sonatrach, Algérie Télécom).
 * 100% Offline-First | Vector SVG Graphics | Professional 16:9 Aspect Ratio
 */

export const SLIDE_TEMPLATES = [
  {
    id: 'soutenance-pfe',
    nameAr: 'مذكرة تخرج جامعية (Soutenance PFE / Master / Doctorat)',
    nameFr: 'Soutenance de Thèse Universitaire (PFE / Master / Doctorat)',
    nameEn: 'Algerian University Thesis Defense (PFE / Master / PhD)',
    category: 'academic',
    descriptionAr: 'قالب رسمي كامل من 7 شرائح معتمد في كليات الهندسة والإعلام الآلي بالجامعات الجزائرية.',
    slides: [
      {
        id: 'pfe-1',
        title: 'واجهة المذكرة الرسمية',
        bg: 'linear-gradient(135deg, #091e3a 0%, #102a4e 50%, #0d3830 100%)',
        textColor: '#ffffff',
        elements: [
          {
            id: 'el-1',
            type: 'text',
            x: 60,
            y: 30,
            w: 840,
            h: 60,
            content: '<p style="text-align: center; color: #38bdf8; font-size: 13pt; margin: 0; font-weight: 700;">الجمهورية الجزائرية الديمقراطية الشعبية — وزارة التعليم العالي والبحث العلمي</p><p style="text-align: center; color: #94a3b8; font-size: 11pt; margin: 4px 0 0 0;">جامعة هواري بومدين للعلوم والتكنولوجيا (USTHB) — كلية الإعلام الآلي والذكاء الاصطناعي</p>'
          },
          {
            id: 'el-2',
            type: 'text',
            x: 60,
            y: 120,
            w: 840,
            h: 120,
            content: '<div style="text-align: center; background: rgba(255,255,255,0.06); border: 1px solid rgba(56,189,248,0.3); border-radius: 12px; padding: 18px 24px;"><span style="color: #34d399; font-size: 12pt; font-weight: 800; letter-spacing: 1px; display: block; margin-bottom: 6px;">مذكرة لنيل شهادة الماستر الأكاديمي في الإعلام الآلي</span><h1 style="color: #ffffff; font-size: 23pt; margin: 0; line-height: 1.4; font-weight: 800;">تصميم وبناء بيئة حوسبة مكتبية سيادية مفتوحة المصدر 100% بدون خوادم خارجية</h1></div>'
          },
          {
            id: 'el-3',
            type: 'text',
            x: 80,
            y: 280,
            w: 380,
            h: 120,
            content: '<div style="background: rgba(15,23,42,0.6); border-right: 4px solid #38bdf8; padding: 12px 16px; border-radius: 8px; font-size: 12pt; line-height: 1.8; color: #f8fafc;"><strong style="color: #38bdf8;">إعداد الطالبين:</strong><br>• عبد القادر بن عيسى (رقم القيد: 212131054)<br>• سفيان منصوري (رقم القيد: 212131089)</div>'
          },
          {
            id: 'el-4',
            type: 'text',
            x: 500,
            y: 280,
            w: 380,
            h: 120,
            content: '<div style="background: rgba(15,23,42,0.6); border-right: 4px solid #10b981; padding: 12px 16px; border-radius: 8px; font-size: 12pt; line-height: 1.8; color: #f8fafc;"><strong style="color: #10b981;">تحت إشراف الأستاذ:</strong><br>• أ. د. بلقاسم مزيان (أستاذ التعليم العالي)<br><span style="color: #94a3b8; font-size: 10.5pt;">رئيس لجنة المناقشة: د. كريم سعيدي</span></div>'
          },
          {
            id: 'el-5',
            type: 'text',
            x: 60,
            y: 440,
            w: 840,
            h: 40,
            content: '<p style="text-align: center; color: #cbd5e1; font-size: 11.5pt; margin: 0; font-family: monospace;">السنة الجامعية: 2025 / 2026 — الجزائر العاصمة</p>'
          }
        ]
      },
      {
        id: 'pfe-2',
        title: 'خطة العرض (Plan de Présentation)',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'el-6',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #091e3a; border-bottom: 3px solid #ea580c; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">خطة العرض (Plan de Présentation)</h2>'
          },
          {
            id: 'el-7',
            type: 'card',
            x: 60,
            y: 110,
            w: 840,
            h: 360,
            content: '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; height: 100%; box-sizing: border-box;"><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;"><h3 style="color: #ea580c; margin: 0 0 10px 0; font-size: 14pt;">القسم النظري والمنهجي:</h3><ol style="line-height: 2.2; font-size: 12pt; color: #334155; padding-right: 20px; margin: 0;"><li><strong>المقدمة وسياق البحث:</strong> مخاطر التبعية السحابية.</li><li><strong>الإشكالية وأهداف الدراسة:</strong> السيادة الرقمية.</li><li><strong>الدراسة المقارنة:</strong> تحليل برمجيات المكاتب العالمية.</li></ol></div><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px;"><h3 style="color: #059669; margin: 0 0 10px 0; font-size: 14pt;">القسم التطبيقي والتنفيذي:</h3><ol start="4" style="line-height: 2.2; font-size: 12pt; color: #334155; padding-right: 20px; margin: 0;"><li><strong>الهندسة المعمارية للنظام:</strong> معيار 100% Offline-First.</li><li><strong>التطوير الفعلي للمنظومة:</strong> معالجة الوثائق والعروض.</li><li><strong>النتائج والتقييم التجريبي:</strong> قياس استهلاك الذاكرة.</li><li><strong>الخاتمة والآفاق المستقبلية:</strong> مراحل التعميم الوطني.</li></ol></div></div>'
          }
        ]
      },
      {
        id: 'pfe-3',
        title: 'الإشكالية وسياق البحث',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'el-8',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #091e3a; border-bottom: 3px solid #059669; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">سياق البحث والإشكالية المطروحة</h2>'
          },
          {
            id: 'el-9',
            type: 'card',
            x: 60,
            y: 110,
            w: 400,
            h: 350,
            content: '<div style="background: #fff7ed; border: 2px solid #fdba74; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;"><div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;"><span style="background: #ea580c; color: #fff; font-size: 11pt; font-weight: bold; padding: 2px 8px; border-radius: 4px;">التحديات الراهنة</span><h3 style="color: #9a3412; margin: 0; font-size: 15pt;">معوقات البرمجيات الأجنبية</h3></div><ul style="line-height: 2.0; font-size: 11.5pt; color: #431407; padding-right: 20px; margin: 0;"><li>تكلفة الاشتراكات السنوية الباهظة بالعملة الصعبة.</li><li>تسريب البيانات الحساسة للشركات عبر السحابة الأجنبية.</li><li>انعدام التوافق التام مع اللغة العربية وقوانين الجباية الجزائرية.</li><li>توقف العمل فور انقطاع شبكة الإنترنت المحلية أو الدولية.</li></ul></div>'
          },
          {
            id: 'el-10',
            type: 'card',
            x: 480,
            y: 110,
            w: 420,
            h: 350,
            content: '<div style="background: #ecfdf5; border: 2px solid #6ee7b7; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;"><div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;"><span style="background: #059669; color: #fff; font-size: 11pt; font-weight: bold; padding: 2px 8px; border-radius: 4px;">الأهداف والحل</span><h3 style="color: #065f46; margin: 0; font-size: 15pt;">المقترح السيادي الجزائري</h3></div><ul style="line-height: 2.0; font-size: 11.5pt; color: #064e3b; padding-right: 20px; margin: 0;"><li>بناء بدائل سطح مكتبية مفتوحة المصدر 100% بنظام Offline-First.</li><li>تضمين النماذج الإدارية والأكاديمية الجزائرية كمعايير مدمجة.</li><li>صفر تكلفة رخص، بدون خوادم مراقبة أو تتبع للمستخدم.</li><li>سرعة إقلاع واستجابة فائقة تحت 50 مللي ثانية.</li></ul></div>'
          }
        ]
      },
      {
        id: 'pfe-4',
        title: 'الهندسة المعمارية للنظام (Architecture)',
        bg: '#0f172a',
        textColor: '#f8fafc',
        elements: [
          {
            id: 'el-11',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #38bdf8; border-bottom: 3px solid #10b981; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">الهندسة المعمارية للنظام (System Architecture)</h2>'
          },
          {
            id: 'el-12',
            type: 'card',
            x: 60,
            y: 110,
            w: 840,
            h: 360,
            content: '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; height: 100%; box-sizing: border-box;"><div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px; text-align: center;"><div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(56,189,248,0.15); color: #38bdf8; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; font-weight: 800; font-size: 18px;">1</div><h4 style="color: #38bdf8; font-size: 14pt; margin: 0 0 8px 0;">واجهة العرض والتفاعل</h4><p style="font-size: 11pt; color: #94a3b8; line-height: 1.7; margin: 0;">Vanilla JavaScript ES Modules، بدون أطر عمل خارجية، متوافقة 100% مع لغات الويب القياسية وواجهات RTL العربية.</p></div><div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px; text-align: center;"><div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(16,185,129,0.15); color: #10b981; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; font-weight: 800; font-size: 18px;">2</div><h4 style="color: #10b981; font-size: 14pt; margin: 0 0 8px 0;">محركات المعالجة المحلية</h4><p style="font-size: 11pt; color: #94a3b8; line-height: 1.7; margin: 0;">Web Audio API (تضخيم 300% والمعادل)، Canvas 2D (معالجة الشرائح والإطارات)، ومحلل الترميز العربي الذكي Windows-1256.</p></div><div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 18px; text-align: center;"><div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(245,158,11,0.15); color: #f59e0b; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; font-weight: 800; font-size: 18px;">3</div><h4 style="color: #f59e0b; font-size: 14pt; margin: 0 0 8px 0;">طبقة التخزين والتصدير</h4><p style="font-size: 11pt; color: #94a3b8; line-height: 1.7; margin: 0;">LocalStorage، IndexedDB، تصدير بصيغ مفتوحة (.dzslide, .m3u, PDF, PNG) مع تشغيل مستقل بدون إنترنت.</p></div></div>'
          }
        ]
      },
      {
        id: 'pfe-5',
        title: 'النتائج التجريبية ومؤشرات الأداء',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'el-13',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #091e3a; border-bottom: 3px solid #ea580c; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">النتائج التجريبية ومقارنة الأداء الفعلي</h2>'
          },
          {
            id: 'el-14',
            type: 'card',
            x: 60,
            y: 110,
            w: 260,
            h: 160,
            content: '<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px; text-align: center;"><span style="color: #166534; font-size: 11pt; font-weight: bold;">سرعة الإقلاع والتحميل</span><h3 style="color: #15803d; font-size: 28pt; margin: 8px 0; font-family: monospace;">&lt; 45ms</h3><p style="color: #475569; font-size: 10.5pt; margin: 0;">أسرع بـ 12 ضعفاً مقارنة بالحلول الثقيلة</p></div>'
          },
          {
            id: 'el-15',
            type: 'card',
            x: 350,
            y: 110,
            w: 260,
            h: 160,
            content: '<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 16px; text-align: center;"><span style="color: #1e40af; font-size: 11pt; font-weight: bold;">استهلاك ذاكرة RAM</span><h3 style="color: #2563eb; font-size: 28pt; margin: 8px 0; font-family: monospace;">~ 18 MB</h3><p style="color: #475569; font-size: 10.5pt; margin: 0;">أخف بنسبة 90% من تطبيقات Electron</p></div>'
          },
          {
            id: 'el-16',
            type: 'card',
            x: 640,
            y: 110,
            w: 260,
            h: 160,
            content: '<div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 16px; text-align: center;"><span style="color: #9a3412; font-size: 11pt; font-weight: bold;">الاعتمادية الخارجية</span><h3 style="color: #ea580c; font-size: 28pt; margin: 8px 0; font-family: monospace;">0 NPM</h3><p style="color: #475569; font-size: 10.5pt; margin: 0;">صفر مكتبات خارجية أو اتصالات مجهولة</p></div>'
          },
          {
            id: 'el-17',
            type: 'card',
            x: 60,
            y: 290,
            w: 840,
            h: 170,
            content: '<div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 16px;"><h4 style="color: #0f172a; margin: 0 0 10px 0; font-size: 13pt;">جدول مقارنة المعايير التشغيلية:</h4><table style="width: 100%; border-collapse: collapse; font-size: 11pt; text-align: right;"><tr style="background: #e2e8f0; font-weight: bold;"><th style="padding: 6px 10px;">المعيار</th><th style="padding: 6px 10px;">الحلول السحابية التجارية</th><th style="padding: 6px 10px; color: #047857;">المنظومة الجزائرية المفتوحة (DZ-Impress)</th></tr><tr><td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0;">العمل بدون إنترنت</td><td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; color: #dc2626;">محدود أو غير متاح</td><td style="padding: 6px 10px; border-bottom: 1px solid #e2e8f0; color: #16a34a; font-weight: bold;">أصيل ومستقل 100% (Offline-First)</td></tr><tr><td style="padding: 6px 10px;">خصوصية المستندات</td><td style="padding: 6px 10px; color: #dc2626;">تخزين سحابي بخوادم أجنبية</td><td style="padding: 6px 10px; color: #16a34a; font-weight: bold;">سيادة كاملة محلياً داخل جهاز الحاسوب</td></tr></table></div>'
          }
        ]
      },
      {
        id: 'pfe-6',
        title: 'الخاتمة والآفاق المستقبلية',
        bg: 'linear-gradient(135deg, #091e3a 0%, #064e3b 100%)',
        textColor: '#ffffff',
        elements: [
          {
            id: 'el-18',
            type: 'text',
            x: 60,
            y: 60,
            w: 840,
            h: 50,
            content: '<h2 style="color: #38bdf8; text-align: center; margin: 0; font-size: 24pt; font-weight: 800;">الخاتمة والآفاق المستقبلية</h2>'
          },
          {
            id: 'el-19',
            type: 'text',
            x: 80,
            y: 140,
            w: 800,
            h: 180,
            content: '<p style="text-align: center; font-size: 15pt; line-height: 2.1; color: #f1f5f9; margin: 0; background: rgba(255,255,255,0.06); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.15);">أثبتت هذه الدراسة قابلية الاستغناء التام عن حزم البرمجيات المكتبية الأجنبية باهظة التكلفة، عبر استبدالها ببدائل جزائرية أصيلة مفتوحة المصدر 100% وخفيفة الوزن، توفر أعلى معايير الأمان وتضمن السيادة الرقمية التامة على الوثائق الجامعية والإدارية الحساسة.</p>'
          },
          {
            id: 'el-20',
            type: 'text',
            x: 80,
            y: 350,
            w: 800,
            h: 80,
            content: '<h1 style="text-align: center; color: #fbbf24; font-size: 26pt; margin: 0; font-weight: 800;">شكراً جزيلاً لأعضاء اللجنة الموقرة وحسن استماعكم</h1><p style="text-align: center; color: #94a3b8; font-size: 13pt; margin: 6px 0 0 0;">نحن في استعداد تام لتلقي ملاحظاتكم وأسئلتكم القيمة</p>'
          }
        ]
      }
    ]
  },
  {
    id: 'startup-pitch',
    nameAr: 'عرض مشروع شركة ناشئة (Startup Pitch Deck — حاضنة أعمال)',
    nameFr: 'Pitch Deck Startup & Investisseurs (Algérie)',
    nameEn: 'Algerian Startup Investor Pitch Deck',
    category: 'business',
    descriptionAr: 'قالب عالي التأثير للمؤسسات الناشئة موجه للمستثمرين وصناديق التمويل الجزائرية (ASF / حاضنات الأعمال).',
    slides: [
      {
        id: 'sp-1',
        title: 'شريحة العنوان والرؤية',
        bg: 'linear-gradient(135deg, #18181b 0%, #27272a 50%, #451a03 100%)',
        textColor: '#ffffff',
        elements: [
          {
            id: 'sp-el-1',
            type: 'text',
            x: 60,
            y: 60,
            w: 840,
            h: 40,
            content: '<span style="color: #f97316; font-size: 12pt; font-weight: 800; letter-spacing: 2px;">STARTUP PITCH DECK — ALGERIA 2026</span>'
          },
          {
            id: 'sp-el-2',
            type: 'text',
            x: 60,
            y: 120,
            w: 840,
            h: 120,
            content: '<h1 style="color: #ffffff; font-size: 34pt; margin: 0; line-height: 1.3; font-weight: 800;">سويفت بيزنس — منصة الفوترة السحابية للمؤسسات الجزائرية</h1>'
          },
          {
            id: 'sp-el-3',
            type: 'text',
            x: 60,
            y: 260,
            w: 700,
            h: 60,
            content: '<p style="color: #fed7aa; font-size: 16pt; margin: 0; line-height: 1.6;">تبسيط وإدارة الفواتير والضرائب (TVA / TAP) والتفقيط بالدينار الجزائري بنقرة واحدة لـ 1.2 مليون تاجر ومهني في الـ 58 ولاية.</p>'
          },
          {
            id: 'sp-el-4',
            type: 'text',
            x: 60,
            y: 400,
            w: 840,
            h: 40,
            content: '<div style="font-size: 12pt; color: #a1a1aa; font-family: monospace;">تقديم: الفريق المؤسس • حاضنة الأعمال التكنولوجية الجزائرية</div>'
          }
        ]
      },
      {
        id: 'sp-2',
        title: 'المشكلة في السوق الجزائري',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'sp-el-5',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #ea580c; border-bottom: 3px solid #ea580c; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">المشكلة والفرصة في السوق الوطني</h2>'
          },
          {
            id: 'sp-el-6',
            type: 'card',
            x: 60,
            y: 110,
            w: 260,
            h: 220,
            content: '<div style="background: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;"><h3 style="color: #c2410c; margin: 0 0 10px 0; font-size: 15pt;">تعقيدات الجباية</h3><p style="color: #475569; font-size: 11.5pt; line-height: 1.7; margin: 0;">صعوبة حساب نسب الرسم على القيمة المضافة (TVA 9% / 19%) ورسم الطابع الجبائي يدوياً مما يوقع التجار في غرامات باهظة.</p></div>'
          },
          {
            id: 'sp-el-7',
            type: 'card',
            x: 350,
            y: 110,
            w: 260,
            h: 220,
            content: '<div style="background: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;"><h3 style="color: #c2410c; margin: 0 0 10px 0; font-size: 15pt;">غياب الدفع بالدينار</h3><p style="color: #475569; font-size: 11.5pt; line-height: 1.7; margin: 0;">البرمجيات العالمية تشترط الدفع باليورو أو الدولار ببطاقات دولية غير متوفرة لغالبية التجار الجزائريين والشركات الصغيرة.</p></div>'
          },
          {
            id: 'sp-el-8',
            type: 'card',
            x: 640,
            y: 110,
            w: 260,
            h: 220,
            content: '<div style="background: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;"><h3 style="color: #c2410c; margin: 0 0 10px 0; font-size: 15pt;">عدم توافق الورقيات</h3><p style="color: #475569; font-size: 11.5pt; line-height: 1.7; margin: 0;">الحلول الجاهزة تفتقد للأختام الرسمية وشروط الفواتير النظامية كأرقام السجل التجاري (RC) والتعريف الإحصائي (NIS/NIF).</p></div>'
          }
        ]
      },
      {
        id: 'sp-3',
        title: 'نموذج العمل وتوليد الإيرادات (Business Model)',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'sp-el-9',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #0f172a; border-bottom: 3px solid #10b981; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">نموذج العمل وتوليد الإيرادات بالدينار (DZD)</h2>'
          },
          {
            id: 'sp-el-10',
            type: 'card',
            x: 60,
            y: 110,
            w: 400,
            h: 340,
            content: '<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 22px; height: 100%; box-sizing: border-box;"><h3 style="color: #059669; font-size: 16pt; margin: 0 0 12px 0;">خطط الاشتراكات المرنة (SaaS):</h3><ul style="line-height: 2.1; font-size: 12pt; color: #334155; padding-right: 20px; margin: 0;"><li><strong>مجاني للأفراد:</strong> للمشاريع الفردية والمقاول الذاتي.</li><li><strong>باقة التاجر (PRO):</strong> 1,500 دج شهرياً مع دعم نقاط البيع.</li><li><strong>باقة الشركات (ENTERPRISE):</strong> 45,000 دج سنوياً مع ربط فروع الـ 58 ولاية وفواتير إلكترونية غير محدودة.</li></ul></div>'
          },
          {
            id: 'sp-el-11',
            type: 'card',
            x: 480,
            y: 110,
            w: 420,
            h: 340,
            content: '<div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 12px; padding: 22px; height: 100%; box-sizing: border-box;"><h3 style="color: #166534; font-size: 16pt; margin: 0 0 12px 0;">توقعات النمو في السوق الجزائري:</h3><div style="margin: 18px 0;"><span style="color: #15803d; font-size: 26pt; font-weight: 800; font-family: monospace;">+ 24,000</span><p style="color: #475569; font-size: 11pt; margin: 2px 0 14px 0;">مشترك نشط مستهدف في السنة الأولى</p><span style="color: #0d9488; font-size: 26pt; font-weight: 800; font-family: monospace;">36,000,000 دج</span><p style="color: #475569; font-size: 11pt; margin: 2px 0 0 0;">إيرادات سنوية متوقعة مع نقطة تعادل خلال 8 أشهر</p></div></div>'
          }
        ]
      }
    ]
  },
  {
    id: 'corporate-strategy',
    nameAr: 'تقرير استراتيجي ومؤشرات الأداء السنوية (Corporate Report)',
    nameFr: 'Rapport Stratégique & Indicateurs de Performance (KPI)',
    nameEn: 'Corporate Annual Strategy & KPI Report',
    category: 'corporate',
    descriptionAr: 'قالب مؤسساتي أنيق للشركات الوطنية الكبرى والوزارات لعرض مؤشرات الأداء السنوية ومحاور النمو.',
    slides: [
      {
        id: 'cr-1',
        title: 'واجهة التقرير السنوي',
        bg: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)',
        textColor: '#ffffff',
        elements: [
          {
            id: 'cr-el-1',
            type: 'text',
            x: 60,
            y: 80,
            w: 840,
            h: 40,
            content: '<span style="color: #a7f3d0; font-size: 13pt; font-weight: 700; letter-spacing: 1px;">التقرير السنوي لحصيلة الإنجازات وآفاق 2026</span>'
          },
          {
            id: 'cr-el-2',
            type: 'text',
            x: 60,
            y: 140,
            w: 840,
            h: 120,
            content: '<h1 style="color: #ffffff; font-size: 34pt; margin: 0; line-height: 1.3; font-weight: 800;">التحول الرقمي وتحديث البنية التحتية الوطنية</h1>'
          },
          {
            id: 'cr-el-3',
            type: 'text',
            x: 60,
            y: 280,
            w: 700,
            h: 60,
            content: '<p style="color: #d1fae5; font-size: 15pt; margin: 0; line-height: 1.7;">عرض شامل لتقدم المشاريع الاستراتيجية ومؤشرات النجاح عبر كافة المديريات الولائية الـ 58.</p>'
          }
        ]
      },
      {
        id: 'cr-2',
        title: 'أبرز المؤشرات الرقمية (KPI Dashboard)',
        bg: '#f8fafc',
        textColor: '#0f172a',
        elements: [
          {
            id: 'cr-el-4',
            type: 'text',
            x: 60,
            y: 35,
            w: 840,
            h: 55,
            content: '<h2 style="color: #064e3b; border-bottom: 3px solid #059669; padding-bottom: 8px; margin: 0; font-size: 20pt; font-weight: 800;">لوحة قياس المؤشرات التشغيلية السنوية</h2>'
          },
          {
            id: 'cr-el-5',
            type: 'card',
            x: 60,
            y: 110,
            w: 260,
            h: 150,
            content: '<div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); text-align: center;"><span style="color: #64748b; font-size: 11pt;">نسبة رقمنة المعاملات</span><h3 style="color: #059669; font-size: 28pt; margin: 6px 0; font-family: monospace;">87.4%</h3><span style="color: #10b981; font-size: 10.5pt; font-weight: bold;">+ 24% مقارنة بالعام السابق</span></div>'
          },
          {
            id: 'cr-el-6',
            type: 'card',
            x: 350,
            y: 110,
            w: 260,
            h: 150,
            content: '<div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); text-align: center;"><span style="color: #64748b; font-size: 11pt;">تقليص استهلاك الورق</span><h3 style="color: #2563eb; font-size: 28pt; margin: 6px 0; font-family: monospace;">- 65%</h3><span style="color: #3b82f6; font-size: 10.5pt; font-weight: bold;">وفر مالي قدره 140 مليون دج</span></div>'
          },
          {
            id: 'cr-el-7',
            type: 'card',
            x: 640,
            y: 110,
            w: 260,
            h: 150,
            content: '<div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); text-align: center;"><span style="color: #64748b; font-size: 11pt;">التغطية الولائية الفعلية</span><h3 style="color: #ea580c; font-size: 28pt; margin: 6px 0; font-family: monospace;">58 / 58</h3><span style="color: #f97316; font-size: 10.5pt; font-weight: bold;">تغطية وطنية شاملة 100%</span></div>'
          }
        ]
      }
    ]
  },
  {
    id: 'blank-canvas',
    nameAr: 'عرض تقديمي فارغ (Blank 16:9 Deck)',
    nameFr: 'Présentation Vierge 16:9',
    nameEn: 'Blank 16:9 Presentation',
    category: 'custom',
    descriptionAr: 'لوحة فارغة بمقاس الشاشات العريضة الحديثة 16:9 لتصميم شرائحك وحرية الإبداع من الصفر.',
    slides: [
      {
        id: 'blank-1',
        title: 'شريحة فارغة',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          {
            id: 'blank-el-1',
            type: 'text',
            x: 80,
            y: 160,
            w: 800,
            h: 80,
            content: '<h1 style="color: #0f172a; font-size: 30pt; text-align: center; margin: 0; font-weight: 800;">عنوان العرض التقديمي</h1>'
          },
          {
            id: 'blank-el-2',
            type: 'text',
            x: 80,
            y: 250,
            w: 800,
            h: 40,
            content: '<p style="color: #64748b; font-size: 16pt; text-align: center; margin: 0;">انقر نقراً مزدوجاً لتحرير هذا النص أو قم بإدراج عناصر جديدة</p>'
          }
        ]
      }
    ]
  }
];
