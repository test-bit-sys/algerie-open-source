/**
 * Starting points for new pages, and the pages a new workspace begins with.
 * Blocks are plain specs for insertBlocks(); databases list their
 * properties, views and rows.
 */
const t = (text, extra = {}) => ({ type: 'paragraph', text, ...extra });
const h = (n, text) => ({ type: `h${n}`, text });
const todo = (text, checked = false, indent = 0) => ({ type: 'todo', text, checked, indent });
const bullet = (text, indent = 0) => ({ type: 'bulleted', text, indent });

export const TEMPLATES = [
  {
    id: 'dz_fiche_projet',
    name: '🇩🇿 بطاقة مشروع تقني (Fiche Projet)',
    description: 'أهداف المشروع، النطاق، المعالم، والمسؤوليات',
    icon: { name: 'target', color: 'green' },
    blocks: () => [
      { type: 'callout', icon: 'flag', bg: 'green', text: 'الجمهورية الجزائرية الديمقراطية الشعبية — بطاقة مشروع سيادي' },
      h(2, 'أهداف المشروع والمبررات'),
      bullet('الهدف الرئيسي: '),
      bullet('الأثر المتوقع: '),
      h(2, 'المعالم والمراحل الرئيسية (Milestones)'),
      todo('إطلاق مرحلة التصور والتصميم الأولي'),
      todo('مراجعة المتطلبات الفنية والأمنية السيادية'),
      todo('التشغيل التجريبي والتحقق من الجاهزية'),
      todo('الإطلاق الرسمي والتعميم'),
      h(2, 'فريق العمل والمسؤوليات'),
      t('مدير المشروع: '),
      t('فريق التطوير والمهندسون: '),
      h(2, 'المخاطر وخطط المعالجة'),
      { type: 'toggle', text: 'مخاطر استمرارية الخدمة' },
      t('الاعتماد الكامل على الحلول المحلية 100% لتفادي الانقطاعات الخارجية.', { indent: 1 }),
    ],
  },
  {
    id: 'dz_pv_reunion',
    name: '🇩🇿 محضر اجتماع عمل رسمي (PV)',
    description: 'جدول الأعمال، الحاضرون، القرارات، والتوصيات',
    icon: { name: 'users', color: 'blue' },
    blocks: () => [
      { type: 'callout', icon: 'calendar', bg: 'blue', text: `تاريخ الاجتماع: ${new Date().toLocaleDateString('ar-DZ', { dateStyle: 'full' })}` },
      h(2, 'الحاضرون والغائبون'),
      bullet('السيد(ة): '),
      bullet('السيد(ة): '),
      h(2, 'جدول الأعمال (Ordre du jour)'),
      { type: 'numbered', text: 'عرض حالة تقدم الأعمال' },
      { type: 'numbered', text: 'مناقشة النقاط العالقة' },
      { type: 'numbered', text: 'اتخاذ القرارات وتوزيع المهام' },
      h(2, 'ملخص النقاش والقرارات المتخذة'),
      t(''),
      h(2, 'المهام ومواعيد التنفيذ (Actions)'),
      todo('متابعة تنفيذ التوصيات — التاريخ: '),
    ],
  },
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, notes and action items',
    icon: { name: 'users', color: 'blue' },
    blocks: () => [
      { type: 'callout', icon: 'calendar', bg: 'blue', delta: [{ insert: 'Date: ' }, { insert: new Date().toLocaleDateString(undefined, { dateStyle: 'long' }), attributes: { bold: true } }] },
      h(2, 'Attendees'),
      bullet(''),
      h(2, 'Agenda'),
      { type: 'numbered', text: '' },
      h(2, 'Notes'),
      t(''),
      h(2, 'Action items'),
      todo(''),
    ],
  },
  {
    id: 'brief',
    name: 'Project brief',
    description: 'Goals, scope and milestones',
    icon: { name: 'target', color: 'red' },
    blocks: () => [
      { type: 'callout', icon: 'lightbulb', bg: 'yellow', text: 'One sentence that explains why this project matters.' },
      h(2, 'Goals'),
      bullet(''),
      h(2, 'Out of scope'),
      bullet(''),
      h(2, 'Milestones'),
      todo('Kickoff'),
      todo('First review'),
      todo('Launch'),
      h(2, 'Open questions'),
      { type: 'toggle', text: 'Question' },
      t('', { indent: 1 }),
    ],
  },
  {
    id: 'weekly',
    name: 'Weekly plan',
    description: 'Priorities and a day-by-day list',
    icon: { name: 'calendarDays', color: 'green' },
    blocks: () => [
      h(2, 'Top priorities'),
      { type: 'numbered', text: '' },
      ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((d) => [h(3, d), todo('')]),
      h(2, 'Notes'),
      t(''),
    ],
  },
  {
    id: 'tasks',
    name: 'Task board',
    description: 'A database with board and table views',
    icon: { name: 'kanban', color: 'purple' },
    database: {
      props: [
        { name: 'Status', type: 'status' },
        { name: 'Assignee', type: 'text' },
        { name: 'Due', type: 'date' },
      ],
      views: ['board', 'table'],
      rows: [
        { title: 'Write the project brief', status: 2 },
        { title: 'Review designs', status: 1 },
        { title: 'Plan the launch', status: 0 },
      ],
    },
  },
  {
    id: 'reading',
    name: 'Reading list',
    description: 'Books and articles to get to',
    icon: { name: 'bookOpen', color: 'orange' },
    database: {
      props: [
        { name: 'Type', type: 'select', options: ['Book', 'Article', 'Paper'] },
        { name: 'Author', type: 'text' },
        { name: 'Finished', type: 'checkbox' },
        { name: 'Link', type: 'url' },
      ],
      views: ['table', 'gallery'],
      rows: [],
    },
  },
];

