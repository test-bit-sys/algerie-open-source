/**
 * DZ-PDF: Official Algerian Document Templates Generator
 * Creates authentic high-resolution administrative documents, contracts, and certificates
 * for instant demonstration, editing, signing, and stamping.
 * 
 * 100% offline, zero dependencies, pure HTML5 Canvas.
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
   * Template 1: Official Administrative Decision / Attestation
   * (الجمهورية الجزائرية الديمقراطية الشعبية - وزارة الداخلية والجماعات المحلية)
   */
  static createAdministrativeCertificate() {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;
    const h = canvas.height;

    // Header Republic Title (Bilingual Arabic / French)
    ctx.textAlign = 'center';
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

    // Ministry & Wilaya details (Left and Right)
    ctx.textAlign = 'right';
    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('وزارة التعليم العالي والبحث العلمي', w - 90, 200);
    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillText('جامعة العلوم والتكنولوجيا هواري بومدين', w - 90, 230);
    ctx.fillText('نيابة المديرية للدراسات العليا والبحث', w - 90, 260);

    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Wilaya d’Alger', 90, 200);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Réf: 1428 / UDB-DZ / 2026', 90, 230);
    ctx.fillText(`Alger, le ${new Date().toLocaleDateString('fr-DZ')}`, 90, 260);

    // Document Title Box
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.roundRect(140, 320, w - 280, 80, 8);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
    ctx.fillText('شــهــادة إداريــة مــطــابــقــة', w / 2, 372);

    // Body text (Formal Algerian administrative phrasing)
    ctx.textAlign = 'right';
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
    ctx.fillText('رمز التحقق الرقمي', 200, 1135);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#059669';
    ctx.fillText('DZ-SEC-99482-AUTH', 200, 1165);
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('منظومة التوثيق الرقمي الوطني', 200, 1195);

    // Footer signature designations
    ctx.textAlign = 'right';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('حرر بالجزائر في: ' + new Date().toLocaleDateString('ar-DZ'), w - 90, 1260);

    ctx.font = 'bold 20px "Segoe UI", Arial, sans-serif';
    ctx.fillText('توقيع وختم المسؤول الإداري المفوّض', w - 90, 1310);
    ctx.font = 'italic 16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Le Directeur Général des Services', w - 90, 1340);

    // Bottom official watermark border
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(90, 1630);
    ctx.lineTo(w - 90, 1630);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '13px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('الجمهورية الجزائرية الديمقراطية الشعبية — وثيقة رسمية مؤمنة بنظام التوثيق المفتوح DZ Open Suite', w / 2, 1665);

    return {
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
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText('مؤسسة الخدمات الرقمية والتطوير البرمجي (DZ Open Suite)', w - 90, 90);

    ctx.font = '15px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('شارع ديدوش مراد، الجزائر الوسطى، ولاية الجزائر', w - 90, 125);
    ctx.fillText('هاتف: +213 (0) 23 45 67 89  |  البريد: contact@dz-suite.dz', w - 90, 150);

    // Fiscal details
    ctx.font = '14px monospace';
    ctx.fillStyle = '#1e293b';
    ctx.fillText('NIF: 002116098472910 | NIS: 09823419082 | RC: 16/00-098472B21 | Art: 16120938471', w - 90, 185);

    // Left Box: Invoice details
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(90, 60, 320, 130);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(90, 60, 320, 130);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillText('فاتورة رسمية / FACTURE N° 2026/048', 110, 95);
    ctx.font = '14px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText(`تاريخ الفاتورة: ${new Date().toLocaleDateString('ar-DZ')}`, 110, 125);
    ctx.fillText('طريقة الدفع: تحويل بنكي / صك بريدي CCP', 110, 150);
    ctx.fillText('أجل الاستحقاق: عند الاستلام الفوري', 110, 175);

    // Client Info Box
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(90, 230, w - 180, 90);
    ctx.strokeRect(90, 230, w - 180, 90);

    ctx.textAlign = 'right';
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
    ctx.fillText('البيان والخدمة (Désignation)', w - 120, tableTop + 28);
    ctx.fillText('الكمية', w - 500, tableTop + 28);
    ctx.fillText('السعر الفردي (د.ج)', w - 660, tableTop + 28);
    ctx.fillText('نسبة الرسم (TVA)', w - 850, tableTop + 28);
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
      ctx.fillText(r.desc, w - 120, rowY + 30);
      ctx.fillText(r.qty, w - 500, rowY + 30);
      ctx.fillText(r.price, w - 660, rowY + 30);
      ctx.fillText(r.tva, w - 850, rowY + 30);
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
    ctx.fillStyle = '#475569';
    ctx.fillText('المجموع الخام (Total HT):', sumX + sumW - 20, sumY + 35);
    ctx.fillText('مجموع الرسم (Total TVA 19%):', sumX + sumW - 20, sumY + 70);
    ctx.fillText('رسم الطابع الجبائي (Timbre):', sumX + sumW - 20, sumY + 105);

    ctx.font = 'bold 17px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = '#059669';
    ctx.fillText('المبلغ الإجمالي بكل الرسوم (TTC):', sumX + sumW - 20, sumY + 140);

    ctx.textAlign = 'left';
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
    ctx.fillStyle = '#334155';
    ctx.fillText('تأشيرة وختم العميل / المشتري', 290, sigY + 30);
    ctx.fillText('ختم وتوقيع المدير المالي والإداري', w - 290, sigY + 30);

    return {
      name: 'فاتورة_وعقد_تجاري_رسمي.pdf',
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }

  /**
   * Template 3: Clean Blank A4 Paper Sheet
   */
  static createBlankPage(pageIndex = 1) {
    const { canvas, ctx } = this.createCanvas();
    const w = canvas.width;
    const h = canvas.height;

    // Subtle corner margin guides (Acrobat-style)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    // Top-left guide
    ctx.beginPath();
    ctx.moveTo(90, 70); ctx.lineTo(90, 90); ctx.lineTo(70, 90);
    ctx.stroke();
    // Top-right guide
    ctx.beginPath();
    ctx.moveTo(w - 90, 70); ctx.lineTo(w - 90, 90); ctx.lineTo(w - 70, 90);
    ctx.stroke();
    // Bottom-left guide
    ctx.beginPath();
    ctx.moveTo(90, h - 70); ctx.lineTo(90, h - 90); ctx.lineTo(70, h - 90);
    ctx.stroke();
    // Bottom-right guide
    ctx.beginPath();
    ctx.moveTo(w - 90, h - 70); ctx.lineTo(w - 90, h - 90); ctx.lineTo(w - 70, h - 90);
    ctx.stroke();

    return {
      name: `صفحة_فارغة_${pageIndex}.pdf`,
      dataUrl: canvas.toDataURL('image/jpeg', 0.95),
      canvas
    };
  }
}
