#!/usr/bin/env node
/**
 * demo/capture.mjs — walk EVERY page of the app and take a screenshot.
 *
 *   node demo/capture.mjs [--out demo/shots] [--base http://localhost:3000] [--only <substring>]
 *
 * Personas (seed_test_data.sql):
 *   owner  10000000000001 / Test@1234   → all servant pages, owner module
 *   child  30101010100001 / 123456      → the child portal
 *   public                              → login / signup pages
 *
 * Writes <out>/<NN>-<slug>.png + <out>/manifest.json (title, url, section,
 * notes) which demo/build-gallery.mjs turns into a page-by-page HTML tour.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : [])).filter((x) => x.length)
);
const BASE = args.base || process.env.BASE || 'http://localhost:3000';
const OUT = path.resolve(args.out || 'demo/shots');
const ONLY = typeof args.only === 'string' ? args.only : null;
// --limit N: capture at most N new pages per run (the manifest makes runs
// resumable — lets a small sandbox restart the dev server between batches)
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const CHROME = process.env.CHROME || '/usr/bin/chromium';

// dynamic ids from the seed (fixed UUIDs)
const ID = {
  exam: 'e1000000-0000-4000-8000-000000000001',
  resultExam: 'fa000000-0000-4000-8000-000000000002',
  occasion: 'f5000000-0000-4000-8000-000000000001',
  onlineLive: 'f1000000-0000-4000-8000-000000000002',
  library: 'fc000000-0000-4000-8000-000000000001',
  card: 'd4000000-0000-4000-8000-000000000001',
  bdayCard: 'd7000000-0000-4000-8000-000000000001',
  childEnrollment: 'b2000000-0000-4000-8000-000000000001',
  staff: 'a0000000-0000-4000-8000-000000000002',
  event: 'c1000000-0000-4000-8000-000000000001',
  reportTemplate: 'fb000000-0000-4000-8000-000000000001',
};

/** @type {{section:string, title:string, path:string, persona:'public'|'owner'|'child', note?:string, settle?:number}[]} */
const PAGES = [
  // ---------- public ----------
  { section: 'الدخول والتسجيل', title: 'تسجيل الدخول — دخول الخادم', path: '/login', persona: 'public', note: 'الكود + كلمة المرور + تذكرني · مسح الكود بالكاميرا' },
  { section: 'الدخول والتسجيل', title: 'تسجيل الدخول — دخول المخدوم', path: '/login?as=child', persona: 'public' },
  { section: 'الدخول والتسجيل', title: 'إنشاء حساب خادم (4 خطوات)', path: '/signup', persona: 'public', note: 'مكان الخدمة → الكود → البيانات → كلمة المرور' },
  { section: 'الدخول والتسجيل', title: 'إنشاء حساب مخدوم', path: '/child/signup', persona: 'public' },

  // ---------- core ----------
  { section: 'الصفحات الأساسية', title: 'الرئيسية — ودجات قابلة للتخصيص', path: '/', persona: 'owner', settle: 2500 },
  { section: 'الصفحات الأساسية', title: 'المخدومين — القائمة حسب الفصل', path: '/children', persona: 'owner', settle: 2500 },
  { section: 'الصفحات الأساسية', title: 'الماسح — حضور / نقاط / بيانات بالـ QR', path: '/scanner', persona: 'owner' },
  { section: 'الصفحات الأساسية', title: 'الإحصائيات', path: '/stats', persona: 'owner', settle: 3000 },
  { section: 'الصفحات الأساسية', title: 'الإعدادات — المركز', path: '/settings', persona: 'owner' },

  // ---------- people management ----------
  { section: 'إدارة المخدومين', title: 'إدارة المخدومين — المخدومين (تعديل · إيقاف · حذف)', path: '/children/manage', persona: 'owner', settle: 2500 },
  { section: 'إدارة المخدومين', title: 'إدارة المخدومين — إضافة (فردي / جماعي)', path: '/children/manage?tab=add', persona: 'owner' },
  { section: 'إدارة المخدومين', title: 'إدارة المخدومين — طلبات الانضمام', path: '/children/manage?tab=requests', persona: 'owner' },
  { section: 'إدارة المخدومين', title: 'إدارة المخدومين — دعوة (QR)', path: '/children/manage?tab=invite', persona: 'owner' },
  { section: 'إدارة الخدام', title: 'إدارة الخدام — الخدام والصلاحيات', path: '/servants', persona: 'owner', settle: 2500 },
  { section: 'إدارة الخدام', title: 'إدارة الخدام — إضافة خدام', path: '/servants?tab=add', persona: 'owner' },
  { section: 'إدارة الخدام', title: 'إدارة الخدام — طلبات الانضمام', path: '/servants?tab=approvals', persona: 'owner' },
  { section: 'إدارة الخدام', title: 'إدارة الخدام — دعوة (QR)', path: '/servants?tab=invite', persona: 'owner' },
  { section: 'إدارة الخدام', title: 'العائلات — القائمة', path: '/family', persona: 'owner' },
  { section: 'إدارة الخدام', title: 'العائلات — إضافة أفراد بالـ QR', path: '/family?tab=qr', persona: 'owner' },

  // ---------- settings ----------
  { section: 'الإعدادات', title: 'إدارة الكنائس', path: '/settings/churches', persona: 'owner' },
  { section: 'الإعدادات', title: 'إدارة الخدمات', path: '/settings/services', persona: 'owner' },
  { section: 'الإعدادات', title: 'إدارة الفصول', path: '/settings/classes', persona: 'owner' },
  { section: 'الإعدادات', title: 'إدارة المناسبات', path: '/settings/events', persona: 'owner' },
  { section: 'الإعدادات', title: 'إدارة أسباب النقاط', path: '/settings/causes', persona: 'owner' },
  { section: 'الإعدادات', title: 'إدارة نتائج الافتقاد', path: '/settings/call-feedbacks', persona: 'owner' },
  { section: 'الإعدادات', title: 'طلبات تعديل البيانات', path: '/settings/data-requests', persona: 'owner' },
  { section: 'الإعدادات', title: 'قوالب الكروت', path: '/settings/cards', persona: 'owner' },
  { section: 'الإعدادات', title: 'مصمم الكروت — تصميم / طباعة / طباعة جماعية', path: `/settings/cards/${ID.card}`, persona: 'owner', settle: 3000 },
  { section: 'الإعدادات', title: 'النسخ الاحتياطي والاسترجاع', path: '/settings/backup', persona: 'owner' },

  // ---------- owner module ----------
  { section: 'وحدة المالك', title: 'وحدة المالك — المركز', path: '/owner', persona: 'owner' },
  { section: 'وحدة المالك', title: 'صلاحيات الوحدات', path: '/owner/modules', persona: 'owner' },
  { section: 'وحدة المالك', title: 'ملفات الصلاحيات', path: '/owner/permissions', persona: 'owner' },
  { section: 'وحدة المالك', title: 'إدارة الأفراد', path: '/owner/persons', persona: 'owner', settle: 2500 },
  { section: 'وحدة المالك', title: 'تخصيص التطبيق — المركز', path: '/owner/customize', persona: 'owner' },
  { section: 'وحدة المالك', title: 'تخصيص — شريط المهام', path: '/owner/customize/taskbar', persona: 'owner' },
  { section: 'وحدة المالك', title: 'تخصيص — أيقونات الهيدر', path: '/owner/customize/header', persona: 'owner' },
  { section: 'وحدة المالك', title: 'تخصيص — ودجات الرئيسية', path: '/owner/customize/widgets', persona: 'owner' },
  { section: 'وحدة المالك', title: 'تخصيص — أسماء الصفحات والوحدات', path: '/owner/customize/names', persona: 'owner' },
  { section: 'وحدة المالك', title: 'تخصيص — نظام الأكواد', path: '/owner/customize/codes', persona: 'owner' },

  // ---------- modules ----------
  { section: 'الوحدات', title: 'الأشابين — مجموعتي', path: '/shepherds', persona: 'owner' },
  { section: 'الوحدات', title: 'إستبدال النقاط — المركز', path: '/store', persona: 'owner' },
  { section: 'الوحدات', title: 'إستبدال النقاط — المخزون', path: '/store/inventory', persona: 'owner' },
  { section: 'الوحدات', title: 'إستبدال النقاط — الكاشير', path: '/store/pos', persona: 'owner' },
  { section: 'الوحدات', title: 'إستبدال النقاط — أرشيف الفواتير', path: '/store/archive', persona: 'owner' },
  { section: 'الوحدات', title: 'الامتحانات — المركز', path: '/exams', persona: 'owner' },
  { section: 'الوحدات', title: 'الامتحانات — صفحة امتحان (أسئلة · نتائج · إعدادات)', path: `/exams/${ID.exam}`, persona: 'owner' },
  { section: 'الوحدات', title: 'أعياد الميلاد — الشهر يوم بيوم', path: '/birthdays', persona: 'owner', settle: 2500 },
  { section: 'الوحدات', title: 'أعياد الميلاد — قوالب الكروت', path: '/birthdays/cards', persona: 'owner' },
  { section: 'الوحدات', title: 'أعياد الميلاد — تصميم كارت', path: `/birthdays/cards/${ID.bdayCard}`, persona: 'owner', settle: 3000 },
  { section: 'الوحدات', title: 'أعياد الميلاد — الإعدادات', path: '/birthdays/settings', persona: 'owner' },
  { section: 'الوحدات', title: 'الرسائل — صندوق الوارد', path: '/messages', persona: 'owner' },
  { section: 'الوحدات', title: 'الرسائل — رسالة جديدة / إعلان', path: '/messages/new', persona: 'owner' },
  { section: 'الوحدات', title: 'الرسائل — محادثة مخدوم', path: `/messages/e:${ID.childEnrollment}`, persona: 'owner' },
  { section: 'الوحدات', title: 'الرسائل — محادثة خادم', path: `/messages/s:${ID.staff}`, persona: 'owner' },
  { section: 'الوحدات', title: 'الرسائل — الإعلانات', path: '/messages/b', persona: 'owner' },
  { section: 'الوحدات', title: 'الإشعارات — المركز', path: '/notifications', persona: 'owner' },
  { section: 'الوحدات', title: 'الإشعارات — الوارد', path: '/notifications/inbox', persona: 'owner' },
  { section: 'الوحدات', title: 'الإشعارات — إشعار جديد', path: '/notifications/new', persona: 'owner' },
  { section: 'الوحدات', title: 'الإشعارات — الإشعارات الآلية', path: '/notifications/automations', persona: 'owner' },
  { section: 'الوحدات', title: 'الفصول الأونلاين — المركز', path: '/online', persona: 'owner' },
  { section: 'الوحدات', title: 'الفصول الأونلاين — غرفة التحكم (فصل مباشر)', path: `/online/${ID.onlineLive}`, persona: 'owner' },
  { section: 'الوحدات', title: 'الإنجازات', path: '/achievements', persona: 'owner' },
  { section: 'الوحدات', title: 'الفعاليات — اللوحة', path: '/occasions', persona: 'owner' },
  { section: 'الوحدات', title: 'الفعاليات — تفاصيل فعالية', path: `/occasions/${ID.occasion}`, persona: 'owner' },
  { section: 'الوحدات', title: 'نتائج الامتحانات — القائمة', path: '/results', persona: 'owner' },
  { section: 'الوحدات', title: 'نتائج الامتحانات — صفحة امتحان', path: `/results/${ID.resultExam}`, persona: 'owner', settle: 2500 },
  { section: 'الوحدات', title: 'نتائج الامتحانات — إدخال جماعي', path: `/results/bulk?exam=${ID.resultExam}`, persona: 'owner' },
  { section: 'الوحدات', title: 'نتائج الامتحانات — استيراد Excel', path: '/results/import', persona: 'owner' },
  { section: 'الوحدات', title: 'نتائج الامتحانات — التقارير', path: '/results/reports', persona: 'owner', settle: 2500 },
  { section: 'الوحدات', title: 'نتائج الامتحانات — أنظمة التقدير', path: '/results/grading', persona: 'owner' },
  { section: 'الوحدات', title: 'نتائج الامتحانات — نتائج الطلاب', path: '/results/students', persona: 'owner' },
  { section: 'الوحدات', title: 'المكتبة — المواد', path: '/library', persona: 'owner' },
  { section: 'الوحدات', title: 'المكتبة — كتب ومحاضرات مادة', path: `/library/${ID.library}`, persona: 'owner' },
  { section: 'الوحدات', title: 'سجل النشاط — السجل', path: '/activity', persona: 'owner', settle: 2500 },
  { section: 'الوحدات', title: 'سجل النشاط — بالمستخدم', path: '/activity?tab=users', persona: 'owner' },
  { section: 'الوحدات', title: 'سجل النشاط — بالعملية', path: '/activity?tab=ops', persona: 'owner' },
  { section: 'الوحدات', title: 'سجل النشاط — نظرة عامة', path: '/activity?tab=overview', persona: 'owner' },
  { section: 'الوحدات', title: 'تقارير وجداول — معالج التقرير', path: '/reports', persona: 'owner' },
  { section: 'الوحدات', title: 'تقارير وجداول — القوالب المحفوظة', path: '/reports?tab=templates', persona: 'owner' },
  { section: 'الوحدات', title: 'تقارير وجداول — فتح قالب', path: `/reports?template=${ID.reportTemplate}`, persona: 'owner', settle: 3000 },
  { section: 'الوحدات', title: 'التحكم في الدخول — البوابة', path: '/access', persona: 'owner' },
  { section: 'الوحدات', title: 'التحكم في الدخول — الإدارة (القواعد · المسموح · السجل)', path: '/access?tab=admin', persona: 'owner' },

  // ---------- child portal ----------
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الرئيسية', path: '/child', persona: 'child', settle: 2500 },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الحضور', path: '/child/attendance', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — النقاط', path: '/child/points', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — بياناتي و QR', path: '/child/data', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الامتحانات', path: '/child/exams', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — مشغّل الامتحان', path: `/child/exams/${ID.exam}`, persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الرسائل', path: '/child/messages', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — محادثة مع الخدام', path: `/child/messages/${ID.childEnrollment}`, persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الإشعارات', path: '/child/notifications', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الفصول الأونلاين', path: '/child/online', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الغرفة المباشرة', path: `/child/online/${ID.onlineLive}`, persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الإنجازات', path: '/child/achievements', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الفعاليات', path: '/child/occasions', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — تفاصيل فعالية وتذكرتي', path: `/child/occasions/${ID.occasion}`, persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — المكتبة', path: '/child/library', persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — كتب ومحاضرات مادة', path: `/child/library/${ID.library}`, persona: 'child' },
  { section: 'بوابة المخدوم', title: 'بوابة المخدوم — الخيارات', path: '/child/options', persona: 'child' },
];

