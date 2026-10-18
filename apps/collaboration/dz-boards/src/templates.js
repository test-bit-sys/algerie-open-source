/**
 * DZ-Boards — Official Algerian Project Templates
 * Rich pre-configured project boards for Algerian Universities, Tech Startups, and Agile Teams.
 */

export const ALGERIAN_TEMPLATES = {
  pfe: {
    id: 'pfe',
    title: 'مشروع التخرج الجامعي (PFE Master & License)',
    titleFr: 'Projet de Fin d\'Études (PFE Master / Licence)',
    titleEn: 'University Graduation Thesis (PFE Project)',
    description: 'خطة عمل متكاملة لمشروع التخرج الجامعي ومذكرة التخرج تشمل الجوانب النظرية والتطبيقية ومراجعة المشرف.',
    columns: [
      {
        id: 'col-backlog',
        title: 'الأفكار والمراجع (Backlog)',
        color: '#64748b',
        cards: [
          {
            id: 'card-1',
            title: 'تحديد إشكالية البحث وأهداف المشروع',
            description: 'صياغة إشكالية واضحة ومحددة مع تحديد النطاق الزمني والتقني للمشروع بالتوافق مع الأستاذ المؤطر.',
            priority: 'urgent',
            dueDate: '2026-11-01',
            tags: ['تأطير', 'بحث'],
            checklist: [
              { id: 'chk-1', text: 'صياغة فرضيات العمل', done: true },
              { id: 'chk-2', text: 'تحديد الفئات المستهدفة والمستفيدين', done: true },
              { id: 'chk-3', text: 'المصادقة من المجلس العلمي للقسم', done: false }
            ]
          },
          {
            id: 'card-2',
            title: 'جمع ومراجعة الدراسات السابقة (État de l\'art)',
            description: 'استخراج المراجع الأكاديمية والمقالات العلمية من منصات مثل IEEE, Springer, و ScienceDirect.',
            priority: 'medium',
            dueDate: '2026-11-15',
            tags: ['أكاديمي', 'توثيق'],
            checklist: [
              { id: 'chk-4', text: 'تلخيص 10 أوراق بحثية محكمة', done: false },
              { id: 'chk-5', text: 'مقارنة الحلول الموجودة في السوق', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-dev',
        title: 'قيد التطوير والبرمجة (In Progress)',
        color: '#3b82f6',
        cards: [
          {
            id: 'card-3',
            title: 'نمذجة النظام ومخططات UML',
            description: 'رسم مخططات حالات الاستخدام (Use Cases)، ومخطط الفئات (Class Diagram)، ومخطط التسلسل (Sequence Diagram).',
            priority: 'high',
            dueDate: '2026-11-20',
            tags: ['تصميم', 'هندسة'],
            checklist: [
              { id: 'chk-6', text: 'مخطط بنية قاعدة البيانات', done: true },
              { id: 'chk-7', text: 'مخطط تدفق العمليات', done: false }
            ]
          },
          {
            id: 'card-4',
            title: 'برمجة النواة الأساسية والواجهات',
            description: 'تطوير المنصة باستخدام تقنيات الويب الحديثة مع مراعاة المعايير الجزائرية وتوافق الهواتف الذكية.',
            priority: 'urgent',
            dueDate: '2026-12-05',
            tags: ['برمجة', 'Frontend', 'Backend'],
            checklist: [
              { id: 'chk-8', text: 'بناء واجهات المستخدم باللغتين العربية والفرنسية', done: true },
              { id: 'chk-9', text: 'تكامل واجهات برمجة التطبيقات REST API', done: true },
              { id: 'chk-10', text: 'إجراء الاختبارات الأحادية (Unit Tests)', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-review',
        title: 'المراجعة مع المؤطر (Review)',
        color: '#f59e0b',
        cards: [
          {
            id: 'card-5',
            title: 'مراجعة الفصل النظري والمنهجية',
            description: 'إرسال المسودة الأولى من المذكرة للأستاذ المشرف لتسجيل الملاحظات والتصحيحات اللغوية والعلمية.',
            priority: 'high',
            dueDate: '2026-12-15',
            tags: ['مراجعة', 'تدقيق'],
            checklist: [
              { id: 'chk-11', text: 'تدقيق المراجع وصيغة الاقتباس IEEE', done: false },
              { id: 'chk-12', text: 'فحص نسبة الاستلال (Plagiarism Check)', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-done',
        title: 'مكتمل ومنجز (Completed)',
        color: '#10b981',
        cards: [
          {
            id: 'card-6',
            title: 'تثبيت بيئة التطوير واختيار الحزمة البرمجية',
            description: 'إعداد الخادم المحلي، مستودع Git، وضبط المعايير البرمجية للمشروع.',
            priority: 'low',
            dueDate: '2026-10-10',
            tags: ['بيئة', 'إعداد'],
            checklist: [
              { id: 'chk-13', text: 'إنشاء المستودع على GitHub', done: true },
              { id: 'chk-14', text: 'إعداد ملف README والتوثيق المبدئي', done: true }
            ]
          }
        ]
      }
    ]
  },

  startup: {
    id: 'startup',
    title: 'إطلاق شركة ناشئة ومتجر إلكتروني جزائري (DZ E-Commerce)',
    titleFr: 'Lancement d\'une Startup E-Commerce en Algérie',
    titleEn: 'Algerian E-Commerce Startup Launch',
    description: 'دليل مهام إداري وقانوني وتقني متكامل لبدء مشروع تجارة إلكترونية ودفع وطني في الجزائر.',
    columns: [
      {
        id: 'col-legal',
        title: 'الإجراءات الإدارية والقانونية',
        color: '#8b5cf6',
        cards: [
          {
            id: 'card-s1',
            title: 'استخراج السجل التجاري الإلكتروني (Code 607001)',
            description: 'تقديم الملف لدى المركز الوطني للسجل التجاري (CNRC) للحصول على رمز التجارة عبر الإنترنت.',
            priority: 'urgent',
            dueDate: '2026-11-05',
            tags: ['قانوني', 'CNRC'],
            checklist: [
              { id: 'chk-s1', text: 'استئجار أو تعيين مقر النشاط', done: true },
              { id: 'chk-s2', text: 'استخراج شهادة السلبية للتسمية التجارية', done: true },
              { id: 'chk-s3', text: 'إيداع الملف ودفع الرسوم القانونية', done: false }
            ]
          },
          {
            id: 'card-s2',
            title: 'الانتساب الضريبي واستخراج NIF و NIS',
            description: 'تسجيل الشركة لدى مفتشية الضرائب المختصة إقليمياً واستخراج بطاقة الترقيم الجبائي والإحصائي.',
            priority: 'high',
            dueDate: '2026-11-12',
            tags: ['ضرائب', 'جبائي'],
            checklist: [
              { id: 'chk-s4', text: 'إيداع استمارة التصريح بالوجود Série G n°8', done: false },
              { id: 'chk-s5', text: 'الحصول على رقم التعريف الجبائي النظيف (15 رقماً)', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-tech',
        title: 'التجهيز التقني والتكامل البنكي',
        color: '#06b6d4',
        cards: [
          {
            id: 'card-s3',
            title: 'الربط مع بوابة الدفع الإلكتروني (CIB / الذهبية)',
            description: 'توقيع اتفاقية التجارة الإلكترونية مع بنك وطني (BNA, BEA, CPA) أو بريد الجزائر، وإجراء اختبارات منصة SATIM.',
            priority: 'urgent',
            dueDate: '2026-11-25',
            tags: ['دفع', 'SATIM', 'Fintech'],
            checklist: [
              { id: 'chk-s6', text: 'تركيب شهادة الأمان SSL 256-bit', done: true },
              { id: 'chk-s7', text: 'اجتياز سيناريوهات الاختبار لـ SATIM بنجاح', done: false },
              { id: 'chk-s8', text: 'تفعيل المفاتيح الحية للإنتاج (Production Keys)', done: false }
            ]
          },
          {
            id: 'card-s4',
            title: 'التعاقد والتكامل مع شركات التوصيل الوطنية',
            description: 'تكامل واجهة برمجة التطبيقات API مع شركات التوصيل (Yalidine, ZR Express, Procolis) للشحن عبر 58 ولاية.',
            priority: 'high',
            dueDate: '2026-11-30',
            tags: ['لوجستيك', 'توصيل'],
            checklist: [
              { id: 'chk-s9', text: 'توليد بوليصات الشحن التلقائية مع الباركود', done: true },
              { id: 'chk-s10', text: 'ربط نظام الدفع عند الاستلام (COD Tracking)', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-marketing',
        title: 'التسويق والمحتوى وإطلاق العلامة',
        color: '#f97316',
        cards: [
          {
            id: 'card-s5',
            title: 'تصميم الهوية البصرية وإعلانات السوشيال ميديا',
            description: 'إعداد قوالب المنشورات والريلز عبر استوديو DZ-Photo بقياسات 1080x1080 و 1080x1920.',
            priority: 'medium',
            dueDate: '2026-12-05',
            tags: ['جرافيك', 'تسويق'],
            checklist: [
              { id: 'chk-s11', text: 'تصميم الشعار وألوان العلامة', done: true },
              { id: 'chk-s12', text: 'تصوير المنتجات بجودة عالية وتفريغ الخلفيات', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-launched',
        title: 'الإنطلاق الرسمي والتشغيل',
        color: '#10b981',
        cards: [
          {
            id: 'card-s6',
            title: 'حجز النطاق الوطني .dz والاستضافة المحلية',
            description: 'تسجيل اسم النطاق لدى مركز البحث في الإعلام العلمي والتقني CERIST.',
            priority: 'low',
            dueDate: '2026-10-15',
            tags: ['بنية تحتية', 'CERIST'],
            checklist: [
              { id: 'chk-s13', text: 'تأكيد ملكية العلامة وتوثيق الطلب', done: true }
            ]
          }
        ]
      }
    ]
  },

  sprint: {
    id: 'sprint',
    title: 'دورة تطوير رشيقة (Agile 2-Week Sprint)',
    titleFr: 'Sprint Agile (2 Semaines)',
    titleEn: 'Agile 2-Week Development Sprint',
    description: 'لوحة تخطيط سبرنت أسبوعين لتطوير المنتجات البرمجية مع توزيع الأدوار وتتبع الإنجاز.',
    columns: [
      {
        id: 'col-sp-backlog',
        title: 'Sprint Backlog',
        color: '#64748b',
        cards: [
          {
            id: 'card-sp1',
            title: 'تطوير آلية تصدير التقارير إلى Excel و PDF',
            description: 'دعم تنسيق جداول DZ-Calc ومستندات DZ-Word للتقارير السنوية.',
            priority: 'medium',
            dueDate: '2026-11-10',
            tags: ['Feature', 'Reports'],
            checklist: [
              { id: 'chk-sp1', text: 'مخطط البيانات', done: false },
              { id: 'chk-sp2', text: 'التنسيق والطباعة', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-sp-progress',
        title: 'In Progress (قيد التنفيذ)',
        color: '#3b82f6',
        cards: [
          {
            id: 'card-sp2',
            title: 'تحسين أداء عرض الخرائط وقائمة 58 ولاية',
            description: 'تحسين استعلامات الفلترة السريعة وتنسيق الأرقام البريدية.',
            priority: 'urgent',
            dueDate: '2026-11-06',
            tags: ['Performance', 'Core'],
            checklist: [
              { id: 'chk-sp3', text: 'فهرسة الأسماء بالعربية والفرنسية', done: true },
              { id: 'chk-sp4', text: 'تقليل استهلاك الذاكرة', done: false }
            ]
          }
        ]
      },
      {
        id: 'col-sp-qa',
        title: 'Code Review & QA (فحص الجودة)',
        color: '#f59e0b',
        cards: [
          {
            id: 'card-sp3',
            title: 'فحص التوافق مع شاشات الأجهزة اللوحية',
            description: 'التأكد من سلاسة السحب والإفلات وتناسق الخطوط.',
            priority: 'high',
            dueDate: '2026-11-04',
            tags: ['QA', 'Responsive'],
            checklist: [
              { id: 'chk-sp5', text: 'اختبار اللمس في المتصفح', done: true }
            ]
          }
        ]
      },
      {
        id: 'col-sp-done',
        title: 'Done (مكتمل وموثق)',
        color: '#10b981',
        cards: [
          {
            id: 'card-sp4',
            title: 'إعداد حزمة التثبيت الأوفلاين للبرنامج',
            description: 'ضمان العمل بدون أي اتصال بالإنترنت مع دعم حفظ البيانات محلياً.',
            priority: 'low',
            dueDate: '2026-10-28',
            tags: ['Release', 'Offline'],
            checklist: [
              { id: 'chk-sp6', text: 'اختبار انقطاع الشبكة', done: true },
              { id: 'chk-sp7', text: 'التحقق من ملفات SVG', done: true }
            ]
          }
        ]
      }
    ]
  }
};
