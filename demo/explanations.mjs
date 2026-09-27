/**
 * demo/explanations.mjs — what every page is for, and what its parts do.
 *
 * `pages[path]`  = { ar, en, parts: [ { match, ar, en } ] }
 *   match  — RegExp or string tested against a region's kind, label or text
 *            (kind matches are written as 'kind:header' / 'kind:nav'…)
 *            the FIRST region matching wins for each part; parts without a
 *            match fall back to the next unexplained region of the page.
 *
 * `generic`     — explanations used on every page for the shell parts.
 */

export const generic = [
  { match: 'kind:header', ar: 'الهيدر: شعار الكنيسة، اسم المستخدم والدور، التاريخ (قبطي/ميلادي)، جرس الإشعارات، الرسائل وزر القائمة الجانبية.', en: 'Header: church logo, current user & role, the date button (Coptic/Gregorian), notifications bell, messages and the side-menu button.' },
  { match: 'kind:nav', ar: 'شريط المهام السفلي: 5 اختصارات يحددها مالك التطبيق (الرئيسية · المخدومين · الماسح · الإحصائيات · الإعدادات).', en: 'Bottom task bar: 5 shortcuts configured by the owner (home · children · scanner · statistics · settings).' },
  { match: /اختيار الكنيسة|كل الكنائس/, ar: 'محدد النطاق: كنيسة → خدمة → فصل → مناسبة. كل عملية في الصفحة مرتبطة بالنطاق المختار.', en: 'Scope selectors: church → service → class → event. Every action on the page is bound to the selected scope.' },
  { match: /ابحث|بحث/, ar: 'البحث بالاسم أو الهاتف أو الكود.', en: 'Search by name, phone or code.' },
];

const P = (ar, en, parts = []) => ({ ar, en, parts });
const part = (match, ar, en) => ({ match, ar, en });

