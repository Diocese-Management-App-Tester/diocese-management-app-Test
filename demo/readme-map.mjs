// demo/readme-map.mjs — pulls the thorough documentation of every page straight
// out of the repository README.md so the tour shows the *real* project docs
// next to each screen (entry-point row + the module sections that describe it).
//
//   import { readmeFor } from './readme-map.mjs';
//   readmeFor('/store/pos') → { entry: '…row of the Functional Entry Points table…',
//                               sections: [{ title, md }, …] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

/* ---------- split the README into heading sections ---------- */
const lines = README.split('\n');
const sections = [];
for (let i = 0; i < lines.length; i++) {
  const m = /^(##+)\s+(.*)$/.exec(lines[i]);
  if (!m) continue;
  sections.push({ level: m[1].length, title: m[2].trim(), start: i });
}
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  let end = lines.length;
  for (let j = i + 1; j < sections.length; j++) { if (sections[j].level <= s.level) { end = sections[j].start; break; } }
  s.end = end;
  s.md = lines.slice(s.start + 1, end).join('\n').trim();
}
const findSection = (re) => sections.find((s) => re.test(s.title));

/* ---------- the "Functional Entry Points" table ---------- */
const entryRows = [];
{
  const sec = findSection(/^Functional Entry Points/);
  if (sec) {
    for (const l of lines.slice(sec.start, sec.end)) {
      const m = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(l);
      if (!m || /^-+$/.test(m[1]) || m[1] === 'Path') continue;
      const paths = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
      if (paths.length) entryRows.push({ paths, desc: m[2] });
    }
  }
}
function entryFor(pagePath) {
  const clean = pagePath.split('?')[0];
  const query = pagePath.includes('?') ? pagePath.slice(pagePath.indexOf('?') + 1) : '';
  const score = (row) => {
    let best = 0;
    for (const p of row.paths) {
      const pat = p.replace(/\\\|/g, '|');
      const base = pat.split('?')[0].replace(/\[[^\]]+\]/g, '*');
      const re = new RegExp('^' + base.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
      if (re.test(clean)) {
        let sc = 10 + base.length;
        if (query && pat.includes('?')) sc += 5;
        if (query && new RegExp(query.split('=')[1] || '__').test(pat)) sc += 3;
        best = Math.max(best, sc);
      }
    }
    return best;
  };
  let bestRow = null, bestScore = 0;
  for (const row of entryRows) { const s = score(row); if (s > bestScore) { bestScore = s; bestRow = row; } }
  return bestRow ? bestRow.desc : '';
}