const slug = (p) => p.replace(/^\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, extra = 1200) {
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch { /* keep going */ }
  // wait for loaders to disappear (spinners / skeletons)
  try {
    await page.waitForFunction(
      () => !document.querySelector('.animate-spin, [data-loading="true"], .animate-pulse'),
      null,
      { timeout: 8000 }
    );
  } catch { /* some pages keep a spinner (camera) — fine */ }
  await sleep(extra);
}

async function loginServant(page, code, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(page, 500);
  await page.fill('input[placeholder="الكود / الرقم القومي"]', code);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
  await settle(page, 1500);
}

async function loginChild(page, code, password) {
  await page.goto(`${BASE}/login?as=child`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(page, 500);
  await page.fill('input[placeholder="الكود / الرقم القومي"]', code);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => u.pathname.startsWith('/child'), { timeout: 60000 });
  await settle(page, 1500);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const manifestPath = path.join(OUT, 'manifest.json');
  let manifest = [];
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
  const done = new Set(manifest.map((m) => m.path));

  let budget = LIMIT;
  const personas = ['public', 'owner', 'child'];
  for (const persona of personas) {
    if (budget <= 0) break;
    const list = PAGES.map((p, i) => ({ ...p, index: i }))
      .filter((p) => p.persona === persona && (!ONLY || p.path.includes(ONLY)) && !done.has(p.path))
      .slice(0, budget);
    if (!list.length) continue;
    budget -= list.length;
    const context = await browser.newContext({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 1,
      locale: 'ar-EG',
      timezoneId: 'Africa/Cairo',
      permissions: ['camera'],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));

    if (persona === 'owner') await loginServant(page, '10000000000001', 'Test@1234');
    if (persona === 'child') await loginChild(page, '30101010100001', '123456');

    for (const p of list) {
      errors.length = 0;
      const file = `${String(p.index + 1).padStart(2, '0')}-${slug(p.path)}.png`;
      const t0 = Date.now();
      try {
        await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(page, p.settle ?? 1200);
        // dismiss the PWA install / notification prompts if any
        for (const sel of ['button:has-text("لاحقاً")', 'button:has-text("إغلاق")']) {
          const b = page.locator(sel).first();
          if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
        }
        await page.screenshot({ path: path.join(OUT, file), fullPage: true });
        const finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
        const h1 = (await page.locator('h1').first().textContent().catch(() => '')) || '';
        manifest.push({ ...p, file, finalUrl, h1: h1.trim(), errors: [...errors], ms: Date.now() - t0 });
        console.log(`✓ ${file}  ${p.title}  (${Date.now() - t0} ms)${finalUrl !== p.path ? `  → ${finalUrl}` : ''}`);
      } catch (e) {
        console.log(`✗ ${file}  ${p.title}: ${String(e.message).split('\n')[0]}`);
        try { await page.screenshot({ path: path.join(OUT, file), fullPage: false }); } catch { /* ignore */ }
        manifest.push({ ...p, file, finalUrl: page.url(), error: String(e.message).split('\n')[0], errors: [...errors], ms: Date.now() - t0 });
      }
      manifest.sort((a, b) => a.index - b.index);
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    await context.close();
  }
  await browser.close();
  const remaining = PAGES.filter((p) => !manifest.some((m) => m.path === p.path)).length;
  console.log(`\n${manifest.length} pages captured → ${OUT}${remaining ? ` (${remaining} remaining)` : ' (all done)'}`);
  process.exit(remaining ? 3 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
