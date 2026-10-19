/**
 * DZ-PDF: Official Algerian Document Templates Generator
 * Authentic high-resolution administrative documents, contracts, certificates, and forms
 * for instant demonstration, editing, signing, and stamping.
 * 
 * 100% offline, zero dependencies, pure HTML5 Canvas (A4 at 150 DPI: 1240 x 1754).
 * Built to the HeyPuter/everything standard.
 */

export class AlgerianTemplates {
  /**
   * Generates a high-res canvas (1240 x 1754 for crisp A4 at 150 DPI)
   */
  static createCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;
    canvas.height = 1754;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  }

  /**
   * Template 1: Official Administrative Decision / Certificate
   * (الجمهورية الجزائرية الديمقراطية الشعبية - شهادة إدارية رسمية مطابقة)
   */
  static createAdministrativeCertificate() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;
    const h = canvas.height;

    // Header Republic Title (Bilingual Arabic / French)
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 90);

    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE', w / 2, 125);

    // Decorative National Header Divider
    ctx.strokeStyle = '#059669'; // Emerald
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 250, 145);
    ctx.lineTo(w / 2 + 250, 145);
    ctx.stroke();

    ctx.strokeStyle = '#dc2626'; // Red center dot
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(w / 2, 145, 5, 0, Math.PI * 2);
    ctx.fill();

    // Ministry & Wilaya details (Right and Left)
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('وزارة التعليم العالي والبحث العلمي', w - 90, 200);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillText('جامعة العلوم والتكنولوجيا هواري بومدين', w - 90, 230);
    ctx.fillText('نيابة المديرية للدراسات العليا والبحث', w - 90, 260);

    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Wilaya d’Alger', 90, 200);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Réf: 1428 / UDB-DZ / 2026', 90, 230);
    ctx.fillText(`Alger, le ${new Date().toLocaleDateString('fr-DZ')}`, 90, 260);

    // Document Title Box
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(140, 320, w - 280, 80, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(140, 320, w - 280, 80);
      ctx.strokeRect(140, 320, w - 280, 80);
    }

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
    ctx.fillText('شــهــادة إداريــة مــطــابــقــة', w / 2, 372);

    // Body text (Formal Algerian administrative phrasing)
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';

    const startY = 480;
    const lineHeight = 46;

    const lines = [
      'يشهد السيد مدير الدراسات والتوثيق، بناءً على السجلات الرسمية المحفوظة لدى الإدارة،',
      'أن المعني بالأمر السيد(ة): بن عيسى رضوان (BEN AISSA REDOUANE)',
      'المولود(ة) بتاريخ: 15 جوان 1994 بالجزائر الوسطى (ولاية الجزائر)',
      'الحامل لبطاقة التعريف الوطنية رقم: 110940283929 الصادرة عن دائرة سيدي امحمد،',
      '',
      'قد أتم بنجاح كافة الالتزامات الأكاديمية والمهنية المقررة وفقاً للقوانين السارية،',
      'وحاز على الاعتماد التقني العالي بدرجة امتياز مع مرتبة الشرف الأولى.',
      '',
      'سُلِّمت هذه الشهادة للمعني بالأمر بناءً على طلبه للإدلاء بها واستعمالها في حدود ما يسمح به القانون.',
      'أي كشط أو شطب أو تغيير في هذه الوثيقة يُلغي صلاحيتها ويُعرّض صاحبه للمتابعة القضائية.'
    ];

    lines.forEach((line, idx) => {
      ctx.fillText(line, w - 90, startY + idx * lineHeight);
    });

    // Verification QR / Fingerprint Code Box
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(90, 1100, 220, 120);
    ctx.fillStyle = '#64748b';
    ctx.font = '12px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillText('رمز التحقق الرقمي', 200, 1135);
    ctx.font = 'bold 14px monospace';
    ctx.direction = 'ltr';
    ctx.fillStyle = '#059669';
    ctx.fillText('DZ-SEC-99482-AUTH', 200, 1165);
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('منظومة التوثيق الرقمي الوطني', 200, 1195);

    // Footer signature designations
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('حرر بالجزائر في: ' + new Date().toLocaleDateString('ar-DZ'), w - 90, 1260);

    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillText('توقيع وختم المسؤول الإداري المفوّض', w - 90, 1310);
    ctx.font = 'italic 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.direction = 'ltr';
    ctx.fillText('Le Directeur Général des Services', w - 90, 1340);

    // Bottom official watermark border
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(90, 1630);
    ctx.lineTo(w - 90, 1630);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية — وثيقة رسمية مؤمنة بنظام التوثيق المفتوح DZ Open Suite', w / 2, 1665);

    return {
      id: 'cert_admin',
      name: 'شهادة_إدارية_رسمية.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 2: Official Algerian Commercial Invoice & Contract
   * (فاتورة وعقد توريد تجاري بالدينار الجزائري DZD مع الترقيم الجبائي NIF/NIS)
   */
  static createCommercialContract() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;

    // Header
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText('مؤسسة الخدمات الرقمية والتطوير البرمجي (DZ Open Suite)', w - 90, 90);

    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('شارع ديدوش مراد، الجزائر الوسطى، ولاية الجزائر', w - 90, 125);
    ctx.direction = 'ltr';
    ctx.fillText('Tél: +213 (0) 23 45 67 89  |  Email: contact@dz-suite.dz', w - 90, 150);

    // Fiscal details
    ctx.font = '14px monospace';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('NIF: 002116098472910 | NIS: 09823419082 | RC: 16/00-098472B21 | Art: 16120938471', w - 90, 185);

    // Left Box: Invoice details
    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(90, 60, 320, 130);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, 60, 320, 130);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillText('FACTURE N° 2026/048', 110, 95);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`Date: ${new Date().toLocaleDateString('fr-DZ')}`, 110, 125);
    ctx.fillText('Règlement: Virement bancaire / CCP', 110, 150);
    ctx.fillText('Échéance: À réception', 110, 175);

    // Client Info Box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(90, 230, w - 180, 90);
    ctx.strokeRect(90, 230, w - 180, 90);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('معلومات العميل / الزبون (Client):', w - 110, 260);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('شركة التوزيع واللوجستيك الوطني (ش.ذ.م.م) — ولاية وهران', w - 110, 290);

    // Items Table Header
    const tableTop = 360;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(90, tableTop, w - 180, 45);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.fillText('البيان والخدمة (Désignation)', w - 120, tableTop + 28);
    ctx.fillText('الكمية', w - 500, tableTop + 28);
    ctx.fillText('السعر الفردي (د.ج)', w - 660, tableTop + 28);
    ctx.fillText('نسبة الرسم (TVA)', w - 850, tableTop + 28);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText('المجموع د.ج (Montant HT)', 120, tableTop + 28);

    // Table rows
    const rows = [
      { desc: 'نظام إدارة وأرشفة الوثائق السحابي المحلي (DZ-PDF Enterprise)', qty: '01', price: '250,000.00', tva: '19%', total: '250,000.00' },
      { desc: 'رخصة تشغيل نظام الأرشفة والضغط المتقدم (DZ-Archive Pro)', qty: '05', price: '45,000.00', tva: '19%', total: '225,000.00' },
      { desc: 'تثبيت وخادم فحص الأقراص وتحليل التخزين (DZ-Disk Tree Server)', qty: '01', price: '85,000.00', tva: '19%', total: '85,000.00' },
      { desc: 'دورة تكوينية وتدريب تقني للمهندسين المعتمدين (3 أيام)', qty: '01', price: '120,000.00', tva: '09%', total: '120,000.00' }
    ];

    let rowY = tableTop + 45;
    ctx.font = '14px "Segoe UI", Arial, sans-serif';

    rows.forEach((r, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(90, rowY, w - 180, 48);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(90, rowY, w - 180, 48);

      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.fillText(r.desc, w - 120, rowY + 30);
      ctx.fillText(r.qty, w - 500, rowY + 30);
      ctx.fillText(r.price, w - 660, rowY + 30);
      ctx.fillText(r.tva, w - 850, rowY + 30);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillText(r.total, 120, rowY + 30);

      rowY += 48;
    });

    // Summary Totals Box
    const sumX = 90;
    const sumY = rowY + 30;
    const sumW = 420;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(sumX, sumY, sumW, 160);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(sumX, sumY, sumW, 160);

    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#475569';
    ctx.fillText('المجموع الخام (Total HT):', sumX + sumW - 20, sumY + 35);
    ctx.fillText('مجموع الرسم (Total TVA 19%):', sumX + sumW - 20, sumY + 70);
    ctx.fillText('رسم الطابع الجبائي (Timbre):', sumX + sumW - 20, sumY + 105);

    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.fillText('المبلغ الإجمالي بكل الرسوم (TTC):', sumX + sumW - 20, sumY + 140);

    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.fillStyle = '#0f172a';
    ctx.font = '15px monospace';
    ctx.fillText('680,000.00 د.ج', sumX + 20, sumY + 35);
    ctx.fillText('129,200.00 د.ج', sumX + 20, sumY + 70);
    ctx.fillText('2,500.00 د.ج', sumX + 20, sumY + 105);

    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#059669';
    ctx.fillText('811,700.00 د.ج', sumX + 20, sumY + 140);

    // Tafqit (Amount in words in Arabic)
    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('أُوقِفت هذه الفاتورة عند المبلغ الإجمالي قدره:', w - 90, sumY + 60);
    ctx.font = 'italic 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('ثمانمائة وإحدى عشر ألف وسبعمائة دينار جزائري لا غير (811,700.00 DZD)', w - 90, sumY + 95);

    // Signature boxes
    const sigY = sumY + 220;
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, sigY, 400, 160);
    ctx.strokeRect(w - 490, sigY, 400, 160);

    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#334155';
    ctx.fillText('تأشيرة وختم العميل / المشتري', 290, sigY + 30);
    ctx.fillText('ختم وتوقيع المدير المالي والإداري', w - 290, sigY + 30);

    return {
      id: 'inv_commercial',
      name: 'فاتورة_وعقد_تجاري_رسمي.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 3: Official Algerian Declaration on Honor
   * (الجمهورية الجزائرية الديمقراطية الشعبية - تصريح شرفي رسمي)
   */
  static createHonorDeclaration() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 90);

    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE', w / 2, 125);

    // Header divider
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 220, 145);
    ctx.lineTo(w / 2 + 220, 145);
    ctx.stroke();

    // Wilaya & Daïra (top right)
    ctx.textAlign = 'right';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('ولاية الجزائر', w - 90, 200);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillText('دائرة سيدي امحمد — بلدية الجزائر الوسطى', w - 90, 230);

    // Document Title Box
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(160, 290, w - 320, 80, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(160, 290, w - 320, 80);
      ctx.strokeRect(160, 290, w - 320, 80);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 32px "Segoe UI", Arial, sans-serif';
    ctx.fillText('تــصــريــح شــرفــي', w / 2, 342);

    // Body
    ctx.textAlign = 'right';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';

    const startY = 440;
    const lineHeight = 50;

    const lines = [
      'أنا الممضي أسفله السيد(ة): بلحاج كريم (BELHADJ KARIM)',
      'المولود(ة) بتاريخ: 22 أوت 1988 بمدينة سطيف،',
      'ابن: أحمد  و ابن: خديجة منصوري،',
      'الساكن حالياً بـ: 14 شارع حسيبة بن بوعلي، الجزائر العاصمة،',
      'الحامل(ة) لبطاقة التعريف الوطنية رقم: 109847291048 الصادرة بتاريخ: 10/05/2021،',
      'عن دائرة: سيدي امحمد (ولاية الجزائر).',
      '',
      'أصرح بشرفي وبكامل قواي العقلية والقانونية بما يلي:',
      '1. أنني أمارس نشاطي المهني والاستشاري بصفة نظامية وقانونية وفق أحكام التشريع الجزائري.',
      '2. أن كافة البيانات والوثائق المرفقة بهذا الملف صحيحة ومطابقة للواقع دون أي إخفاء أو تحريف.',
      '3. أنني على دراية تامة بالعقوبات المنصوص عليها في المادتين 222 و 228 من قانون العقوبات الجزائري',
      '   في شأن الإدلاء بتصريحات كاذبة أو تزوير الوثائق والمحررات الإدارية والرسمية.',
      '',
      'حررت هذا التصريح الشرفي للإدلاء به واستعماله لدى المصالح الإدارية المعنية في حدود ما يسمح به القانون.'
    ];

    lines.forEach((line, idx) => {
      ctx.fillText(line, w - 90, startY + idx * lineHeight);
    });

    // Signature blocks
    const sigY = 1260;
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`حرر بـ: الجزائر في ${new Date().toLocaleDateString('ar-DZ')}`, w - 90, sigY);

    // Two signature frames
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, sigY + 40, 420, 180);
    ctx.strokeRect(w - 510, sigY + 40, 420, 180);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('مصادقة مصلحة الحالة المدنية والبلدية', 300, sigY + 70);
    ctx.fillText('توقيع وبصمة المصرح (المعني بالأمر)', w - 300, sigY + 70);

    // Footer note
    ctx.textAlign = 'center';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('وثيقة رسمية صادرة بموجب التشريع الإداري للجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 1680);

    return {
      id: 'honor_declaration',
      name: 'تصريح_شرفي_رسمي.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 4: Official Work & Employment Certificate
   * (شهادة عمل وممارسة مهنية رسمية جزائرية - Attestation de Travail)
   */
  static createWorkCertificate() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 90);

    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE', w / 2, 125);

    // Header line
    ctx.strokeStyle = '#1d4ed8'; // Blue
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 240, 145);
    ctx.lineTo(w / 2 + 240, 145);
    ctx.stroke();

    // Company Header
    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('الشركة الوطنية للهندسة والبرمجيات المتقدمة (ش.ذ.أ)', w - 90, 205);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('رأس المال الاجتماعي: 50,000,000 د.ج  |  رقم القيد في السجل التجاري: 16/00-109483B', w - 90, 235);
    ctx.fillText('رقم الانخراط في الصندوق الوطني للتأمينات الاجتماعية (CNAS): 161094839201', w - 90, 260);

    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Réf: RH/AT-2026/089', 90, 205);
    ctx.fillText(`Alger, le ${new Date().toLocaleDateString('fr-DZ')}`, 90, 235);

    // Title Box
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(140, 310, w - 280, 80, 8);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(140, 310, w - 280, 80);
      ctx.strokeRect(140, 310, w - 280, 80);
    }

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
    ctx.fillText('شــهــادة عــمــل ومــمــارســة مــهــنــيــة', w / 2, 362);

    // Body
    ctx.textAlign = 'right';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';

    const startY = 470;
    const lineHeight = 48;

    const lines = [
      'يشهد مدير الموارد البشرية والشؤون الاجتماعية بالشركة المذكورة أعلاه،',
      'أن السيد(ة): مزياني عبد القادر (MEZIANI ABDELKADER)',
      'المولود بتاريخ: 04 مارس 1991 بالبليدة (ولاية البليدة)،',
      'الحامل لبطاقة التعريف الوطنية رقم: 110948271039 الصادرة عن دائرة بوفاريك،',
      '',
      'يعمل لدى مؤسستنا بموجب عقد عمل غير محدد المدة (CDI) بالتوقيت الكامل،',
      'ويشغل حالياً منصب: مهندس رئيسي في تطوير البرمجيات والأنظمة السحابية (Ingénieur Principal)',
      'وذلك ابتداءً من تاريخ: 01 نوفمبر 2019 إلى غاية يومنا هذا.',
      '',
      'خلال فترة عمله، أبان المعني بالأمر عن انضباط مهني رفيع، كفاءة تقنية عالية،',
      'والتزام تام بالنظام الداخلي وقوانين العمل والتشريع المعمول به في الجمهورية الجزائرية.',
      '',
      'سُلِّمت له هذه الشهادة بطلب منه لاستعمالها في حدود ما يخوله له القانون.'
    ];

    lines.forEach((line, idx) => {
      ctx.fillText(line, w - 90, startY + idx * lineHeight);
    });

    // Signatures
    const sigY = 1240;
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`حرر بالجزائر في: ${new Date().toLocaleDateString('ar-DZ')}`, w - 90, sigY);

    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(w - 490, sigY + 40, 400, 180);

    ctx.textAlign = 'center';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('ختم وتوقيع مدير الموارد البشرية', w - 290, sigY + 75);
    ctx.font = 'italic 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.direction = 'ltr';
    ctx.fillText('Le Directeur des Ressources Humaines', w - 290, sigY + 105);

    // Footer
    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية — وثيقة تثبيت مهني رسمية CNAS', w / 2, 1680);

    return {
      id: 'work_cert',
      name: 'شهادة_عمل_مهنية_رسمية.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 5: Official Administrative Request Application Form
   * (استمارة طلب خطي إداري رسمي جزائري - Demande Administrative)
   */
  static createAdministrativeRequest() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 26px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 90);

    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE', w / 2, 125);

    // Divider
    ctx.strokeStyle = '#047857';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 200, 145);
    ctx.lineTo(w / 2 + 200, 145);
    ctx.stroke();

    // Applicant Details (Top Right)
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('الاسم واللقب: شريف يوسف (CHERIF YOUCEF)', w - 90, 200);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('العنوان: حي 500 مسكن، عمارة ب رقم 08، ولاية قسنطينة', w - 90, 230);
    ctx.fillText('رقم الهاتف: 06 61 23 45 67  |  البريد الإلكتروني: y.cherif@gmail.com', w - 90, 260);

    // Recipient Administration (Top Left)
    ctx.textAlign = 'left';
    ctx.direction = 'rtl';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('إلى السيد: والي ولاية الجزائر', 90, 310);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('الموضوع: طلب الحصول على رخصة إدارية واستغلال مهني', 90, 340);
    ctx.fillText('المرجع: القانون رقم 08-09 المتضمن الإجراءات الإدارية', 90, 370);

    // Salutation
    ctx.textAlign = 'right';
    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('يشرفني أن أتقدم إلى سيادتكم المحترمة بهذا الطلب قصد:', w - 90, 440);

    // Body
    ctx.font = '19px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';

    const startY = 490;
    const lineHeight = 46;

    const lines = [
      'أحيطكم علماً سيدي المحترم أنني صاحب مؤسسة ناشئة معتمدة تحت علامة (Start-up Dz)،',
      'تنشط في مجال تطوير حلول التحول الرقمي وأرشفة الوثائق السحابية الوطنية،',
      'وحيث أننا نستوفي كافة الشروط القانونية والتقنية المقررة بالدفتر النموذجي،',
      '',
      'فإنني ألتمس من سيادتكم التكرم بالموافقة على منحنا الاعتماد الإداري اللازم لتوسيع نشاطنا،',
      'مع استعدادنا التام لتقديم كافة الشروحات والمعاينات الميدانية التي تراها مصالحكم مفيدة.',
      '',
      'تجدون رفقة هذا الطلب الملف الإداري الكامل متضمناً:',
      '• نسخة من السجل التجاري الإلكتروني وبطاقة التعريف البيومترية.',
      '• نسخة من القانون الأساسي للمؤسسة والترقيم الجبائي (NIF/NIS).',
      '• شهادات الكفاءة المهنية والاعتماد التقني الوطني.',
      '',
      'وفي انتظار ردكم الإيجابي، تفضلوا سيدي المحترم بقبول أسمى عبارات التقدير والاحترام.'
    ];

    lines.forEach((line, idx) => {
      ctx.fillText(line, w - 90, startY + idx * lineHeight);
    });

    // Date & Signature
    const sigY = 1260;
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`حرر بـ: الجزائر في ${new Date().toLocaleDateString('ar-DZ')}`, w - 90, sigY);

    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(w - 440, sigY + 40, 350, 180);

    ctx.textAlign = 'center';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('إمضاء المعني بالأمر', w - 265, sigY + 75);

    // Footer
    ctx.textAlign = 'center';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('نموذج طلب إداري مطابق للتشريع والترتيبات الإدارية الجزائرية الرسمية', w / 2, 1680);

    return {
      id: 'admin_request',
      name: 'طلب_خطي_إداري_رسمي.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 6: Official Algerian Salary Slip / Administrative Pay Sheet
   * (كشف راتب ومستحقات إدارية جزائرية - Fiche de Paie DZD)
   */
  static createPaySlip() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;

    ctx.textAlign = 'center';
    ctx.direction = 'rtl';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px "Segoe UI", Arial, sans-serif';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية', w / 2, 80);

    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('RÉPUBLIQUE ALGÉRIENNE DÉMOCRATIQUE ET POPULAIRE', w / 2, 110);

    // Header company & month
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('المؤسسة الوطنية للإعلام الآلي والرقمنة (ش.ذ.م.م)', w - 90, 160);
    ctx.font = '14px monospace';
    ctx.fillStyle = '#475569';
    ctx.fillText('NIF: 00191609840291 | NIS: 098472910 | Cotisation CNAS: 16-1094829', w - 90, 190);

    ctx.textAlign = 'left';
    ctx.direction = 'ltr';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('BULLETIN DE PAIE / كشف الراتب', 90, 160);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.fillText(`Période: ${new Date().toLocaleDateString('fr-DZ', { month: 'long', year: 'numeric' })}`, 90, 190);

    // Employee Box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(90, 220, w - 180, 100);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, 220, w - 180, 100);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('الموظف: بن سالم عبد النور (BEN SALEM ABDENNOUR)', w - 110, 250);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('الوظيفة: رئيس مشروع برمجي (Chef de Projet Senior)  |  الصنف: 16 / الدرجة: 04', w - 110, 280);
    ctx.fillText('رقم الحساب البريدي الجاري (CCP): 0019482019 Clé 45  |  رقم الضمان الاجتماعي: 91 16 09 48 29 10', w - 110, 305);

    // Salary Table Header
    const tTop = 350;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(90, tTop, w - 180, 42);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('عناصر الراتب والمنح (Rubriques)', w - 110, tTop + 26);
    ctx.fillText('الأساس د.ج', w - 500, tTop + 26);
    ctx.fillText('المستحقات د.ج (Gains)', w - 720, tTop + 26);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillText('الاقتطاعات د.ج (Retenues)', 110, tTop + 26);

    // Salary Rows
    const sRows = [
      { name: 'الراتب الأساسي (Salaire de Base)', base: '115,000.00', gain: '115,000.00', ret: '-' },
      { name: 'منحة الخبرة المهنية (IEP 20%)', base: '23,000.00', gain: '23,000.00', ret: '-' },
      { name: 'منحة المسؤولية والمنصب النوعي (PRI)', base: '18,500.00', gain: '18,500.00', ret: '-' },
      { name: 'تعويض النقل والمردودية (Transport & Panier)', base: '12,000.00', gain: '12,000.00', ret: '-' },
      { name: 'اشتراك الضمان الاجتماعي (CNAS 9%)', base: '156,500.00', gain: '-', ret: '14,085.00' },
      { name: 'الضريبة على الدخل الإجمالي (IRG Barème 2026)', base: '142,415.00', gain: '-', ret: '22,480.00' }
    ];

    let rY = tTop + 42;
    ctx.font = '14px "Segoe UI", Arial, sans-serif';

    sRows.forEach((r, idx) => {
      ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      ctx.fillRect(90, rY, w - 180, 44);
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(90, rY, w - 180, 44);

      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'right';
      ctx.direction = 'rtl';
      ctx.fillText(r.name, w - 110, rY + 28);
      ctx.fillText(r.base, w - 500, rY + 28);
      ctx.fillText(r.gain, w - 720, rY + 28);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillText(r.ret, 110, rY + 28);

      rY += 44;
    });

    // Summary Totals
    const sumY = rY + 30;
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(90, sumY, w - 180, 110);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, sumY, w - 180, 110);

    ctx.textAlign = 'right';
    ctx.direction = 'rtl';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('الراتب الخام الخاضع للضمان (Brut Cotisable): 156,500.00 د.ج', w - 120, sumY + 35);
    ctx.fillText('مجموع الاقتطاعات (Total Retenues): 36,565.00 د.ج', w - 120, sumY + 70);

    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.fillText('صافي الراتب للدفع (Net à Payer):', 480, sumY + 55);
    ctx.font = 'bold 22px monospace';
    ctx.fillText('131,935.00 د.ج', 210, sumY + 55);

    // Signatures
    const sigY = sumY + 180;
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, sigY, 400, 160);
    ctx.strokeRect(w - 490, sigY, 400, 160);

    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('توقيع الموظف المستفيد', 290, sigY + 35);
    ctx.fillText('تأشيرة وختم المحاسب المالي', w - 290, sigY + 35);

    return {
      id: 'pay_slip',
      name: 'كشف_راتب_رسمي_Fiche_Paie.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 7: Clean Blank A4 Paper Sheet
   */
  static createBlankPage(pageIndex = 1) {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;
    const h = canvas.height;

    // Corner margin guides (Acrobat-style)
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(90, 70); ctx.lineTo(90, 90); ctx.lineTo(70, 90);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w - 90, 70); ctx.lineTo(w - 90, 90); ctx.lineTo(w - 70, 90);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(90, h - 70); ctx.lineTo(90, h - 90); ctx.lineTo(70, h - 90);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(w - 90, h - 70); ctx.lineTo(w - 90, h - 90); ctx.lineTo(w - 70, h - 90);
    ctx.stroke();

    return {
      id: `blank_${pageIndex}`,
      name: `صفحة_بيضاء_${pageIndex}.pdf`,
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Returns list of all official templates with titles, descriptions and icons
   */
  static getTemplatesList() {
    return [
      {
        id: 'cert_admin',
        titleAr: 'شهادة إدارية رسمية مطابقة',
        titleFr: 'Attestation Administrative Conforme',
        titleEn: 'Official Administrative Certificate',
        descAr: 'شهادة إدارية صادرة عن قطاع التعليم العالي والداخلية مع الرقم الوطني للتحقق',
        action: () => this.createAdministrativeCertificate()
      },
      {
        id: 'inv_commercial',
        titleAr: 'فاتورة وعقد تجاري رسمي (DZD)',
        titleFr: 'Facture & Contrat Commercial (DZD)',
        titleEn: 'Commercial Invoice & Contract (DZD)',
        descAr: 'فاتورة رسمية بالدينار الجزائري مع حساب الرسم على القيمة المضافة 19% والترقيم الجبائي NIF/NIS',
        action: () => this.createCommercialContract()
      },
      {
        id: 'honor_declaration',
        titleAr: 'تصريح شرفي رسمي جزائري',
        titleFr: 'Déclaration sur l’Honneur',
        titleEn: 'Official Declaration on Honor',
        descAr: 'نموذج تصريح شرفي معتمد ومطابق لأحكام قانون العقوبات والإجراءات الإدارية البلدية',
        action: () => this.createHonorDeclaration()
      },
      {
        id: 'work_cert',
        titleAr: 'شهادة عمل وممارسة مهنية',
        titleFr: 'Attestation de Travail Officielle',
        titleEn: 'Official Work Certificate',
        descAr: 'شهادة إثبات مهني للمستخدمين والمهندسين متوافقة مع متطلبات الضمان الاجتماعي CNAS',
        action: () => this.createWorkCertificate()
      },
      {
        id: 'admin_request',
        titleAr: 'استمارة طلب خطي إداري',
        titleFr: 'Demande Administrative Officielle',
        titleEn: 'Official Administrative Request',
        descAr: 'طلب خطي رسمي موجه للولاة والإدارات والوزارات وفق الأصول البروتوكولية الإدارية',
        action: () => this.createAdministrativeRequest()
      },
      {
        id: 'pay_slip',
        titleAr: 'كشف راتب ومستحقات (Fiche de Paie)',
        titleFr: 'Bulletin de Paie / Fiche de Paie',
        titleEn: 'Official Salary Slip (Pay Sheet)',
        descAr: 'كشف راتب جزائري مع اقتطاعات CNAS 9% والضريبة IRG والصافي للدفع',
        action: () => this.createPaySlip()
      },
      {
        id: 'blank',
        titleAr: 'صفحة بيضاء نقية (A4 Blank)',
        titleFr: 'Page Blanche A4 Vierge',
        titleEn: 'Pure Blank A4 Sheet',
        descAr: 'صفحة بيضاء نظيفة جاهزة للكتابة، الرسم، وإدراج الأختام والمخططات',
        action: (idx) => this.createBlankPage(idx)
      }
    ];
  }
}