/* ---------- the "Currently Completed Features" bullets ---------- */
const featureBullets = [];
{
  const sec = findSection(/^Currently Completed Features/);
  if (sec) {
    let cur = null;
    for (const l of lines.slice(sec.start + 1, sec.end)) {
      if (/^- ✅/.test(l)) { cur = l.replace(/^- ✅\s*/, ''); featureBullets.push(cur); }
      else if (/^\s{2,}- /.test(l) && cur !== null) featureBullets[featureBullets.length - 1] += '\n' + l.trim();
    }
  }
}
const FEATURES = [
  [/^\/login|^\/signup/, /Login \/ Signup|حسابات المخدومين|unified login/],
  [/^\/child\/signup/, /Child Portal \(0021\)|Login \/ Signup/],
  [/^\/$/, /ودجات الرئيسية|الرئيسية: role-aware|App shell/],
  [/^\/children$/, /^المخدومين:|المناسبة = المستوى الرابع|نتيجة الافتقاد|الافتراضي لكل مستوى|وحدة الأشابين/],
  [/^\/children\/manage/, /إدارة المخدومين → المخدومين|نظام الأكواد/],
  [/^\/scanner/, /^الماسح:|العائلات \(2026|المناسبة = المستوى الرابع|الافتراضي لكل مستوى/],
  [/^\/stats/, /الإحصائيات \(rebuilt/],
  [/^\/settings$/, /^الإعدادات:|وحدة المالك \+ صلاحيات الوحدات|طلبات تعديل البيانات/],
  [/^\/servants/, /إدارة الخدام:|إضافة خدام فردي|دعوة خادم جديد|شخص واحد في أماكن متعددة/],
  [/^\/family/, /العائلات \(2026/],
  [/^\/settings\/(churches|services|classes)/, /^الإعدادات:|Null scope|Person-centric core/],
  [/^\/settings\/events|^\/settings\/causes/, /المناسبة = المستوى الرابع|الافتراضي لكل مستوى|صلاحيات عناصر النشاط/],
  [/^\/settings\/call-feedbacks/, /نتيجة الافتقاد|صلاحيات عناصر النشاط/],
  [/^\/settings\/data-requests/, /طلبات تعديل البيانات|صلاحيات عناصر النشاط/],
  [/^\/settings\/cards/, /وحدة المالك \+ صلاحيات الوحدات/],
  [/^\/settings\/backup/, /النسخ الاحتياطي والاسترجاع/],
  [/^\/owner$/, /وحدة المالك \+ صلاحيات الوحدات|تخصيص التطبيق/],
  [/^\/owner\/modules/, /وحدة المالك \+ صلاحيات الوحدات|صلاحيات عناصر النشاط/],
  [/^\/owner\/permissions/, /صلاحيات عناصر النشاط|إضافة خدام فردي/],
  [/^\/owner\/persons/, /شخص واحد في أماكن متعددة|Person-centric core/],
  [/^\/owner\/customize$/, /تخصيص التطبيق|ودجات الرئيسية|نظام الأكواد/],
  [/^\/owner\/customize\/(taskbar|header)/, /تخصيص التطبيق/],
  [/^\/owner\/customize\/(widgets|names)/, /ودجات الرئيسية/],
  [/^\/owner\/customize\/codes/, /نظام الأكواد/],
  [/^\/shepherds/, /وحدة الأشابين/],
  [/^\/store/, /وحدة إستبدال النقاط/],
  [/^\/exams|^\/child\/exams/, /وحدة الامتحانات/],
  [/^\/birthdays/, /وحدة أعياد الميلاد/],
  [/^\/messages|^\/child\/messages/, /وحدة الرسائل/],
  [/^\/notifications|^\/child\/notifications/, /الإشعارات/],
  [/^\/online|^\/child\/online/, /وحدة الفصول الأونلاين/],
  [/^\/achievements|^\/child\/achievements/, /وحدة الإنجازات/],
  [/^\/occasions|^\/child\/occasions/, /وحدة الفعاليات/],
  [/^\/results/, /وحدة نتائج الامتحانات/],
  [/^\/library|^\/child\/library/, /وحدة المكتبة/],
  [/^\/activity/, /وحدة سجل النشاط/],
  [/^\/reports/, /تقارير وجداول/],
  [/^\/access/, /التحكم في الدخول/],
  [/^\/child($|\/(attendance|points|data|options))/, /Child Portal \(0021\)|حسابات المخدومين|وحدة إستبدال النقاط/],
];
function featuresFor(pagePath) {
  const hit = FEATURES.find(([re]) => re.test(pagePath));
  if (!hit) return [];
  return featureBullets.filter((b) => hit[1].test(b));
}

/* extra entry-point descriptions for pages the table describes indirectly */
const ENTRY_EXTRA = [
  [/^\/children\/manage(\?tab=add)?$/, '**إدارة المخدومين** (0042): add single/bulk (+ portal password) · join requests · invite QR; `/children/add` redirects'],
  [/^\/children\/manage\?tab=requests/, '**إدارة المخدومين → طلبات الانضمام**: children who signed up from the portal wait here; approve (creates the enrollment) or reject'],
  [/^\/children\/manage\?tab=invite/, '**إدارة المخدومين → دعوة**: scoped invite link + QR (church → service → class locked) for children to sign up from their phone'],
  [/^\/servants$/, 'إدارة الخدام — edit / suspend / delete scoped per level, servant photos, كنيسة → خدمة → فصل filters · الكل / يعمل / موقوف · grouped tree with إيقاف الكل per node'],
  [/^\/servants\?tab=add/, 'إدارة الخدام → **إضافة** (0041): single form (scope · code typed/scanned/generated · data · password · permission profiles) or bulk Excel / paste import with column mapping and a credentials Excel export'],
  [/^\/servants\?tab=approvals/, 'إدارة الخدام → **الطلبات**: approve / reject servant signup requests (scope defaults from the request)'],
  [/^\/servants\?tab=invite/, 'إدارة الخدام → **دعوة**: invite link + QR scoped to the manager level (`/settings/invite`)'],
  [/^\/settings\/events/, 'إدارة المناسبات — the 4th scope level (0022): events bound to church → service → class, recurrence + day/time window, points, **افتراضي** per scope (0048)'],
  [/^\/settings\/causes/, 'أسباب النقاط — points causes bound to a scope with a default value and a per-scope **افتراضي** (0048); used by the scanner and the children page'],
  [/^\/settings\/cards$/, 'تصميم الكروت — card templates (scoped, default per scope); open one to design front / back and print'],
  [/^\/settings\/cards\//, 'Card designer — تصميم (canvas, elements, variables) · ظهر الكارت · **طباعة جماعية** tab; print profiles (0049)'],
  [/^\/settings\/backup/, 'النسخ الاحتياطي والاسترجاع (0044) — owner-only: pick what to back up → one JSON download; restore (دمج / استبدال); scheduled backups to the private `backups` bucket with history'],
  [/^\/owner\/permissions/, 'ملفات الصلاحيات — the owner builds permission profiles from the registry (fine-grained keys: view · add · edit · delete · approve …) and assigns them to servants'],
  [/^\/owner\/persons/, 'إدارة الأفراد — owner persons management: every person of the tenant, his places (servant scopes / child enrollments), merge & fix, codes'],
  [/^\/birthdays\/cards\//, 'Birthday card design — same engine as the card designer + birthday variables ([الاسم الأول] · [السن] …) and a print tab fed by the month\'s birthdays'],
  [/^\/notifications$/, 'وحدة الإشعارات (0034) — hub: sent notifications, automations, inbox; compose to persons / scopes with schedule'],
  [/^\/notifications\/inbox/, 'الإشعارات → الواردة — the servant inbox: unread / all, mark read, open the target'],
  [/^\/notifications\/new/, 'الإشعارات → إرسال — compose: title · body · audience (children / servants · scope) · schedule · push'],
  [/^\/notifications\/automations/, 'الإشعارات → تلقائي — automations: event-driven rules (birthday, absence, approval …) with templates, enable / disable'],
  [/^\/child\/notifications/, 'بوابة المخدوم → الإشعارات — the child\'s inbox with unread count'],
];

/* ---------- which README sections describe which pages ---------- */
const MAP = [
  [/^\/login$|^\/signup$/, [/^Child accounts, unified login/, /^Roles \(multi-tenant/, /^Servants architecture/]],
  [/^\/login\?as=child|^\/child\/signup/, [/^Child accounts, unified login/, /^Child Portal Architecture/]],
  [/^\/$/, [/^Modules & the Owner module/, /^Scope hierarchy/, /^Architecture — PERSON-CENTRIC/]],
  [/^\/children$/, [/^Status, attendance & points badges/, /^Event-bound operations/, /^Call feedback/, /^Scope hierarchy/, /^Stop \(إيقاف\)/, /^One person → many places/]],
  [/^\/children\/manage/, [/^Child accounts, unified login/, /^Stop \(إيقاف\)/, /^Add servants directly/]],
  [/^\/scanner/, [/^Event-bound operations/, /^Status, attendance & points badges/, /^Performance & Scale Architecture/]],
  [/^\/stats/, [/^Statistics Architecture/, /^Expected capacity/]],
  [/^\/settings$/, [/^Modules & the Owner module/, /^Roles \(multi-tenant/]],
  [/^\/servants/, [/^Servants architecture/, /^Add servants directly/, /^Roles \(multi-tenant/]],
  [/^\/family/, [/^Family module/, /^Data$/, /^Flow$/, /^Permissions & RLS/]],
  [/^\/settings\/(churches|services|classes)/, [/^Scope hierarchy/, /^Architecture — PERSON-CENTRIC/]],
  [/^\/settings\/events|^\/settings\/causes/, [/^Event-bound operations/, /^Scope hierarchy/]],
  [/^\/settings\/call-feedbacks/, [/^Call feedback/]],
  [/^\/settings\/data-requests/, [/^Child Portal Architecture/, /^Child accounts, unified login/]],
  [/^\/settings\/cards$/, [/^Card Designer Module/, /^Card back/]],
  [/^\/settings\/cards\//, [/^Card Designer Module/, /^Card back/, /^Bulk Print tab/]],
  [/^\/settings\/backup/, [/^Backup & Restore/]],
  [/^\/owner$/, [/^Modules & the Owner module/]],
  [/^\/owner\/modules/, [/^Modules & the Owner module/, /^Modules for specific people/]],
  [/^\/owner\/permissions/, [/^Activity item permissions & modules/, /^Fine-grained keys/, /^Modules for specific people/]],
  [/^\/owner\/persons/, [/^إدارة الأفراد/, /^One person → many places/]],
  [/^\/owner\/customize/, [/^Modules & the Owner module/]],
  [/^\/shepherds/, [/^Shepherds module/]],
  [/^\/store/, [/^Points store module/]],
  [/^\/exams/, [/^Exams module/]],
  [/^\/birthdays/, [/^Birthdays module/]],
  [/^\/messages/, [/^Messages module/]],
  [/^\/notifications/, [/^Notifications module/]],
  [/^\/online/, [/^Online classes module/]],
  [/^\/achievements/, [/^Achievements module/]],
  [/^\/occasions/, [/^Occasions module/]],
  [/^\/results/, [/^Exam Results module/]],
  [/^\/library/, []],
  [/^\/activity/, [/^Activity Log module/, /^Why the database writes the log/, /^App-level events/, /^Reading — keyset pagination/, /^Who sees what/]],
  [/^\/reports/, [/^Reports & Tables module/, /^Flow$/, /^Architecture \(`src\/lib\/reports/]],
  [/^\/access/, [/^Access module/]],
  [/^\/child$/, [/^Child Portal Architecture/, /^Child accounts, unified login/]],
  [/^\/child\/(attendance|points)/, [/^Child Portal Architecture/, /^Status, attendance & points badges/, /^Points store module/]],
  [/^\/child\/data/, [/^Child Portal Architecture/, /^Child accounts, unified login/]],
  [/^\/child\/options/, [/^Child Portal Architecture/, /^Child accounts, unified login/]],
  [/^\/child\/exams/, [/^Exams module/]],
  [/^\/child\/messages/, [/^Messages module/]],
  [/^\/child\/notifications/, [/^Notifications module/]],
  [/^\/child\/online/, [/^Online classes module/]],
  [/^\/child\/achievements/, [/^Achievements module/]],
  [/^\/child\/occasions/, [/^Occasions module/]],
  [/^\/child\/library/, []],
];

// `### Flow` / `### Data` exist under several modules — resolve them relative to the parent
function subSection(parentRe, childRe) {
  const parent = findSection(parentRe);
  if (!parent) return null;
  return sections.find((s) => s.start > parent.start && s.start < parent.end && childRe.test(s.title)) || null;
}

const MAX_CHARS = 5200;
export function readmeFor(pagePath) {
  let entry = entryFor(pagePath);
  const extra = ENTRY_EXTRA.find(([re]) => re.test(pagePath));
  if (extra && (!entry || extra[0].source.includes('?'))) entry = extra[1];
  const features = featuresFor(pagePath);
  const hit = MAP.find(([re]) => re.test(pagePath));
  const out = [];
  if (hit) {
    const [, res] = hit;
    const parentRe = res[0];
    for (const re of res) {
      const s = /^\^(Flow|Data|Permissions|Architecture)/.test(re.source) ? subSection(parentRe, re) : findSection(re);
      if (!s || out.some((o) => o.title === s.title)) continue;
      // keep the sub-headings of a module inside its section text (level-3 children are already included)
      let md = s.md;
      if (md.length > MAX_CHARS) md = md.slice(0, MAX_CHARS).replace(/\n[^\n]*$/, '') + '\n\n… *(see README.md for the rest of this section)*';
      out.push({ title: s.title, md, line: s.start + 1 });
    }
  }
  return { entry, features, sections: out };
}

/* ---------- tiny Markdown → HTML (enough for the README subset) ---------- */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function mdToHtml(md) {
  const out = [];
  const ls = md.split('\n');
  let i = 0;
  while (i < ls.length) {
    const l = ls[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < ls.length && !/^```/.test(ls[i])) buf.push(ls[i++]); i++; out.push(`<pre>${esc(buf.join('\n'))}</pre>`); continue; }
    const isRow = (x) => /^\|.*\|\s*$/.test(x);
    if (isRow(l) && isRow(ls[i + 1] || '')) {
      const rows = []; while (i < ls.length && isRow(ls[i])) rows.push(ls[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
      const body = rows.filter((r) => !/^\|\s*-+/.test(r));
      const [head, ...rest] = body;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${Math.min(6, h[1].length + 1)}>${inline(h[2])}</h${Math.min(6, h[1].length + 1)}>`); i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const items = []; let cur = null;
      while (i < ls.length && (/^\s*([-*]|\d+\.)\s+/.test(ls[i]) || (/^\s{2,}\S/.test(ls[i]) && cur !== null))) {
        const m = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(ls[i]);
        if (m) { cur = m[2]; items.push(cur); } else items[items.length - 1] += ' ' + ls[i].trim();
        i++;
      }
      const ordered = /^\s*\d+\./.test(l);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [l]; i++;
    while (i < ls.length && ls[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s)/.test(ls[i]) && !isRow(ls[i])) buf.push(ls[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

export const readmeSectionTitles = sections.map((s) => s.title);
