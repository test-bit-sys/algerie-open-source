/**
 * DZ-Word — Algerian Official Administrative & Sovereign Document Templates
 * Standardized document layouts with bidirectional Arabic-French support
 * complying with Algerian administrative decrees and formatting standards.
 */

(function () {
  'use strict';

  const TEMPLATES = [
  {
    id: 'attestation-travail',
    nameAr: 'شهادة عمل وخبرة مهنية',
    nameFr: 'Attestation de Travail',
    nameEn: 'Work & Employment Certificate',
    category: 'إداري رسمي',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #0f2d72; padding-bottom: 15px; margin-bottom: 25px;">
        <h3 style="margin: 0; color: #1e3a8a; font-size: 16pt; font-family: 'Amiri', serif;">الجمهورية الجزائرية الديمقراطية الشعبية</h3>
        <p style="margin: 5px 0; color: #475569; font-size: 11pt;">République Algérienne Démocratique et Populaire</p>
        <p style="margin: 4px 0; font-weight: bold; color: #047857; font-size: 12pt;">مؤسسة / شركة: [اسم المؤسسة أو الشركة هنا]</p>
        <p style="margin: 2px 0; font-size: 9.5pt; color: #64748b;">رقم السجل التجاري / التعريف الإحصائي (NIS): [0000000000000000]</p>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <h1 style="margin: 0; font-size: 24pt; color: #0f172a; text-decoration: underline; text-underline-offset: 8px;">شـــهــــادة عـــمــــل</h1>
        <p style="margin: 8px 0; font-size: 12pt; color: #64748b; font-family: sans-serif;">ATTESTATION DE TRAVAIL</p>
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
    category: 'إداري رسمي',
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
    nameAr: 'مراسلة ومذكرة مصلحة إدارية',
    nameFr: 'Note de Service / Circulaire',
    nameEn: 'Administrative Memo',
    category: 'إداري رسمي',
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

      <div style="text-align: left; margin-top: 40px; padding-left: 50px;">
        <p style="font-weight: bold; font-size: 12pt; margin-bottom: 45px;">المدير العام</p>
        <p style="color: #64748b; font-size: 10.5pt;">[الختم والتأشيرة]</p>
      </div>
    `
  },
  {
    id: 'curriculum-vitae',
    nameAr: 'سيرة ذاتية وطنية احترافية (CV)',
    nameFr: 'Curriculum Vitae Professionnel',
    nameEn: 'Professional Resume',
    category: 'توظيف وأعمال',
    direction: 'rtl',
    content: `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #185abd; padding-bottom: 20px; margin-bottom: 25px;">
        <div>
          <h1 style="margin: 0; font-size: 24pt; color: #103f91;">محمد بن عبد الله</h1>
          <h3 style="margin: 6px 0; color: #047857; font-size: 14pt;">مهندس دولة في الإعلام الآلي وتطوير النظم</h3>
          <p style="margin: 4px 0; color: #64748b; font-size: 11pt;">الجزائر العاصمة • هاتف: 06 61 00 00 00 • البريد: m.abdallah@algerie.dz</p>
        </div>
        <div style="width: 90px; height: 110px; border: 2px dashed #cbd5e1; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 10pt;">
          صورة شخصية
        </div>
      </div>

      <h3 style="color: #185abd; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">الملخص المهني</h3>
      <p style="line-height: 1.8; font-size: 11.5pt; color: #334155;">
        مهندس برمجيات جزائري ذو خبرة تفوق 6 سنوات في تصميم وبناء المنظومات السحابية والمعالجة المؤسسية. متمكن من التقنيات المفتوحة المصدر والحلول المستقلة Offline-First المطابقة للمعايير الوطنية الجزائرية.
      </p>

      <h3 style="color: #185abd; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-top: 20px;">الخبرات المهنية</h3>
      <div style="margin-bottom: 15px;">
        <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 12pt;">
          <span>رئيس مشروع برمجيات — مؤسسة النظم الذكية (الجزائر)</span>
          <span style="color: #64748b; font-size: 11pt;">2022 - الآن</span>
        </div>
        <ul style="margin: 6px 25px; line-height: 1.8; color: #475569;">
          <li>قيادة فريق من 8 مهندسين لتطوير بوابات رقمية ومحركات فوترة مطابقة للقانون الجزائري.</li>
          <li>رفع كفاءة المعالجة بنسبة 45% وتوفير حماية تامة للبيانات محلياً.</li>
        </ul>
      </div>

      <h3 style="color: #185abd; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-top: 20px;">التعليم والشهادات</h3>
      <div style="display: flex; justify-content: space-between; font-size: 11.5pt;">
        <span><strong>شهادة مهندس دولة في الإعلام الآلي</strong> — جامعة العلوم والتكنولوجيا هواري بومدين (USTHB)</span>
        <span style="color: #64748b;">2016 - 2021</span>
      </div>

      <h3 style="color: #185abd; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-top: 20px;">اللغات والمهارات</h3>
      <p style="line-height: 1.8; font-size: 11pt;">
        <strong>اللغات:</strong> العربية (اللغة الأم)، الفرنسية (ممتاز / Courant)، الإنجليزية (احترافي / Professional)<br>
        <strong>المهارات:</strong> JavaScript, Python, Node.js, SQL, معماريات الأنظمة المستقلة، أمان البيانات.
      </p>
    `
  },
  {
    id: 'bordereau-envoi',
    nameAr: 'جدول إرسال إداري (Bordereau d’envoi)',
    nameFr: "Bordereau d'Envoi",
    nameEn: 'Transmittal Document (Bordereau)',
    category: 'إداري رسمي',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #0f2d72; padding-bottom: 10px; margin-bottom: 20px;">
        <h4 style="margin: 0; color: #1e3a8a; font-size: 13pt;">الجمهورية الجزائرية الديمقراطية الشعبية</h4>
        <p style="margin: 4px 0; font-weight: bold; color: #047857; font-size: 11pt;">وزارة: [اسم الوزارة / الولاية / البلدية]</p>
        <p style="margin: 2px 0; font-size: 10pt; color: #64748b;">مديرية / مصلحة: [اسم المصلحة]</p>
        <p style="margin: 2px 0; font-size: 9.5pt; color: #64748b;">الرقم: ........ / 2026</p>
      </div>

      <div style="text-align: center; margin: 20px 0;">
        <h2 style="margin: 0; font-size: 18pt; text-decoration: underline; color: #0f172a;">جــــدول إرســـــال</h2>
        <p style="margin: 4px 0; color: #64748b; font-size: 11pt;">BORDEREAU D'ENVOI</p>
      </div>

      <div style="display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 11.5pt;">
        <div><strong>المـرسـل:</strong> السيد رئيس مصلحة [اسم المصلحة]</div>
        <div><strong>المرسل إليه:</strong> السيد [المستقبل أو الوجهة]</div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 11pt;">
        <thead>
          <tr style="background-color: #f1f5f9;">
            <th style="border: 1px solid #94a3b8; padding: 10px; width: 10%;">الرقم</th>
            <th style="border: 1px solid #94a3b8; padding: 10px; width: 50%;">بيان الوثائق والملفات المرسلة</th>
            <th style="border: 1px solid #94a3b8; padding: 10px; width: 15%;">العدد</th>
            <th style="border: 1px solid #94a3b8; padding: 10px; width: 25%;">ملاحظات وتوجيهات</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">01</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">ملف طلب اعتماد المنظومة المعلوماتية الجديد</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">01 نسخة</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">للدراسة وإبداء الرأي</td>
          </tr>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">02</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">محضر الاجتماع التنسيقي المؤرخ في 15 أكتوبر 2026</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">02 نسخ</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">للإعلام والأرشيف</td>
          </tr>
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">03</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">كشف الرواتب والتعويضات عن الثلاثي الأخير</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">01 حافظة</td>
            <td style="border: 1px solid #cbd5e1; padding: 10px;">للتأشيرة والتنفيذ</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 40px; display: flex; justify-content: space-between; padding: 0 40px;">
        <div style="text-align: center;">
          <p style="font-weight: bold; margin-bottom: 40px;">وصل الاستلام من المرسل إليه</p>
          <p style="color: #94a3b8; font-size: 10pt;">(التاريخ، التوقيع والختم)</p>
        </div>
        <div style="text-align: center;">
          <p style="font-weight: bold; margin-bottom: 40px;">توقيع وختم المرسل</p>
          <p style="color: #94a3b8; font-size: 10pt;">حرر بـ: الجزائر في [التاريخ]</p>
        </div>
      </div>
    `
  },
  {
    id: 'proces-verbal',
    nameAr: 'محضر اجتماع رسمي (Procès-Verbal)',
    nameFr: 'Procès-Verbal de Réunion',
    nameEn: 'Official Meeting Minutes',
    category: 'إداري رسمي',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #047857; padding-bottom: 10px; margin-bottom: 25px;">
        <h4 style="margin: 0; color: #047857; font-size: 14pt;">الجمهورية الجزائرية الديمقراطية الشعبية</h4>
        <p style="margin: 4px 0; font-weight: bold; color: #1e3a8a;">[اسم الهيئة / المؤسسة / الجمعية]</p>
      </div>

      <div style="text-align: center; margin: 25px 0;">
        <h1 style="margin: 0; font-size: 20pt; text-decoration: underline; color: #0f172a;">مـحـضــر اجـتـمـــاع</h1>
        <p style="margin: 5px 0; color: #64748b; font-size: 11pt;">PROCÈS-VERBAL DE RÉUNION N° 02/2026</p>
      </div>

      <div style="line-height: 2; font-size: 12pt; margin: 20px 0;">
        <p>
          في يوم: <strong>[اليوم]</strong> الموافق لـ: <strong>[التاريخ]</strong>، على الساعة: <strong>[10:00 صباحاً]</strong>، اجتمعت اللجنة المعنية بـ <strong>[موضوع اللجنة أو المجلس]</strong>، بقاعة الاجتماعات الكبرى برئاسة السيد: <strong>[اسم الرئيس والصفة]</strong>.
        </p>

        <p><strong>قائمة الحضور:</strong></p>
        <ul style="margin: 5px 30px;">
          <li>السيد(ة): [الاسم واللقب] — رئيس الجلسة</li>
          <li>السيد(ة): [الاسم واللقب] — مقرر الجلسة</li>
          <li>السيد(ة): [الاسم واللقب] — عضو ممثل مصلحة المستخدمين</li>
        </ul>

        <p style="margin-top: 15px;"><strong>جدول الأعمال:</strong></p>
        <ol style="margin: 5px 30px;">
          <li>دراسة خطة العمل السنوية وتحديث المنظومة الرقمية.</li>
          <li>تنظيم دورة تكوينية في الأمن المعلوماتي والبرمجيات الحرة.</li>
          <li>نقاط متفرقة.</li>
        </ol>

        <h3 style="color: #185abd; margin-top: 25px;">القرارات والتوصيات المتخذة:</h3>
        <p>
          بعد المداولة والنقاش المستفيض بين الأعضاء الحاضرين، تم الإجماع على ما يلي:
        </p>
        <ul style="margin: 5px 30px;">
          <li>المصادقة النهائية على دليل الإجراءات الرقمية المحدث.</li>
          <li>تكليف مقرر الجلسة بمتابعة تنفيذ القرارات وإعداد تقرير دوري خلال 15 يوماً.</li>
        </ul>
        <p>ورُفعت الجلسة على الساعة: <strong>[12:30 زوالاً]</strong> في نفس اليوم والشهر المذكورين أعلاه.</p>
      </div>

      <div style="margin-top: 50px; display: flex; justify-content: space-between; padding: 0 40px;">
        <div style="text-align: center;">
          <p style="font-weight: bold; margin-bottom: 40px;">مقرر الجلسة</p>
          <p style="color: #64748b;">[الاسم والتوقيع]</p>
        </div>
        <div style="text-align: center;">
          <p style="font-weight: bold; margin-bottom: 40px;">رئيس الجلسة</p>
          <p style="color: #64748b;">[الاسم والتوقيع والختم]</p>
        </div>
      </div>
    `
  },
  {
    id: 'convocation-officielle',
    nameAr: 'استدعاء إداري رسمي (Convocation)',
    nameFr: 'Convocation Officielle',
    nameEn: 'Official Summons / Convocation',
    category: 'إداري رسمي',
    direction: 'rtl',
    content: `
      <div style="text-align: center; border-bottom: 2px solid #047857; padding-bottom: 10px; margin-bottom: 20px;">
        <h4 style="margin: 0; color: #047857; font-size: 13pt;">الجمهورية الجزائرية الديمقراطية الشعبية</h4>
        <p style="margin: 4px 0; font-weight: bold; color: #1e3a8a;">[اسم الوزارة / الإدارة العمومية / الجامعة]</p>
        <p style="margin: 2px 0; font-size: 9.5pt; color: #64748b;">الرقم: ......... / 2026</p>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <h1 style="margin: 0; font-size: 24pt; color: #0f172a; text-decoration: underline;">اسـتــــدعـــــــــاء</h1>
        <p style="margin: 6px 0; color: #64748b; font-size: 12pt;">CONVOCATION</p>
      </div>

      <div style="line-height: 2.2; font-size: 13pt; margin: 30px 20px;">
        <p>
          يُستدعى السيد(ة): <strong>[الاسم واللقب]</strong><br>
          المولود(ة) في: <strong>[تاريخ الميلاد]</strong> بـ <strong>[مكان الميلاد]</strong><br>
          القاطن(ة) بـ: <strong>[العنوان الكامل للمستدعى]</strong><br>
        </p>
        <p>
          للحضور والالتحاق بمقر: <strong>[اسم المصلحة أو القاعة، الطابق، والعنوان]</strong><br>
          وذلك يوم: <strong>[يوم الأسبوع]</strong> الموافق لـ: <strong>[التاريخ كاملاً]</strong> على الساعة: <strong>[09:00 صباحاً]</strong>.
        </p>
        <p>
          <strong>لأجل:</strong> [إجراء المقابلة الشفهية / استلام وثائق إدارية / حضور دورة تدريبية].
        </p>
        <p style="color: #b91c1c; font-size: 11pt;">
          <strong>ملاحظة هامة:</strong> يُرجى من المعني(ة) الحضور شخصياً مرفوقاً بهذا الاستدعاء وبطاقة التعريف الوطنية سارية المفعول.
        </p>
      </div>

      <div style="margin-top: 60px; text-align: left; padding-left: 60px;">
        <p style="color: #64748b; font-size: 11pt; margin-bottom: 5px;">حرر بـ: [الجزائر] في: [التاريخ]</p>
        <p style="font-weight: bold; font-size: 12pt; margin-bottom: 50px;">المسؤول المفوض</p>
        <p style="color: #94a3b8; font-size: 10pt;">(الختم والتوقيع الرسمي)</p>
      </div>
    `
  }
];

  if (typeof globalThis !== 'undefined') {
    globalThis.DZ_WORD_TEMPLATES = TEMPLATES;
  }
  if (typeof window !== 'undefined') {
    window.DZ_WORD_TEMPLATES = TEMPLATES;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TEMPLATES };
  }
})();

