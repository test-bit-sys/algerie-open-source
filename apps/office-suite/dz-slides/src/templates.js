/**
 * DZ-Slides — Algerian Academic, Startup & Business Presentation Templates
 */

export const SLIDE_TEMPLATES = [
  {
    id: 'soutenance-pfe',
    nameAr: 'مذكرة تخرج جامعية (Soutenance PFE / Master)',
    nameFr: 'Soutenance PFE / Master & Doctorat',
    nameEn: 'University Thesis Defense',
    category: 'academic',
    slides: [
      {
        id: 's1',
        title: 'واجهة المذكرة',
        bg: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
        textColor: '#ffffff',
        elements: [
          { type: 'text', x: 50, y: 30, w: 900, h: 40, content: '<p style="text-align: center; color: #38bdf8; font-size: 14pt; margin: 0;">الجمهورية الجزائرية الديمقراطية الشعبية — وزارة التعليم العالي والبحث العلمي</p>' },
          { type: 'text', x: 50, y: 70, w: 900, h: 30, content: '<p style="text-align: center; color: #94a3b8; font-size: 12pt; margin: 0;">جامعة هواري بومدين للعلوم والتكنولوجيا (USTHB) — كلية الإعلام الآلي</p>' },
          { type: 'text', x: 50, y: 140, w: 900, h: 100, content: '<h1 style="text-align: center; color: #ffffff; font-size: 26pt; margin: 0; line-height: 1.4;">تصميم وتطوير منظومة وطنية سيادية للحوسبة المكتبية المفتوحة المصدر</h1>' },
          { type: 'text', x: 80, y: 280, w: 400, h: 120, content: '<div style="line-height: 1.8; font-size: 13pt;"><strong>إعداد الطالب:</strong><br>• عبد القادر بن علي<br>• سفيان عماري</div>' },
          { type: 'text', x: 520, y: 280, w: 400, h: 120, content: '<div style="line-height: 1.8; font-size: 13pt;"><strong>تحت إشراف:</strong><br>• أ. د. رابح بوقرة (أستاذ محاضر أ)</div>' },
          { type: 'text', x: 50, y: 440, w: 900, h: 40, content: '<p style="text-align: center; color: #cbd5e1; font-size: 12pt; margin: 0;">السنة الجامعية: 2025 / 2026</p>' }
        ]
      },
      {
        id: 's2',
        title: 'خطة العرض',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          { type: 'text', x: 60, y: 40, w: 880, h: 50, content: '<h2 style="color: #1e3a8a; border-bottom: 3px solid #059669; padding-bottom: 8px; margin: 0;">خطة العرض (Plan de Présentation)</h2>' },
          { type: 'text', x: 80, y: 120, w: 840, h: 320, content: `
            <ol style="font-size: 16pt; line-height: 2.2; color: #334155;">
              <li><strong>مقدمة وإشكالية البحث:</strong> التبعية للحلول السحابية وتحديات السيادة الرقمية.</li>
              <li><strong>الدراسة المقارنة وتحليل المتطلبات:</strong> معايير الأداء وتجربة المستخدم المحلية.</li>
              <li><strong>الهندسة المعمارية للنظام:</strong> تصميم التطبيقات المستقلة بنظام 100% Offline-First.</li>
              <li><strong>التطوير والتنفيذ الفعلي:</strong> معالجة النصوص، الجداول المحاسبية، والعروض التقديمية.</li>
              <li><strong>النتائج والتجربة الميدانية:</strong> فحص الأداء ومقارنة استهلاك الموارد.</li>
              <li><strong>الخاتمة والآفاق المستقبلية:</strong> الخطوات القادمة لتوسيع المنظومة.</li>
            </ol>
          ` }
        ]
      },
      {
        id: 's3',
        title: 'الإشكالية والأهداف',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          { type: 'text', x: 60, y: 40, w: 880, h: 50, content: '<h2 style="color: #1e3a8a; border-bottom: 3px solid #059669; padding-bottom: 8px; margin: 0;">الإشكالية والأهداف المستهدفة</h2>' },
          { type: 'card', x: 80, y: 130, w: 400, h: 280, content: `
            <div style="background: #eff6ff; border: 2px solid #bfdbfe; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;">
              <h3 style="color: #1e40af; margin-top: 0; font-size: 16pt;">التحديات الراهنة</h3>
              <ul style="line-height: 1.8; font-size: 12pt; color: #334155; padding-right: 20px;">
                <li>ارتفاع تكاليف تراخيص البرمجيات المكتبية الأجنبية سنوياً.</li>
                <li>مشاكل توافق اللغة العربية واتجاه النصوص (RTL) في الحلول العالمية.</li>
                <li>انقطاع الوصول إلى البيانات عند غياب الاتصال بشبكة الإنترنت.</li>
              </ul>
            </div>
          ` },
          { type: 'card', x: 510, y: 130, w: 400, h: 280, content: `
            <div style="background: #ecfdf5; border: 2px solid #a7f3d0; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;">
              <h3 style="color: #047857; margin-top: 0; font-size: 16pt;">الأهداف المحققة</h3>
              <ul style="line-height: 1.8; font-size: 12pt; color: #334155; padding-right: 20px;">
                <li>تطوير حزمة برامج مكتبية 100% حرة ومفتوحة المصدر.</li>
                <li>دعم محلي لقوانين الجباية والتفقيط والنماذج الإدارية الوطنية.</li>
                <li>العمل المستقل الكامل بدون خوادم خارجية أو اشتراكات شهرية.</li>
              </ul>
            </div>
          ` }
        ]
      },
      {
        id: 's4',
        title: 'الخاتمة والآفاق',
        bg: 'linear-gradient(135deg, #1e3a8a 0%, #064e3b 100%)',
        textColor: '#ffffff',
        elements: [
          { type: 'text', x: 60, y: 60, w: 880, h: 50, content: '<h2 style="color: #38bdf8; text-align: center; margin: 0; font-size: 22pt;">الخاتمة والآفاق المستقبلية</h2>' },
          { type: 'text', x: 100, y: 150, w: 800, h: 180, content: `
            <p style="text-align: center; font-size: 16pt; line-height: 2; color: #f1f5f9; margin: 0;">
              أثبتت هذه الدراسة قابلية بناء بدائل مكتبية وطنية عالية الكفاءة وخفيفة الحجم، توفر تجربة مستخدم استثنائية وتضمن السيادة الرقمية الكاملة على المستندات والبيانات الحساسة.
            </p>
          ` },
          { type: 'text', x: 100, y: 350, w: 800, h: 80, content: '<h1 style="text-align: center; color: #fbbf24; font-size: 24pt; margin: 0;">شكراً جزيلاً لحسن إصغائكم ومتابعتكم</h1>' }
        ]
      }
    ]
  },
  {
    id: 'startup-pitch',
    nameAr: 'عرض مشروع ناشئ (Startup Pitch Deck)',
    nameFr: 'Pitch Deck Startup & Incubateur',
    nameEn: 'Startup Investor Pitch Deck',
    category: 'business',
    slides: [
      {
        id: 'p1',
        title: 'شريحة العنوان',
        bg: 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)',
        textColor: '#ffffff',
        elements: [
          { type: 'text', x: 80, y: 120, w: 840, h: 60, content: '<h1 style="color: #ffffff; font-size: 32pt; margin: 0;">منصة حلول المستقبل — Algeria Tech</h1>' },
          { type: 'text', x: 80, y: 190, w: 840, h: 40, content: '<p style="color: #fed7aa; font-size: 16pt; margin: 0;">رقمنة وحوسبة المؤسسات الاقتصادية الجزائرية بحلول سيادية مفتوحة المصدر</p>' },
          { type: 'text', x: 80, y: 340, w: 400, h: 60, content: '<div style="font-size: 13pt; color: #ffffff;">تقديم: الفريق المؤسس<br>حاضنة الأعمال — 2026</div>' }
        ]
      },
      {
        id: 'p2',
        title: 'المشكلة والحل',
        bg: '#ffffff',
        textColor: '#0f172a',
        elements: [
          { type: 'text', x: 60, y: 40, w: 880, h: 50, content: '<h2 style="color: #ea580c; border-bottom: 3px solid #ea580c; padding-bottom: 8px; margin: 0;">المشكلة والحل المقترح</h2>' },
          { type: 'card', x: 80, y: 120, w: 400, h: 300, content: `
            <div style="background: #fff7ed; border: 2px solid #ffedd5; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;">
              <h3 style="color: #c2410c; margin-top: 0;">المشكلة في السوق</h3>
              <p style="color: #475569; font-size: 12pt; line-height: 1.8;">صعوبة الدفع بالعملة الصعبة للحصول على اشتراكات البرمجيات، مع غياب التوافق التام مع النظام المحاسبي المالي الجزائري والقوانين الجبائية.</p>
            </div>
          ` },
          { type: 'card', x: 510, y: 120, w: 400, h: 300, content: `
            <div style="background: #f0fdf4; border: 2px solid #dcfce7; border-radius: 12px; padding: 20px; height: 100%; box-sizing: border-box;">
              <h3 style="color: #15803d; margin-top: 0;">الحل المبتكر</h3>
              <p style="color: #475569; font-size: 12pt; line-height: 1.8;">منظومة محلية 100%، مجانية الاستخدام الأساسي، مع دعم فني مخصص، وحساب تلقائي للضرائب والتفقيط بالدينار الجزائري.</p>
            </div>
          ` }
        ]
      }
    ]
  }
];