export const pages = {
  '/login': P(
    'صفحة الدخول الموحدة. الخادم يدخل بالكود (الرقم القومي = كود الـ QR) وكلمة المرور. زر «مسح الكود» يفتح الكاميرا لقراءة الكارت مباشرة. «تذكرني» يحفظ الجلسة على الجهاز.',
    'Unified login. A servant signs in with his code (national id = QR code) and password. "Scan code" opens the camera to read the card. "Remember me" keeps the session on this device.',
    [part('kind:title', 'شعار الإيبارشية واسمها (قابل للتخصيص من متغيرات البيئة).', 'Diocese logo and name (branded via environment variables).'),
     part('kind:tabs', 'التبديل بين دخول الخادم (حساب Supabase) ودخول المخدوم (كود + كلمة مرور عبر RPC).', 'Switch between servant login (Supabase account) and child login (code + password via RPC).'),
     part(/الكود \/ الرقم/, 'حقل الكود — يُكتب أو يُمسح بالكاميرا.', 'Code field — typed or scanned with the camera.'),
     part(/••••/, 'كلمة المرور (الافتراضية للحسابات الجديدة 000000).', 'Password (new accounts default to 000000).'),
     part(/تسجيل الدخول/, 'زر الدخول → الرئيسية. الطلب المعلق يرى صفحة «في انتظار الموافقة».', 'Sign-in → home. A pending servant sees the "awaiting approval" screen.')]
  ),
  '/login?as=child': P(
    'نفس الصفحة مع تبويب «دخول المخدوم»: الطفل يدخل بكود الكارت وكلمة المرور، ويصل إلى بوابته الخاصة /child.',
    'Same page on the "child login" tab: the child enters his card code and password and lands in his own portal (/child).',
    [part(/الكود \(كود الكارت\)|كود الكارت/, 'كود الكارت (QR) الخاص بالمخدوم.', 'The child\'s card (QR) code.'),
     part(/إنشاء حساب/, 'إنشاء حساب مخدوم → معالج التسجيل ثم طلب انضمام معلق.', 'Create a child account → signup wizard then a pending join request.')]
  ),
  '/signup': P(
    'معالج إنشاء حساب خادم من 4 خطوات: مكان الخدمة (كنيسة → خدمة → فصل، مُقفل من رابط الدعوة) → الكود (كتابة / مسح / توليد) → البيانات الشخصية → كلمة المرور. ينتج طلب انضمام يوافق عليه المسؤول.',
    'Four-step servant signup: place of service (church → service → class, locked from an invite link) → code (typed / scanned / generated) → personal data → password. Produces a join request that a manager approves.',
    [part('kind:list', 'مؤشر الخطوات الأربع.', 'The 4-step indicator.'),
     part('kind:form', 'الخطوة الحالية: اختيار الكنيسة والخدمة والفصل.', 'Current step: pick church, service and class.'),
     part('kind:button', 'التالي — يتحقق من الخطوة قبل المتابعة.', 'Next — validates the step before moving on.')]
  ),
  '/child/signup': P(
    'معالج إنشاء حساب مخدوم (نفس الخطوات الأربع). الفصل إجباري، والكود يُفحص مباشرة (`child_signup_lookup_code`). عند الإرسال يُنشأ طلب انضمام معلق، وتتابع الصفحة حالته حتى الموافقة.',
    'Child signup wizard (same 4 steps). Class is required, the code is checked live. Submit creates a pending join request and the page polls its status until approval.',
  ),

  '/': P(
    'الرئيسية: شبكة ودجات يختارها المالك ويرتبها من «تخصيص → ودجات الرئيسية». كل ودجت يعرض بيانات نطاق المستخدم فقط (RLS) ويحدَّث لحظياً.',
    'Home: a grid of widgets the owner picks and orders in "Customize → Home widgets". Each widget shows only the user\'s scope (RLS) and refreshes in realtime.',
    [part(/صباح|مساء|أهلاً/, 'ترحيب بالاسم والدور، التاريخ الميلادي والقبطي وآية اليوم.', 'Greeting with name & role, Gregorian + Coptic date and the verse of the day.'),
     part(/نبض اليوم/, 'نبض اليوم: نسبة حضور اليوم، الحاضرون، ونقاط اليوم.', 'Today\'s pulse: attendance % today, present count and today\'s points.'),
     part(/^المناسبة/, 'المناسبة الحالية/القادمة مع اختصار للماسح.', 'Current / next event with a shortcut to the scanner.'),
     part(/الأشخاص/, 'أرقام النطاق: أشخاص · حضور اليوم · تسجيلات · فصول · خدمات · كنائس.', 'Scope counters: persons · present today · enrollments · classes · services · churches.'),
     part(/إجراءات سريعة/, 'اختصارات: الماسح، إضافة مخدوم، المخدومين، الرسائل، الإحصائيات…', 'Quick actions: scanner, add child, children, messages, statistics…'),
     part(/طلبات معلقة/, 'طلبات تنتظر قرارك: انضمام خدام، تعديل بيانات، انضمام مخدومين.', 'Requests awaiting you: servant joins, data changes, child joins.'),
     part(/أعياد الميلاد/, 'أعياد الميلاد القادمة مع أزرار اتصال / واتساب.', 'Upcoming birthdays with call / WhatsApp buttons.'),
     part(/الافتقاد/, 'الافتقاد: غائبو آخر مناسبة ومن يحتاج متابعة.', 'Follow-up: absentees of the last event and children needing a call.'),
     part(/أبطال النقاط/, 'لوحة الصدارة بالنقاط.', 'Points leaderboard.'),
     part(/اتجاه الحضور/, 'اتجاه الحضور خلال 14 يوماً.', '14-day attendance trend.'),
     part(/الفصول الأونلاين/, 'الفصول الأونلاين المباشرة والقادمة.', 'Live and upcoming online classes.'),
     part(/الفعاليات/, 'الفعاليات القادمة وعدد المشاركين.', 'Upcoming occasions and participant counts.')]
  ),
  '/children': P(
    'صفحة المخدومين: القائمة مجمّعة حسب الفصل داخل النطاق المختار. لكل مخدوم بطاقة بها الحضور والنقاط وأزرار الوظائف (حضور · نقاط · مكالمة · رسالة · بيانات · كارت · إنجازات). مفتاح «المخدومين | الخدام» يعرض الخدام كفصول أيضاً.',
    'Children page: the list grouped by class inside the chosen scope. Each child card shows attendance, points and the job buttons (attendance · points · call · message · data · card · achievements). The "children | servants" switch shows servants as classes too.',
    [part(/المخدومين .*الخدام|kind:tabs/, 'مفتاح المخدومين | الخدام والعدد الكلي.', 'Children | servants switch and total count.'),
     part(/مجموعتي/, 'مجموعتي (وحدة الأشابين): عرض أطفالي فقط.', 'My group (shepherds module): show only my children.'),
     part(/^الحضور|حاضر|غائب/, 'الوظيفة الحالية (حضور): ✓ حاضر · ✗ غائب · ★ نقاط تُطبَّق بضغطة على البطاقة.', 'Active job (attendance): ✓ present · ✗ absent · ★ points applied by tapping a card.'),
     part(/الفلاتر/, 'فلاتر: الحالة، النوع، الحضور، النقاط…', 'Filters: status, gender, attendance, points…'),
     part(/الترتيب/, 'الترتيب بالاسم / النقاط / الحضور.', 'Sort by name / points / attendance.'),
     part(/ابتدائي|إعدادي|ثانوي/, 'رأس فصل قابل للطي مع عدد المخدومين. الضغط يفتح بطاقات الفصل.', 'Collapsible class header with count. Tap to open the class cards.')]
  ),
  '/scanner': P(
    'الماسح: كاميرا QR مع لوحة تحكم بأربعة محددات (كنيسة · خدمة · فصل · مناسبة) ووظيفة (حضور / نقاط / بيانات). كل مسح يحل الكود → الشخص → التسجيل ويسجل العملية على المناسبة المختارة، مع أرشيف لعمليات المسح.',
    'Scanner: QR camera with a control panel — four scope selectors (church · service · class · event) and a job (attendance / points / data). Each scan resolves code → person → enrollment and logs it against the chosen event; a scan archive is kept.',
    [part(/كاميرا|الكاميرا|video|مسح/, 'منظر الكاميرا (BarcodeDetector أو jsQR). يمكن اختيار صورة من المعرض.', 'Camera view (BarcodeDetector or jsQR fallback). A gallery image can be used too.'),
     part(/حضور|نقاط|بيانات/, 'اختيار الوظيفة التي تُطبَّق على كل مسح.', 'Pick the job applied to every scan.'),
     part(/الأرشيف|آخر العمليات/, 'أرشيف عمليات المسح مع إمكانية التراجع.', 'Scan archive with undo.')]
  ),
  '/stats': P(
    'الإحصائيات: مؤشرات النطاق (أشخاص، حضور، نقاط)، توزيع حسب المناسبة وحسب سبب النقاط، خط زمني، لوحة صدارة، وتصدير Excel. كل شيء محسوب في قاعدة البيانات عبر RPC.',
    'Statistics: scope KPIs (persons, attendance, points), breakdown by event and by points cause, timelines, leaderboard and Excel export. Everything is computed in the DB via RPCs.',
    [part(/kind:tile/, 'مؤشر رقمي (KPI).', 'A KPI tile.'),
     part(/تصدير/, 'تصدير التقرير إلى Excel.', 'Export to Excel.')]
  ),
  '/settings': P(
    'مركز الإعدادات: روابط إلى كل صفحات الإدارة مرتبة بحسب الدور (الإدارة · النشاط · الوحدات · الحساب). تظهر شارات بعدد الطلبات المعلقة.',
    'Settings hub: links to every management page grouped by role (management · activity · modules · account). Badges show pending counts.',
    [part(/تعديل بياناتي/, 'تعديل بياناتي وتغيير كلمة المرور.', 'Edit my data and change my password.'),
     part(/تسجيل الخروج|خروج/, 'تسجيل الخروج.', 'Sign out.')]
  ),

  '/children/manage': P(
    'إدارة المخدومين → تبويب المخدومين: المكان الوحيد لتعديل / نقل / إيقاف / حذف المخدومين. الشجرة كنيسة → خدمة → فصل، فلاتر (الكل / يعمل / موقوف)، وإيقاف نطاق كامل بضغطة.',
    'Manage children → People tab: the one place to edit / move / stop / delete children. Church → service → class tree, filters (all / active / stopped) and bulk stop of a whole scope.',
    [part('kind:tabs', 'التبويبات: المخدومين · إضافة · الطلبات (شارة) · دعوة QR.', 'Tabs: people · add · requests (badge) · invite QR.'),
     part(/الكل|يعمل|موقوف/, 'فلتر الحالة مع العدادات.', 'Status filter with counters.'),
     part(/إيقاف.*نطاق|تفعيل/, 'إيقاف / تفعيل كنيسة أو خدمة أو فصل بالكامل.', 'Stop / activate a whole church, service or class.'),
     part(/تعديل|حذف/, 'بطاقة شخص: تعديل · إيقاف/تفعيل · حذف.', 'Person card: edit · stop/activate · delete.')]
  ),
  '/children/manage?tab=add': P(
    'إضافة مخدومين: إضافة فردية (كود مكتوب/ممسوح/مولَّد، الاسم، النوع، الهاتف +2، الميلاد، العنوان، الصورة، كلمة مرور البوابة) أو جماعية من Excel / لصق مع مطابقة الأعمدة ومعاينة قابلة للتعديل صفاً بصف.',
    'Add children: single (typed / scanned / generated code, name, gender, +2 phone, birthdate, address, photo, portal password) or bulk from Excel / paste with column mapping and a row-editable preview.',
    [part(/فردي|فردية/, 'إضافة فردية.', 'Single add.'), part(/جماعي|جماعية|Excel/, 'إضافة جماعية من Excel.', 'Bulk add from Excel.')]
  ),
  '/children/manage?tab=requests': P(
    'طلبات انضمام المخدومين: الطلبات المعلقة من معالج التسجيل مع إمكانية تصحيح الكنيسة/الخدمة/الفصل قبل الموافقة، والرفض بملاحظة تُعرض للطفل. تبويب «السجل» للطلبات المحسومة.',
    'Child join requests: pending signups with correctable church / service / class before approval, reject with a note the child sees. A history view lists decided requests.',
  ),
  '/children/manage?tab=invite': P(
    'دعوة بالـ QR: رابط ورمز QR مقيّدان بنطاقك (كنيسة/خدمة/فصل) يفتحان معالج تسجيل المخدوم بالفصل مُقفلاً.',
    'Invite QR: a link + QR bound to your scope that opens the child signup wizard with the class locked.',
  ),
  '/servants': P(
    'إدارة الخدام → الخدام: شجرة كنيسة → خدمة → فصل، لكل خادم بطاقة (الدور، الحالة، النطاقات) وأزرار تعديل · الصلاحيات · إيقاف/تفعيل · حذف — داخل نطاق إدارتك فقط.',
    'Manage servants → Servants: church → service → class tree; each servant card (role, status, scopes) with edit · permissions · suspend/activate · delete — only within your management scope.',
    [part('kind:tabs', 'التبويبات: الخدام · إضافة · الطلبات · دعوة QR.', 'Tabs: servants · add · requests · invite QR.'),
     part(/الصلاحيات/, 'ربط الخادم بملفات الصلاحيات التي أنشأها المالك.', 'Attach the servant to the owner-made permission profiles.')]
  ),
  '/servants?tab=add': P(
    'إضافة خدام مباشرة (بدون طلب انضمام): فردي في 4 كتل (الدور ومكان الخدمة · الكود · البيانات · كلمة المرور + ملفات الصلاحيات) أو جماعي من Excel مع توليد أكواد وكلمات مرور وتصدير بيانات الدخول.',
    'Add servants directly (no join request): single form in 4 blocks (role & place · code · data · password + permission profiles) or bulk from Excel with auto codes / passwords and an Excel export of the credentials.',
  ),
  '/servants?tab=approvals': P(
    'طلبات انضمام الخدام: عرض بيانات الطالب، تحديد الدور والنطاق وملفات الصلاحيات ثم الموافقة أو الرفض. لحظي — الخادم المنتظر يدخل فوراً بعد الموافقة.',
    'Servant join requests: see the applicant\'s data, set role, scope and permission profiles, then approve or reject. Realtime — the waiting servant gets in instantly.',
  ),
  '/servants?tab=invite': P(
    'دعوة خادم: رابط + QR بنطاق المسؤول يفتحان معالج تسجيل الخادم مع مكان الخدمة مُعبّأ ومقفلاً.',
    'Servant invite: link + QR scoped to the manager that opens the servant signup wizard with the place pre-filled and locked.',
  ),
  '/family': P(
    'وحدة العائلات: قائمة العائلات (بحث بالعائلة أو الكود أو أحد الأفراد)، أفراد كل عائلة بصلة القرابة، إنشاء / تعديل / حذف، وكود QR للعائلة.',
    'Families module: families list (search by family, code or member), members with relation, create / edit / delete and a family QR.',
  ),
  '/family?tab=qr': P(
    'إضافة أفراد إلى عائلة: مسح كود الفرد بالكاميرا، أو البحث عن شخص موجود، أو إنشاء شخص جديد.',
    'Add members to a family: scan the member\'s code, search an existing person, or create a new one.',
  ),

  '/settings/churches': P('إدارة الكنائس (المالك ومدير الكنيسة): الاسم، الشعار، والعدادات.', 'Manage churches (owner + church manager): name, logo, counters.'),
  '/settings/services': P('إدارة الخدمات مجمّعة حسب الكنيسة: الاسم والصورة والكنيسة التابعة.', 'Manage services grouped by church: name, photo, parent church.'),
  '/settings/classes': P('إدارة الفصول (كنيسة → خدمة): الاسم والصورة، مع عدد المخدومين.', 'Manage classes (church → service): name, photo, child counts.'),
  '/settings/events': P('إدارة المناسبات: المستوى الرابع من النطاق. كل مناسبة لها جدول ونقاط حضور وقد تكون الافتراضية لكنيسة / خدمة / فصل.', 'Manage events: the 4th scope level. Each event has a schedule, attendance points and can be the default for a church / service / class.'),
  '/settings/causes': P('إدارة أسباب النقاط: أسباب الإضافة والخصم بقيمة افتراضية ولون، مرتّبة يدوياً وبنطاق.', 'Manage points causes: add / deduct reasons with a default value and color, ordered and scoped.'),
  '/settings/call-feedbacks': P('نتائج الافتقاد: القوالب التي تُختار بعد المكالمة (اسم، لون، أيقونة) بنطاق كنيسة → خدمة → فصل → مناسبة.', 'Call feedback presets picked after a call (name, color, icon), scoped church → service → class → event.'),
  '/settings/data-requests': P('طلبات تعديل البيانات والصور المرسلة من بوابة المخدوم: معاينة قبل/بعد ثم موافقة أو رفض.', 'Photo & data-change requests sent from the child portal: before / after preview then approve or reject.'),
  '/settings/cards': P('قوالب الكروت: قوالب التصميم بنطاق مع قالب افتراضي؛ من هنا إلى المصمم والطباعة.', 'Card templates: scoped design templates with a default; entry to the designer and printing.'),
  [`/settings/cards/d4000000-0000-4000-8000-000000000001`]: P(
    'مصمم الكروت: تبويبات التصميم (لوحة سحب وإفلات للعناصر: اسم، كود QR، صورة، متغيرات، وجه وظهر) · طباعة كارت واحد · طباعة جماعية على A4 مع ملفات طباعة محفوظة.',
    'Card designer: Design tab (drag & drop elements: name, QR, photo, variables, front & back) · Print one card · Bulk print on A4 sheets with saved print profiles.',
  ),
  '/settings/backup': P('النسخ الاحتياطي: نسخ يدوي / مجدول لجداول مختارة إلى مخزن خاص، سجل التشغيل، والاسترجاع مع استعادة حسابات الدخول.', 'Backup & restore: manual / scheduled backups of chosen tables to a private bucket, run history, and restore incl. auth accounts.'),

  '/owner': P('وحدة المالك: مركز الأدوات المخصصة لمالك التطبيق فقط — صلاحيات الوحدات، ملفات الصلاحيات، إدارة الأفراد، التخصيص.', 'Owner module: hub of owner-only tools — module grants, permission profiles, persons management, customization.'),
  '/owner/modules': P('صلاحيات الوحدات: لكل وحدة اختيارية (المتجر، الامتحانات، أعياد الميلاد…) من يراها: كنيسة → خدمة → فصل، أو أشخاص محددون، أو إظهار/إخفاء للجميع.', 'Module grants: for each optional module, who sees it — church → service → class, specific people, or show / hide for everyone.'),
  '/owner/permissions': P('ملفات الصلاحيات: مجموعات مفاتيح (مثل children.attendance · servants.approve · activity.<item>.<action>) بلون واسم، تُربط بالخدام من إدارة الخدام.', 'Permission profiles: sets of keys (e.g. children.attendance · servants.approve · activity.<item>.<action>) with a color and name, attached to servants from Manage servants.'),
  '/owner/persons': P('إدارة الأفراد: كل الأشخاص في قاعدة البيانات (مخدومين وخدام) مع تسجيلاتهم، بحث، تعديل، دمج وحذف جماعي.', 'Persons management: every person in the DB (children & servants) with their enrollments; search, edit, merge and bulk delete.'),
  '/owner/customize': P('تخصيص التطبيق: شريط المهام · أيقونات الهيدر · ودجات الرئيسية · أسماء الصفحات · نظام الأكواد.', 'Customize the app: task bar · header icons · home widgets · page names · code system.'),
  '/owner/customize/taskbar': P('شريط المهام: 5 خانات لكل منها وجهة وأيقونة واسم؛ ينطبق على كل المستخدمين.', 'Task bar: 5 slots, each with a destination, icon and label; applies to every user.'),
  '/owner/customize/header': P('أيقونات الهيدر والروابط السريعة في الأعلى.', 'Header icons and quick links at the top.'),
  '/owner/customize/widgets': P('ودجات الرئيسية: اختيار، ترتيب، حجم (نصف / كامل) وعنوان كل ودجت.', 'Home widgets: pick, order, size (half / full) and title of each widget.'),
  '/owner/customize/names': P('أسماء الصفحات والوحدات: إعادة تسمية أي صفحة أو وحدة في كل مكان بالتطبيق.', 'Page & module names: rename any page or module everywhere in the app.'),
  '/owner/customize/codes': P('نظام الأكواد: شكل الأكواد المولَّدة — الأجزاء، الفاصل، اختصارات النطاق، ووضع كل مولِّد.', 'Code system: how generated codes look — parts, separator, scope abbreviations and per-generator mode.'),

  '/shepherds': P('وحدة الأشابين: كل خادم يبني «مجموعتي» من الأطفال غير المختارين؛ المسؤولون يرون كل المجموعات في نطاقهم.', 'Shepherds module: each servant builds "my group" from unclaimed children; managers see every group in scope.'),
  '/store': P('إستبدال النقاط — المركز: إحصاءات اليوم وروابط المخزون والكاشير والأرشيف.', 'Points store hub: today\'s stats and links to inventory, POS and archive.'),
  '/store/inventory': P('المخزون: أصناف بكود، اسم، صورة، سعر بالنقاط، رصيد ونطاق؛ تعديل سريع ± للرصيد وطباعة ملصقات QR.', 'Inventory: items with code, name, picture, price in points, stock and scope; quick ± stock and QR label printing.'),
  '/store/pos': P('الكاشير: مسح كارت الطفل → سلة برصيده الحي → مسح / اختيار الأصناف بالكمية → الإجمالي والمتبقي مع حراسة الرصيد والمخزون → تأكيد وإيصال.', 'POS: scan the child\'s card → basket with live balance → scan / pick items with qty → total & remaining with balance / stock guard → confirm & receipt.'),
  '/store/archive': P('أرشيف الفواتير: بحسب اليوم، بحث، فلاتر النطاق والحالة، تفاصيل الفاتورة، وإلغاء يعيد النقاط والمخزون.', 'Bill archive: by day, search, scope & status filters, bill detail, and cancel (refunds points + restocks).'),
  '/exams': P('الامتحانات — المركز: كل امتحان في النطاق بحالته وعدد الأسئلة والمحاولات ونسبة النجاح؛ إنشاء ونسخ.', 'Exams hub: every exam in scope with status, questions, attempts and pass rate; create and duplicate.'),
  [`/exams/e1000000-0000-4000-8000-000000000001`]: P('صفحة الامتحان: الأسئلة (إضافة / ترتيب / نسخ، نشر · إغلاق · إعادة فتح) · النتائج (فلترة، تفاصيل كل إجابة، إلغاء محاولة، Excel) · الإعدادات.', 'Exam page: Questions (add / reorder / duplicate, publish · close · reopen) · Results (filters, every answer, cancel attempt, Excel) · Settings.'),
  '/birthdays': P('أعياد الميلاد: عرض الشهر يوماً بيوم مع النطاق؛ لكل طفل مكالمة / واتساب / هدية نقاط / كارت / سجل؛ تهنئة الجميع وهدية للجميع، وتصدير ICS/Excel.', 'Birthdays: month view day by day with scope; per child call / WhatsApp / gift points / card / log; greet-all and gift-all, ICS / Excel export.',
    [part(/kind:tile|عيد ميلاد|اليوم|هنئوا|هدايا/, 'عدادات الشهر: أعياد الميلاد · اليوم · هنّئوا · هدايا.', 'Month counters: birthdays · today · greeted · gifts.'),
     part(/تهنئة الجميع|هدية للجميع|طباعة الكروت|تصدير/, 'إجراءات جماعية: تهنئة الجميع · هدية للجميع · طباعة الكروت · تصدير.', 'Bulk actions: greet all · gift all · print cards · export.'),
     part(/الأربعاء|السبت|الاثنين|الأحد|الثلاثاء|الخميس|الجمعة/, 'يوم من الشهر مع أطفاله وأزرار الاتصال والواتساب والهدية والكارت.', 'A day of the month with its children and call / WhatsApp / gift / card buttons.')]),
  '/birthdays/cards': P('قوالب كروت التهنئة بنطاق وقالب افتراضي.', 'Birthday card templates, scoped with a default.'),
  [`/birthdays/cards/d7000000-0000-4000-8000-000000000001`]: P('تصميم كارت التهنئة بمتغيرات عيد الميلاد وطباعة أطفال الشهر.', 'Design a birthday card with birthday variables and print the month\'s children.'),
  '/birthdays/settings': P('إعدادات أعياد الميلاد: نقاط الهدية الافتراضية وقالب رسالة التهنئة لكل كنيسة أو عام.', 'Birthday settings: default gift points and greeting template per church or global.'),
  '/messages': P('الرسائل — صندوق الوارد: محادثات المخدومين والخدام بعداد غير المقروء، دلو الإعلانات، وفلاتر.', 'Messages inbox: child and staff conversations with unread counts, announcements bucket and filters.'),
  '/messages/new': P('رسالة جديدة: اختيار مخدومين / خدام محددين أو إعلان لنطاق (فصل / خدمة / كنيسة / الكل) مع معاينة الجمهور.', 'New message: pick specific children / servants or a scope announcement (class / service / church / all) with audience preview.'),
  [`/messages/e:b2000000-0000-4000-8000-000000000001`]: P('محادثة مخدوم: الطفل مع كل خدام النطاق والإعلانات التي وصلته.', 'Child conversation: the child with every servant in scope plus the announcements he received.'),
  [`/messages/s:a0000000-0000-4000-8000-000000000002`]: P('محادثة مباشرة بين خادمين.', 'Direct staff chat between two servants.'),
  '/messages/b': P('الإعلانات المرسلة إلى نطاقات.', 'Announcements sent to scopes.'),
  '/notifications': P('الإشعارات — المركز: إشعارات يدوية وآلية (Web Push) مع إحصاءات التوصيل.', 'Notifications hub: manual and automatic (Web Push) notifications with delivery stats.'),
  '/notifications/inbox': P('وارد الإشعارات الخاصة بي.', 'My notifications inbox.'),
  '/notifications/new': P('إشعار جديد: العنوان والنص والجمهور (نطاق أو أشخاص) والجدولة.', 'New notification: title, body, audience (scope or people) and schedule.'),
  '/notifications/automations': P('الإشعارات الآلية: قواعد مثل تذكير الغائبين، أعياد الميلاد، الفعاليات القادمة.', 'Automations: rules such as absentee reminders, birthdays, upcoming occasions.'),
  '/online': P('الفصول الأونلاين — المركز: مؤشرات، بحث، فلاتر النطاق والحالة، إنشاء وتعديل الفصول.', 'Online classes hub: KPIs, search, scope & status filters, create / edit classes.'),
  [`/online/f1000000-0000-4000-8000-000000000002`]: P('غرفة التحكم لفصل مباشر: بدء / إنهاء، معاينة البث، إرسال فحص انتباه، المشاركون (نسبة الحضور الحية)، أسئلة مباشرة، محادثة، إعدادات.', 'Control room of a live class: start / end, stream preview, attention checks, participants (live %), live questions, chat, settings.'),
  '/achievements': P('الإنجازات: قائمة (صورة، اسم، نوع، نقاط، نطاق، طريقة المنح، الحالة)، إضافة / تعديل، تفعيل، والحاصلون عليها.', 'Achievements: list (picture, name, type, points, scope, award mode, status), add / edit, activate, and earners.'),
  '/occasions': P('الفعاليات — اللوحة: غلاف، عنوان، نوع، تاريخ، مكان، منظم، مقاعد وعدادات؛ فلاتر المرحلة والنطاق.', 'Occasions board: cover, title, kind, date, place, organizer, seats and counters; phase & scope filters.'),
  [`/occasions/f5000000-0000-4000-8000-000000000001`]: P('تفاصيل الفعالية: إحصاءات، المشاركون (حالة، قائمة تحقق، تذكرة، CSV)، تسجيل الدخول بالـ QR، محرر قائمة التحقق، الإعلانات.', 'Occasion detail: stats, participants (status, checklist, ticket, CSV), QR check-in, checklist editor, announcements.'),
  '/results': P('نتائج الامتحانات — القائمة: امتحانات المواد بنطاق وسنة، مؤشرات، إضافة / نسخ / حذف.', 'Exam results list: subject exams by scope and year, KPIs, add / duplicate / delete.'),
  [`/results/fa000000-0000-4000-8000-000000000002`]: P('صفحة امتحان النتائج: لوحة (مؤشرات وتوزيع التقديرات)، المواد، النتائج وبطاقة الطالب، الترتيب، الإعدادات (قفل / نشر / نسخ).', 'Results exam page: dashboard (KPIs + grade distribution), subjects, results & student card, ranking, settings (lock / publish / copy).'),
  [`/results/bulk?exam=fa000000-0000-4000-8000-000000000002`]: P('إدخال جماعي: شبكة طلاب × مواد بتنقل بلوحة المفاتيح، لصق من Excel، تحقق حي، حفظ تلقائي محلي، وحفظ الكل مع إعادة المحاولة.', 'Bulk entry: students × subjects grid with keyboard navigation, paste from Excel, live validation, local autosave and save-all with retry.'),
  '/results/import': P('استيراد Excel: قالب، سحب وإفلات، معاينة، مطابقة بالكود / الاسم، كشف المجهول والمكرر، إصلاح داخلي ثم استيراد.', 'Excel import: template, drag & drop, preview, match by code / name, unknown / duplicate detection, inline fixes, import.'),
  '/results/reports': P('تقارير النتائج: نتائج الامتحان، الترتيب، أداء المواد والفصول، توزيع التقديرات، ناجح / راسب؛ تصدير وطباعة.', 'Results reports: exam results, ranking, subject / class performance, grade distribution, pass / fail; export & print.'),
  '/results/grading': P('أنظمة التقدير: نطاقات (اسم، من %، إلى %، لون، نجاح) مع كشف التداخل والفجوات ومختبر نسبة.', 'Grading systems: bands (name, min %, max %, color, pass) with overlap / gap validation and a percent tester.'),
  '/results/students': P('نتائج الطلاب: بحث بالنطاق، تاريخ امتحانات الطالب مع الاتجاه، وفتح بطاقة النتيجة.', 'Student results: scoped search, exam history with trend, open the result card.'),
  '/library': P('المكتبة: بطاقات المواد (غلاف، اسم، كتب، محاضرات)، بحث عام، المفضلة، إدارة المواد.', 'Library: subject cards (cover, name, books, lectures), global search, favorites, manage subjects.'),
  [`/library/fc000000-0000-4000-8000-000000000001`]: P('صفحة مادة: تبويبا الكتب والمحاضرات، بحث، فلتر النوع، مشغّل داخلي، إدارة العناصر.', 'Subject page: Books | Lectures tabs, search, kind filter, inline player, manage items.'),
  '/activity': P('سجل النشاط: خط زمني حي لكل عملية (تُكتب من قاعدة البيانات) مع ترقيم 10 / 100 / 1000 و«تعمّق أكثر».', 'Activity log: live timeline of every operation (written by the DB) with 10 / 100 / 1000 paging and "dig deeper".'),
  '/activity?tab=users': P('سجل النشاط بالمستخدم: من فعل ماذا.', 'Activity by user: who did what.'),
  '/activity?tab=ops': P('سجل النشاط بالعملية: تجميع بحسب نوع العملية.', 'Activity by operation: grouped by action kind.'),
  '/activity?tab=overview': P('نظرة عامة: أرقام وإحصاءات، وللمالك إعدادات الاحتفاظ والتنظيف.', 'Overview: counts & charts; owner retention / prune settings.'),
  '/reports': P('تقارير وجداول: معالج من 4 خطوات — البيانات (المصدر والفلاتر) → الحقول والمعاينة → التصميم → التصدير PDF / Excel / طباعة.', 'Reports & tables: 4-step wizard — data (source & filters) → fields & preview → design → export PDF / Excel / print.'),
  '/reports?tab=templates': P('القوالب المحفوظة لكل مصدر بيانات؛ فتح أو حذف.', 'Saved templates per data source; open or delete.'),
  [`/reports?template=fb000000-0000-4000-8000-000000000001`]: P('فتح قالب محفوظ داخل المعالج.', 'Open a saved template inside the wizard.'),
  '/access': P('التحكم في الدخول — البوابة: مسح / كود / بحث → مسموح أو مرفوض حسب قواعد المناسبة، مع حالة القواعد.', 'Access control — the gate: scan / code / search → allowed or denied according to the event\'s rules, with rule status.'),
  '/access?tab=admin': P('إدارة الدخول: البوابات، شجرة القواعد (مجموعات AND / OR)، قائمة المسموح (أشخاص · فصل · خدمة · كنيسة)، السجل والإعداد الكامل.', 'Access admin: gates, rule tree (AND / OR groups), allowed list (persons · class · service · church), log and full config.'),

  '/child': P('بوابة المخدوم — الرئيسية: الاسم والصورة، رصيد النقاط ومرات الحضور، تسجيلاته، الوحدات المتاحة له (أونلاين، فعاليات، مكتبة، إنجازات، رسائل، امتحانات) وآخر نشاط.', 'Child portal home: name & picture, points balance and attendance count, enrollments, the modules available to him (online, occasions, library, achievements, messages, exams) and latest activity.',
    [part('kind:header', 'هيدر البوابة: الكنيسة والخدمة والفصل، الإشعارات، الرسائل، القائمة.', 'Portal header: church · service · class, notifications, messages, menu.'),
     part('kind:nav', 'شريط البوابة: الرئيسية · الحضور · النقاط · البيانات · الخيارات.', 'Portal bar: home · attendance · points · data · options.'),
     part(/أهلاً/, 'بطاقة الترحيب: الاسم، النوع والعمر، الخدمة والفصل.', 'Welcome card: name, gender & age, service and class.'),
     part(/رصيد النقاط|مرات الحضور|kind:tile/, 'رصيد النقاط ومرات الحضور.', 'Points balance and attendance count.'),
     part(/تسجيلاتي/, 'تسجيلاتي: كل فصل مسجل فيه مع حضوره ونقاطه.', 'My enrollments: every class with its attendance & points.'),
     part(/آخر نشاط/, 'آخر حضور وآخر نقاط وبياناتي.', 'Latest attendance, latest points and my data.')]),
  '/child/attendance': P('الحضور: بحسب اليوم مع فلتر المناسبة، وقت التسجيل، والنقاط المرتبطة.', 'Attendance: by day with event filter, registration time and related points.'),
  '/child/points': P('النقاط: الرصيد، المضاف والمخصوم، بحسب السبب / الحضور.', 'Points: balance, added / deducted, by cause / attendance.'),
  '/child/data': P('بياناتي: البيانات وكود الـ QR والصورة؛ رفع صورة أو طلب تعديل بيانات، وسجل الطلبات مع الإلغاء.', 'My data: data, QR code and picture; upload a picture or request a data change; request history with cancel.'),
  '/child/exams': P('الامتحانات: المفتوحة (القواعد، المحاولات المتبقية، آخر نتيجة) والسابقة.', 'Exams: open ones (rules, attempts left, last result) and past ones.'),
  [`/child/exams/e1000000-0000-4000-8000-000000000001`]: P('مشغّل الامتحان: مقدمة → سؤال واحد كل مرة بعدّاد مثبّت من الخادم → النتيجة (الدرجة، النجاح، النقاط، المراجعة إن سُمح).', 'Exam player: intro → one question at a time with a server-anchored countdown → result (score, pass, points, review if allowed).'),
  '/child/messages': P('الرسائل: محادثة لكل تسجيل مع عداد غير المقروء.', 'Messages: one conversation per enrollment with unread counts.'),
  [`/child/messages/b2000000-0000-4000-8000-000000000001`]: P('المحادثة: الكتابة للخدام وقراءة الردود والإعلانات.', 'The conversation: write to the servants, read replies and announcements.'),
  '/child/notifications': P('إشعاراتي.', 'My notifications.'),
  '/child/online': P('الفصول الأونلاين: مباشر / قادم / سابق مع نتيجتي.', 'Online classes: live / upcoming / past with my result.'),
  [`/child/online/f1000000-0000-4000-8000-000000000002`]: P('الغرفة المباشرة: الانضمام، نبضة كل 30 ث، نافذة فحص الانتباه، أسئلة مباشرة، محادثة، رابط الامتحان، النتيجة النهائية.', 'Live room: join, 30 s heartbeat, attention-check popup, live questions, chat, exam link, final result.'),
  '/child/achievements': P('إنجازاتي: البطاقات المكتسبة وأشرطة التقدم لإنجازات الحضور.', 'My achievements: earned cards and progress bars for attendance achievements.'),
  '/child/occasions': P('الفعاليات مع حالة تسجيلي في كل منها.', 'Occasions with my registration status in each.'),
  [`/child/occasions/f5000000-0000-4000-8000-000000000001`]: P('تفاصيل الفعالية: «أنا مشارك»، إلغاء، تذكرة QR إلكترونية، قائمة التحقق الخاصة بي، الإشعارات.', 'Occasion detail: "I\'m in", cancel, e-ticket QR, my checklist, notifications.'),
  '/child/library': P('المكتبة: المواد والبحث ومفضلتي.', 'Library: subjects, search and my favorites.'),
  [`/child/library/fc000000-0000-4000-8000-000000000001`]: P('كتب ومحاضرات المادة مع المشغّل والمفضلة.', 'Subject books & lectures with player and favorites.'),
  '/child/options': P('الخيارات: الملف، تغيير كلمة المرور، تحديث، تثبيت التطبيق، تسجيل الخروج.', 'Options: profile, change password, refresh, install the app, log out.'),
};

/** fallback explanation by region kind when nothing specific matched */
export const byKind = {
  title: ['عنوان الصفحة.', 'Page title.'],
  tabs: ['تبويبات / مفتاح تبديل بين أوضاع الصفحة.', 'Tabs / switch between the page modes.'],
  form: ['نموذج إدخال: الحقول تُحفظ عند الإرسال.', 'Input form: the fields are saved on submit.'],
  field: ['حقل إدخال.', 'Input field.'],
  button: ['زر الإجراء الرئيسي.', 'Primary action button.'],
  actions: ['شريط أزرار الإجراءات.', 'Action buttons row.'],
  list: ['قائمة / شبكة عناصر — الضغط على عنصر يفتح تفاصيله.', 'List / grid of items — tap an item to open it.'],
  tile: ['مؤشر رقمي.', 'A numeric indicator.'],
  block: ['بطاقة محتوى.', 'A content card.'],
};
