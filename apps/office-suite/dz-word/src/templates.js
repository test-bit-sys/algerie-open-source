/**
 * DZ-Word — Algerian Official Administrative & Professional Document Templates
 * Standardized document layouts with bidirectional Arabic-French support.
 */

export const TEMPLATES = [
  {
    id: 'attestation-travail',
    nameAr: 'شهادة عمل وخبرة مهنية',
    nameFr: 'Attestation de Travail',
    nameEn: 'Work & Employment Certificate',
    category: 'administrative',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #0f2d72; padding-bottom: 15px; margin-bottom: 25px;">
        <h3 style="margin: 0; color: #1e3a8a; font-size: 16pt;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
        <p style="margin: 5px 0; color: #475569; font-size: 11pt;">République Algérienne Démocratique et Populaire</p>
        <p style="margin: 4px 0; font-weight: bold; color: #047857;">مؤسسة / شركة: [اسم المؤسسة أو الشركة هنا]</p>
        <p style="margin: 2px 0; font-size: 9.5pt; color: #64748b;">رقم السجل التجاري / التعريف الإحصائي: [0000000000000000]</p>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <h1 style="margin: 0; font-size: 22pt; color: #0f172a; text-decoration: underline; text-underline-offset: 8px;">شـــهــــادة عـــمــــل</h1>
        <p style="margin: 8px 0; font-size: 12pt; color: #64748b;">ATTESTATION DE TRAVAIL</p>
      </div>

      <div style="line-height: 2.2; font-size: 13pt; margin: 30px 20px;">
        <p>
          يشهد المدير العام لـ <strong>[اسم المؤسسة أو الهيئة المشغلة]</strong>، الكائن مقرها الاجتماعي بـ <strong>[العنوان الكامل، الولاية]</strong>:
        </p>
        <p>
          بأن السيد(ة): <strong>[الاسم واللقب الكامل]</strong><br>
          المولود(ة) بتاريخ: <strong>[01 جانفي 1990]</strong> بـ <strong>[البلدية، الولاية]</strong><br>
          الحامل(ة) لبطاقة التعريف الوطنية رقم: <strong>[000000000]</strong> الصادرة بتاريخ: <strong>[01/01/2020]</strong> عن دائرة: <strong>[اسم الدائرة]</strong><br>
        </p>
        <p>
          يعمل (تعمل) لدى مؤسستنا في منصب: <strong>[المسمى الوظيفي، مثال: مهندس برمجيات ونظم معلومات]</strong><br>
          بموجب عقد عمل من نوع: <strong>[عقد غير محدد المدة CDI]</strong><br>
          وذلك منذ تاريخ: <strong>[01 سبتمبر 2021]</strong> إلى غاية يومنا هذا.
        </p>
        <p>
          سُلمت له هذه الشهادة بناءً على طلبه(ها) لاستعمالها والإدلاء بها في حدود ما يسمح به القانون والتشريع المعمول به.
        </p>
      </div>

      <div style="margin-top: 60px; display: flex; justify-content: space-between; align-items: flex-start; padding: 0 30px;">
        <div style="text-align: center; color: #64748b; font-size: 11pt;">
          <p>حرر بـ: <strong>[الجزائر العاصمة]</strong></p>
          <p>بتاريخ: <strong>[اليوم / الشهر / 2026]</strong></p>
        </div>
        <div style="text-align: center;">
          <p style="font-weight: bold; font-size: 12pt; margin-bottom: 50px;">خاتم وتوقيع المدير العام</p>
          <p style="color: #94a3b8; font-size: 10pt;">(ختم المؤسسة الرسمي)</p>
        </div>
      </div>
    `
  },
  {
    id: 'demande-manuscrite',
    nameAr: 'طلب خطي رسمي إداري',
    nameFr: 'Demande Manuscrite Officielle',
    nameEn: 'Official Administrative Request',
    category: 'administrative',
    direction: 'rtl',
    content: `
      <div style="display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 11pt; line-height: 1.8;">
        <div>
          <p style="margin: 2px 0;"><strong>الاسم واللقب:</strong> [الاسم واللقب]</p>
          <p style="margin: 2px 0;"><strong>العنوان الشخصي:</strong> [حي ...، البلدية، الولاية]</p>
          <p style="margin: 2px 0;"><strong>رقم الهاتف:</strong> [05/06/07 00 00 00 00]</p>
          <p style="margin: 2px 0;"><strong>البريد الإلكتروني:</strong> [email@domaine.dz]</p>
        </div>
        <div style="text-align: left;">
          <p style="margin: 2px 0;">[البلدية] في: <strong>[تاريخ اليوم]</strong></p>
        </div>
      </div>

      <div style="text-align: center; margin: 30px 0 25px 0;">
        <p style="font-size: 13pt; font-weight: bold; margin: 0;">إلى السيد: [السيد والي ولاية ... / مدير ... / عميد كلية ...]</p>
        <p style="font-size: 11pt; color: #475569; margin: 5px 0;">المحترم، تحت إشراف السلم الإداري</p>
      </div>

      <div style="margin: 20px 0; padding: 12px 18px; background: #f8fafc; border-right: 4px solid #047857; font-size: 12pt;">
        <p style="margin: 0;"><strong>الموضوع:</strong> طلب [تسوية وضعية / توظيف / تربص تطبيقي / شهادة]</p>
        <p style="margin: 4px 0 0 0; font-size: 10.5pt; color: #475569;"><strong>المرفقات:</strong> نسخة من بطاقة التعريف، السيرة الذاتية، الشهادات والمؤهلات</p>
      </div>

      <div style="line-height: 2.2; font-size: 12.5pt; margin: 25px 0;">
        <p><strong>سيدي المحترم،</strong></p>
        <p>
          يشرفني ويسعدني أن أتقدم إلى سيادتكم المحترمة بهذا الطلب، ملتمساً منكم التفضل بالموافقة على [تحديد موضوع الطلب بدقة واختصار].
        </p>
        <p>
          أحيطكم علماً سيدي بأنني [أذكر المؤهل العلمي، الخبرة المهنية أو المبرر الداعي لتقديم هذا الطلب، مع ذكر الدوافع الجادة للترشح أو الاستفادة].
        </p>
        <p>
          وفي انتظار ردكم الإيجابي الذي أرجو أن يلقى عنايتكم الكريمة واهتمامكم المعهود، تقبلوا مني، سيدي، أسمى عبارات التقدير والاحترام والامتنان.
        </p>
      </div>

      <div style="text-align: left; margin-top: 50px; padding-left: 40px;">
        <p style="font-weight: bold; font-size: 12pt; margin-bottom: 40px;">إمضاء المعني بالأمر:</p>
        <p style="color: #64748b; font-size: 11pt;">[الاسم والتوقيع]</p>
      </div>
    `
  },
  {
    id: 'note-service',
    nameAr: 'مراسلة ومذكرة إدارية (Note de Service)',
    nameFr: 'Note de Service / Circulaire',
    nameEn: 'Administrative Memo',
    category: 'official',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #047857; padding-bottom: 12px; margin-bottom: 20px;">
        <h4 style="margin: 0; color: #047857; font-size: 14pt;">الجمهورية الجزائرية الديمقراطية الشعبية</h4>
        <p style="margin: 4px 0; font-weight: bold; color: #0f2d72; font-size: 11pt;">وزارة [التعليم العالي والبحث العلمي / التجارة وترقية الصادرات / ...]</p>
        <p style="margin: 2px 0; font-size: 10pt; color: #475569;">مديرية [اسم المديرية العامة أو الهيئة]</p>
        <p style="margin: 2px 0; font-size: 9.5pt; color: #64748b;">رقم: ......... / م.ع / 2026</p>
      </div>

      <div style="display: flex; justify-content: space-between; margin: 15px 0; font-size: 11pt;">
        <div><strong>من:</strong> السيد المدير العام لـ [الهيئة]</div>
        <div><strong>الجزائر في:</strong> [التاريخ]</div>
      </div>
      <div style="font-size: 11pt; margin-bottom: 20px;">
        <strong>إلى السادة:</strong> مدراء الأقسام، رؤساء المصالح، وكافة موظفي الهيئة
      </div>

      <div style="text-align: center; margin: 25px 0;">
        <h2 style="display: inline-block; margin: 0; padding: 6px 30px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 16pt; color: #0f172a;">مـــذكــــرة مـصـلـحـــة</h2>
        <p style="margin: 5px 0; font-size: 10.5pt; color: #64748b;">NOTE DE SERVICE N° 04/2026</p>
      </div>

      <div style="line-height: 2; font-size: 12pt; margin: 20px 0;">
        <p><strong>الموضوع:</strong> [بشأن تنظيم سير العمل / اعتماد المنظومة الرقمية الجديدة]</p>
        <p><strong>المرجع:</strong> القانون الأساسي للوظيفة العمومية والتعليمات الوزارية ذات الصلة.</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
        <p>
          يُنهى إلى علم كافة السيدات والسادة الإطارات والموظفين والأساتذة أنه، وفي إطار تعزيز الشفافية وحوكمة العمل الإداري ورقمنة الخدمات، يُقرر ما يلي:
        </p>
        <ol style="padding-right: 25px; line-height: 2.2;">
          <li><strong>أولاً:</strong> [القرار الأول أو الإجراء التنظيمي المستحدث بالتفصيل].</li>
          <li><strong>ثانياً:</strong> يُلزم جميع رؤساء الأقسام بالمتابعة الدورية ورفع التقارير الأسبوعية للخلية المركزية.</li>
          <li><strong>ثالثاً:</strong> يُعمل بهذه التوجيهات فور صدور هذه المذكرة وتُنشر في لوحة الإعلانات الرسمية.</li>
        </ol>
        <p>
          يُرجى من الجميع إيلاء العناية والحرص اللازمين لتطبيق فحوى هذه المذكرة بكل انضباط ومهنية.
        </p>
      </div>

      <div style="text-align: left; margin-top: 45px; padding-left: 50px;">
        <p style="font-weight: bold; font-size: 12pt; margin-bottom: 45px;">المدير العام</p>
        <p style="color: #64748b; font-size: 10pt;">(الختم والتأشيرة الرسمية)</p>
      </div>
    `
  },
  {
    id: 'curriculum-vitae',
    nameAr: 'سيرة ذاتية وطنية احترافية (CV)',
    nameFr: 'Curriculum Vitae Professionnel',
    nameEn: 'Professional Modern CV',
    category: 'career',
    direction: 'rtl',
    content: `
      <div style="display: flex; gap: 20px; align-items: center; border-bottom: 3px solid #1e40af; padding-bottom: 20px; margin-bottom: 20px;">
        <div style="flex: 1;">
          <h1 style="margin: 0; color: #1e3a8a; font-size: 24pt;">[الاسم الكامل للمترشح]</h1>
          <h3 style="margin: 5px 0; color: #047857; font-size: 14pt;">[المسمى الوظيفي، مثال: مهندس برمجيات وتطوير ويب كامل]</h3>
          <p style="margin: 8px 0 0 0; color: #475569; font-size: 10.5pt; line-height: 1.6;">
            الجزائر العاصمة • الهاتف: 0550 00 00 00 • البريد: developer@algerie.dz • لينكد إن / غيتهاب: github.com/username
          </p>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h3 style="color: #1e40af; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">الملخص المهني</h3>
        <p style="line-height: 1.8; color: #334155; font-size: 11pt; margin: 0;">
          مهندس برمجيات جزائري بخبرة تزيد عن 5 سنوات في تطوير الأنظمة الموزعة وتطبيقات الويب عالية الأداء، مهتم بالمصادر المفتوحة، وتطوير الحلول السحابية والمحلية المتوافقة مع احتياجات المؤسسات الوطنية.
        </p>
      </div>

      <div style="margin-bottom: 20px;">
        <h3 style="color: #1e40af; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">الخبرات المهنية</h3>
        <div style="margin-bottom: 15px;">
          <div style="display: flex; justify-content: space-between; font-weight: bold; color: #0f172a; font-size: 11.5pt;">
            <span>كبير مهندسي البرمجيات — [اسم المؤسسة أو الشركة، الجزائر]</span>
            <span style="color: #64748b;">2022 — حتى الآن</span>
          </div>
          <ul style="margin: 6px 0; padding-right: 20px; color: #475569; font-size: 10.5pt; line-height: 1.8;">
            <li>قيادة فريق تقني لتصميم وتطوير منصات الدفع والفواتير الإلكترونية المتوافقة مع المعايير الجزائرية.</li>
            <li>تحسين كفاءة المعالجة بنسبة 40% وتطبيق حلول تخزين آمنة محلياً 100% Offline-First.</li>
          </ul>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h3 style="color: #1e40af; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">التعليم والشهادات الأكاديمية</h3>
        <div style="display: flex; justify-content: space-between; font-size: 11pt;">
          <div>
            <strong>ماستر في هندسة البرمجيات والذكاء الاصطناعي</strong><br>
            <span style="color: #475569;">جامعة العلوم والتكنولوجيا هواري بومدين (USTHB)</span>
          </div>
          <span style="color: #64748b; font-weight: bold;">2018 — 2020</span>
        </div>
      </div>

      <div>
        <h3 style="color: #1e40af; border-bottom: 1px solid #cbd5e1; padding-bottom: 5px; margin-bottom: 10px;">المهارات واللغات</h3>
        <p style="margin: 5px 0; font-size: 10.5pt; line-height: 1.8;">
          <strong>التقنيات:</strong> JavaScript, Node.js, Python, PostgreSQL, Docker, Linux, Git.<br>
          <strong>اللغات:</strong> العربية (اللغة الأم)، الفرنسية (بطلاقة مهنية)، الإنجليزية (ممتاز).
        </p>
      </div>
    `
  }
];