export function templateById(id) {
  return TEMPLATES.find((x) => x.id === id) || null;
}

/** The first page in a brand new workspace. */
export function welcomeBlocks() {
  return [
    { type: 'callout', icon: 'sparkles', bg: 'green', text: '🇩🇿 مرحباً بك في منصة DZ-Wiki السيادية. كل صفحاتك ووثائقك وقواعد بياناتك محفوظة محلياً 100% داخل المتصفح بأمان وخصوصية تامة دون أي خوادم خارجية.' },
    h(2, 'التحرير والكتابة السيادية'),
    t('انقر في أي مكان وابدأ الكتابة باللغة العربية أو الفرنسية أو الإنجليزية. اضغط / لإدراج العناوين، القوائم، المهام، الاقتباسات، الأكواد البرمجية، والجداول.'),
    bullet('اختصارات Markdown مدعومة: # للعناوين، - للقوائم النقطية، [] لصناديق المهام، > للاقتباس، ``` للأكواد.'),
    bullet('حدد أي نص لتنسيقه (عريض، مائل، رابط، أو تلوين).'),
    bullet('اسحب المقبض على يمين أو يسار أي كتلة لإعادة ترتيبها أو الوصول إلى خياراتها.'),
    h(2, 'تنظيم المعرفة والمشاريع'),
    todo('أضف صفحة جديدة من الشريط الجانبي عبر زر +', true),
    todo('نظّم الصفحات في شجرة هرمية بسحبها فوق بعضها البعض'),
    todo('ميّز الصفحات الهامة بنجمة لتظهر في المفضلة'),
    { type: 'toggle', text: 'اختصارات لوحة المفاتيح (Shortcuts)' },
    bullet('البحث السريع: Ctrl + K', 1),
    bullet('صفحة جديدة: Ctrl + Alt + N', 1),
    bullet('تحريك الكتلة لأعلى أو لأسفل: Ctrl + Shift + Up/Down', 1),
    bullet('المسافة البادئة: Tab و Shift + Tab', 1),
    h(2, 'قواعد البيانات والجداول'),
    t('تدعم المنصة إنشاء قواعد بيانات متقدمة (لوحات كانبان Kanban، جداول Table، وقوائم مخصصة). جرب قالب "Task board" أو "Fiche Projet".'),
    { type: 'quote', text: 'ملاحظة: يمكنك تصدير أي صفحة بتنسيق Markdown أو نسخها واستيرادها في أي وقت.' },
  ];
}
