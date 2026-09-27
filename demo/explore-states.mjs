#!/usr/bin/env node
/**
 * demo/explore-states.mjs — make the tour COMPLETE: for every page in
 * demo/shots/manifest.json open every button, tab, menu and expander and
 * record what appears (modal · side menu · sheet · tab content · expanded
 * section · navigation) as an extra STATE of that page.
 *
 * For each state: a screenshot, the bounding boxes of its UI parts (same
 * heuristics as extract-regions.mjs, limited to the opened layer) and the
 * list of buttons / fields inside that layer with their labels.
 *
 * Output: demo/shots/states.json  { "<path>": [ { id, trigger, kind, title, file, width, height,
 *                                   regions, buttons, layer, navTo } ] }
 *         demo/shots/states/*.png
 *
 *   node demo/explore-states.mjs [--out demo/shots] [--only <substr>] [--limit N] [--max 14]
 * Resumable per page. Non-destructive by design (DANGER list, confirm()s are
 * dismissed) — still, restore the DB from the pg_dump snapshot afterwards.
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
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DEBUG = process.argv.includes('--debug');
const dbg = (...a) => { if (DEBUG) console.log('   ·', ...a); };
const MAX_STATES = args.max ? Number(args.max) : 14;
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// never pressed: destructive, leaves the app, camera / files, long jobs, form navigation
const DANGER = /حذف|إزالة|مسح الكل|تصفير|إلغاء الحساب|تسجيل الخروج|خروج|logout|delete|remove|إرسال|ارسال|حفظ|تأكيد|موافقة|رفض|اعتماد|استيراد|تصدير|طباعة|تحميل|رفع|نسخ|واتساب|whatsapp|sms|اتصال|مكالمة|ابدأ|بدء|إنهاء|تشغيل|استعادة|استرجاع|نسخة|backup|restore|reset|إعادة تعيين|تفعيل الكل|إيقاف الكل|الكاميرا|camera|تثبيت|تحديث|refresh|شراء|دفع|تسجيل الدخول|إنشاء حساب|التالي|السابق|رجوع|back|إيقاف|تفعيل|قفل|فتح القفل|نشر|إغلاق|إعادة فتح|أنا مشارك|انضم|الانضمام/i;
// labels that usually open something worth capturing
const PRIORITY = /إضافة|جديد|تعديل|الفلاتر|الترتيب|خيارات|المزيد|القائمة|menu|تفاصيل|عرض|إعدادات|الصلاحيات|نقاط|حضور|رسالة|بيانات|كارت|إنجازات|قالب|معاينة|تصميم|بحث|اختر|اختيار|فردي|جماعي|السجل|الطلبات|دعوة/i;

async function settle(page, extra = 900) {
  try { await page.waitForLoadState('networkidle', { timeout: 12000 }); } catch { /* ok */ }
  try { await page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 5000 }); } catch { /* ok */ }
  await sleep(extra);
}
async function goto(page, url) {
  for (let i = 0; i < 3; i++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 }); return; }
    catch (e) { if (i === 2) throw e; await sleep(800); try { await page.waitForLoadState('load', { timeout: 5000 }); } catch { /* ok */ } }
  }
}
async function login(page, as, code, password) {
  await page.goto(`${BASE}/login${as === 'child' ? '?as=child' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(page, 500);
  await page.fill('input[placeholder="الكود / الرقم القومي"]', code);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => (as === 'child' ? u.pathname.startsWith('/child') : !u.pathname.startsWith('/login')), { timeout: 60000 });
  await settle(page, 1200);
}

/* ---------------- in-page helpers ---------------- */
function pageTriggers() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = []; const seen = new Set();
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 18 && r.height >= 18 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && cs.pointerEvents !== 'none' && r.right > 4 && r.left < window.innerWidth - 4; };
  const label = (el) => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '') || (el.id ? '#' + el.id : '') || (el.querySelector('svg') ? '(icon)' : '');
  const sel = 'button, [role="button"], [role="tab"], summary, a[href]:not([href^="http"]):not([download])';
  for (const el of document.querySelectorAll(sel)) {
    if (!(el instanceof HTMLElement) || !vis(el) || el.disabled) continue;
    if (el.closest('.fixed.inset-0, [role="dialog"], #side-menu, #child-side-menu')) continue;
    if (el.closest('[class*="translate-x-full"]')) continue;
    const r = el.getBoundingClientRect(); const lb = label(el);
    const key = lb + '@' + Math.round(r.left) + ',' + Math.round(r.top + window.scrollY);
    if (seen.has(key)) continue; seen.add(key);
    const tag = el.tagName.toLowerCase();
    let kind = tag === 'a' ? 'link' : tag === 'summary' ? 'expander' : el.getAttribute('role') === 'tab' ? 'tab' : 'button';
    if (kind === 'button' && el.getAttribute('aria-expanded') !== null) kind = 'expander';
    out.push({ label: lb.slice(0, 60), kind, href: tag === 'a' ? el.getAttribute('href') : null, x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), id: el.id || null,
      inHeader: !!el.closest('#app-header, #child-header, header'), inNav: !!el.closest('#bottom-nav, #child-bottom-nav'), type: el.getAttribute('type') });
  }
  return out;
}
function openLayer() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const cands = [...document.querySelectorAll('.fixed.inset-0, [role="dialog"], [aria-modal="true"], #side-menu, #child-side-menu, aside[class*="fixed"]')]
    .filter((el) => { if (!(el instanceof HTMLElement)) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && cs.pointerEvents !== 'none' && el.getAttribute('aria-hidden') !== 'true' && r.width > 40 && r.left < window.innerWidth - 10 && r.right > 10 && !/-translate-x-full|translate-x-full/.test(el.className); });
  if (!cands.length) return null;
  const top = cands[cands.length - 1];
  let panel = top;
  const kids = [...top.children].filter((k) => k instanceof HTMLElement && k.getBoundingClientRect().width > 60 && k.children.length > 0);
  if (kids.length) panel = kids.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
  const r = panel.getBoundingClientRect();
  const heading = panel.querySelector('h1, h2, h3, h4, [class*="font-extrabold"], [class*="font-bold"]');
  const isSide = /side-menu/.test(top.id + panel.id) || (r.height > window.innerHeight * 0.85 && r.width < window.innerWidth * 0.92 && (r.left > 20 || r.right < window.innerWidth - 20));
  const isSheet = !isSide && r.top > window.innerHeight * 0.25 && r.bottom >= window.innerHeight - 6;
  return { kind: isSide ? 'sidemenu' : isSheet ? 'sheet' : 'modal', title: clean(heading?.innerText || '').slice(0, 80), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), text: clean(panel.innerText).slice(0, 300) };
}
function extractIn(rootRect) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const inRoot = (r) => !rootRect || (r.left >= rootRect.x - 3 && r.right <= rootRect.x + rootRect.w + 3 && r.top >= rootRect.y - 3 && r.bottom <= rootRect.y + rootRect.h + 3);
  const out = [], seen = new Set();
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height }; };
  const push = (el, kind, textOverride) => {
    if (!el) return; const r = rect(el); if (r.w < 40 || r.h < 22) return; if (!inRoot(el.getBoundingClientRect())) return;
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`; if (seen.has(key)) return; seen.add(key);
    const heading = el.querySelector('h1, h2, h3, h4, [class*="font-extrabold"]');
    out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), kind, text: clean(textOverride ?? el.innerText).slice(0, 160), label: clean(heading?.innerText || '').slice(0, 60) });
  };
  let rootEl = document.querySelector('#main-content, #child-main, main') || document.body;
  if (rootRect) {
    const all = [...document.querySelectorAll('.fixed.inset-0 *, [role="dialog"] *, #side-menu, #child-side-menu, aside')].filter((el) => el instanceof HTMLElement);
    const hit = all.find((el) => { const r = el.getBoundingClientRect(); return Math.abs(r.left - rootRect.x) < 3 && Math.abs(r.width - rootRect.w) < 3 && Math.abs(r.top - rootRect.y) < 3; });
    rootEl = hit || document.body;
  }
  const isBlock = (el) => { const tag = el.tagName.toLowerCase(); const cls = el.className || ''; return /\bcard\b/.test(cls) || ['section', 'form', 'article', 'table', 'fieldset'].includes(tag) || el.getAttribute('role') === 'tablist' || (/rounded-(xl|2xl|3xl)/.test(cls) && /(bg-|border|shadow)/.test(cls)); };
  const chosen = [];
  const visit = (el) => { if (!(el instanceof HTMLElement)) return; const r = el.getBoundingClientRect(); if (r.width < 60 || r.height < 26) return;
    if (isBlock(el) && el !== rootEl) { const inner = [...el.querySelectorAll('*')].filter((c) => c instanceof HTMLElement && isBlock(c) && c.getBoundingClientRect().height >= 50); if (r.height > 420 && inner.length >= 2) { for (const c of el.children) visit(c); return; } chosen.push(el); return; }
    for (const c of el.children) visit(c); };
  visit(rootEl);
  for (const el of rootEl.querySelectorAll('h1, h2, h3, [role="tablist"], .grid')) { if (chosen.some((c) => c.contains(el) || el.contains(c))) continue; const r = el.getBoundingClientRect(); if (r.height < 22 || r.height > 400 || r.width < 80) continue; chosen.push(el); }
  chosen.sort((a, b) => rect(a).y - rect(b).y);
  for (const el of chosen) { const tag = el.tagName.toLowerCase(); let kind = 'block';
    if (/^h[1-3]$/.test(tag)) kind = 'title'; else if (tag === 'form' || el.querySelector('input, select, textarea')) kind = 'form';
    else if (el.getAttribute('role') === 'tablist' || (el.querySelectorAll('button').length >= 2 && el.getBoundingClientRect().height < 80)) kind = 'tabs';
    else if (el.querySelectorAll('button, a').length >= 2 && el.getBoundingClientRect().height < 120) kind = 'actions';
    else if (el.querySelectorAll('li, article, .card, [class*="rounded"]').length >= 3) kind = 'list';
    push(el, kind); }
  const buttons = [];
  for (const el of rootEl.querySelectorAll('button, [role="button"], a[href], input:not([type=hidden]), select, textarea')) {
    if (!(el instanceof HTMLElement)) continue; const r = el.getBoundingClientRect(); if (r.width < 18 || r.height < 18 || !inRoot(r)) continue;
    if (getComputedStyle(el).visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase();
    const lb = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText) || el.innerText || '');
    const kind = tag === 'a' ? 'link' : (tag === 'button' || el.getAttribute('role') === 'button') ? 'button' : tag === 'select' ? 'select' : el.getAttribute('type') === 'checkbox' ? 'checkbox' : 'field';
    buttons.push({ label: (lb || (el.querySelector('svg') ? '(icon)' : '')).slice(0, 60), kind, x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height), disabled: !!el.disabled, primary: /btn-primary|bg-primary|bg-emerald|bg-green|bg-blue|bg-rose|bg-red|bg-amber|bg-indigo|bg-violet/.test(el.className) });
    if (kind === 'button' && r.width > 100 && r.height >= 36) push(el, 'button', lb);
    if (kind === 'field' || kind === 'select') push(el, 'field', lb);
  }
  const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  return { width: document.documentElement.clientWidth, height: docH, regions: out, buttons };
}

async function closeLayers(page) {
  for (let t = 0; t < 4; t++) {
    const l = await page.evaluate(openLayer);
    if (!l) return;
    const closeBtn = page.locator('.fixed.inset-0 button[aria-label*="إغلاق"], .fixed.inset-0 button[aria-label*="close" i], .fixed.inset-0 button:has-text("إغلاق"), .fixed.inset-0 button:has-text("إلغاء"), #side-menu button[aria-label], #child-side-menu button[aria-label]').first();
    if (await closeBtn.isVisible().catch(() => false)) { await closeBtn.click({ timeout: 1500 }).catch(() => {}); await sleep(350); continue; }
    await page.keyboard.press('Escape'); await sleep(300);
    if (await page.evaluate(openLayer)) { await page.mouse.click(l.x > 60 ? 5 : 425, 500).catch(() => {}); await sleep(300); }
  }
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8')).filter((m) => !m.error);
  const statesPath = path.join(OUT, 'states.json');
  let states = {};
  try { states = JSON.parse(await fs.readFile(statesPath, 'utf8')); } catch { /* fresh */ }
  await fs.mkdir(path.join(OUT, 'states'), { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let budget = LIMIT;
  for (const persona of ['public', 'owner', 'child']) {
    if (budget <= 0) break;
    const list = manifest.filter((m) => m.persona === persona && !states[m.path] && (!ONLY || m.path.includes(ONLY))).slice(0, budget);
    if (!list.length) continue;
    budget -= list.length;
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, locale: 'ar-EG', timezoneId: 'Africa/Cairo', permissions: ['camera'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    if (persona === 'owner') await login(page, 'servant', '10000000000001', 'Test@1234');
    if (persona === 'child') await login(page, 'child', '30101010100001', '123456');

    for (const m of list) {
      const t0 = Date.now();
      const result = [];
      const slug = m.file.replace(/\.png$/, '');
      let triggers = [];
      try {
        try { await page.waitForLoadState('load', { timeout: 4000 }); } catch { /* ok */ }
        await goto(page, `${BASE}${m.path}`);
        await settle(page, m.settle ?? 1000);
        await closeLayers(page);
        triggers = await page.evaluate(pageTriggers);
        const TEXT_HASH = () => { const t = document.body.innerText.replace(/[0-9٠-٩:]/g, ''); let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h + '|' + t.length; };
        let baseText = await page.evaluate(TEXT_HASH);
        const rank = (t) => (t.id === 'side-menu-btn' || t.id === 'child-menu-btn' ? 0 : t.inHeader ? 1 : PRIORITY.test(t.label) ? 2 : t.kind === 'tab' || t.kind === 'expander' ? 3 : t.kind === 'button' ? 4 : 6);
        triggers = triggers.filter((t) => !t.inNav && !DANGER.test(t.label) && t.type !== 'submit' && !(t.kind === 'link' && (!t.href || t.href.startsWith('#'))))
          .sort((a, b) => rank(a) - rank(b) || a.y - b.y);
        const perLabel = {}; triggers = triggers.filter((t) => { perLabel[t.label] = (perLabel[t.label] || 0) + 1; return perLabel[t.label] <= 2; });
        if (DEBUG) for (const t of triggers) dbg('trigger', JSON.stringify(t));
        const seenLayers = new Set();
        for (const t of triggers) {
          if (result.filter((r) => r.file).length >= MAX_STATES) break;
          const stateId = `${slug}--${result.length + 1}`;
          try {
            // links: we already know the destination — no need to click
            if (t.kind === 'link' && t.href) {
              const u = new URL(t.href, BASE); const navTo = u.pathname + u.search;
              if (navTo === m.path || manifest.some((mm) => mm.path === navTo) || seenLayers.has('link|' + navTo)) { if (navTo !== m.path && !seenLayers.has('link|' + navTo)) { seenLayers.add('link|' + navTo); result.push({ id: stateId, trigger: t, kind: 'navigate', title: '', navTo, file: null }); } continue; }
              seenLayers.add('link|' + navTo);
              dbg('link', t.label, '→', navTo);
              await goto(page, `${BASE}${navTo}`); await settle(page, 900); await closeLayers(page);
              if (page.url().includes('/login')) { await goto(page, `${BASE}${m.path}`); await settle(page, 700); continue; }
              const ex = await page.evaluate(extractIn, null);
              const file = `states/${stateId}.png`;
              await page.evaluate(() => window.scrollTo(0, 0)); await sleep(120);
              await page.screenshot({ path: path.join(OUT, file), fullPage: true });
              const title = await page.evaluate(() => (document.querySelector('h1, h2')?.innerText || document.title || '').replace(/\s+/g, ' ').trim().slice(0, 80));
              result.push({ id: stateId, trigger: t, kind: 'navigate', title, navTo, file, viewportOnly: false, width: ex.width, height: ex.height, regions: ex.regions, buttons: ex.buttons, layer: null });
              await goto(page, `${BASE}${m.path}`); await settle(page, 800);
              continue;
            }
            // relocate the trigger by id / label (coordinates go stale after layout changes)
            const box = await page.evaluate((t) => {
              const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
              const label = (el) => clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '') || (el.id ? '#' + el.id : '') || (el.querySelector('svg') ? '(icon)' : '');
              let cands = [];
              if (t.id) { const e = document.getElementById(t.id); if (e) cands = [e]; }
              if (!cands.length) {
                cands = [...document.querySelectorAll('button, [role="button"], [role="tab"], summary')].filter((el) => el instanceof HTMLElement && !el.closest('.fixed.inset-0, [role="dialog"], #side-menu, #child-side-menu') && label(el).slice(0, 60) === t.label);
              }
              cands = cands.filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 10 && r.height >= 10 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
              if (!cands.length) return null;
              const el = cands.sort((a, b) => Math.abs(a.getBoundingClientRect().top + window.scrollY - t.y) - Math.abs(b.getBoundingClientRect().top + window.scrollY - t.y))[0];
              el.scrollIntoView({ block: 'center', inline: 'nearest' });
              const r = el.getBoundingClientRect();
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              const covered = hit && !(el === hit || el.contains(hit) || hit.contains(el));
              const coveredBy = covered ? (hit.closest('#bottom-nav, #child-bottom-nav, #app-header, #child-header, nav, header')?.id || hit.tagName + '.' + String(hit.className).slice(0, 40)) : null;
              if (covered) { el.setAttribute('data-tour-click', '1'); }
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: true, direct: !!covered, coveredBy, byId: !!t.id };
            }, t);
            await sleep(120);
            if (!box || !box.ok) { dbg('miss', t.label, t.kind, box); continue; }
            const urlBefore = page.url();
            if (box.direct) { dbg('direct-click', t.label, box.coveredBy); await page.evaluate(() => { const e = document.querySelector('[data-tour-click]'); if (e) { e.removeAttribute('data-tour-click'); e.click(); } }); }
            else await page.mouse.click(box.x, box.y);
            await sleep(700);
            try { await page.waitForLoadState('networkidle', { timeout: 4000 }); } catch { /* ok */ }
            await sleep(300);
            const navigated = page.url() !== urlBefore;
            const layer = navigated ? null : await page.evaluate(openLayer);
            const textNow = await page.evaluate(TEXT_HASH);
            const changed = navigated || layer || textNow !== baseText;
            if (!changed) { dbg('nochange', t.label, t.kind); await closeLayers(page); continue; }
            const kind = navigated ? 'navigate' : layer ? layer.kind : t.kind === 'tab' ? 'tab' : 'expand';
            const title = layer?.title || '';
            const navTo = navigated ? new URL(page.url()).pathname + new URL(page.url()).search : null;
            if (navigated && manifest.some((mm) => mm.path === navTo)) {
              // a link to another page of the tour: record the link, no screenshot
              result.push({ id: stateId, trigger: t, kind, title, navTo, file: null });
              await goto(page, `${BASE}${m.path}`); await settle(page, 700); continue;
            }
            const sig = kind + '|' + (title || layer?.text?.slice(0, 80) || textNow);
            if (!layer && !navigated) { // wait for the change to settle (tabs / expanders re-render)
              await sleep(400); }
            dbg('state', t.label, '→', kind, title || navTo || '');
            if (seenLayers.has(sig)) { if (navigated) { await goto(page, `${BASE}${m.path}`); await settle(page, 700); } else await closeLayers(page); continue; }
            seenLayers.add(sig);
            const file = `states/${stateId}.png`;
            if (!layer) { await page.evaluate(() => window.scrollTo(0, 0)); await sleep(120); }
            const root = layer ? { x: layer.x, y: layer.y, w: layer.w, h: layer.h } : null;
            const ex = await page.evaluate(extractIn, root);
            const scrollY = await page.evaluate(() => window.scrollY);
            await page.screenshot({ path: path.join(OUT, file), fullPage: !layer });
            // for a layer shot (viewport), make regions viewport-relative
            if (layer) { for (const r of ex.regions) r.y -= scrollY; for (const b of ex.buttons) b.y -= scrollY; }
            result.push({ id: stateId, trigger: t, kind, title, navTo, file, viewportOnly: !!layer, width: ex.width, height: layer ? 932 : ex.height, regions: ex.regions, buttons: ex.buttons, layer: layer ? { x: layer.x, y: layer.y, w: layer.w, h: layer.h } : null });
            if (navigated) { await goto(page, `${BASE}${m.path}`); await settle(page, 800); baseText = await page.evaluate(TEXT_HASH); }
            else if (layer) await closeLayers(page);
            else {
              // toggle back (expanders / mode buttons / group cards), then verify we are back at the baseline; reload otherwise
              if (t.kind === 'expander' || kind === 'expand') { if (box.direct) await page.evaluate((id) => document.getElementById(id)?.click(), t.id || '').catch(() => {}); else await page.mouse.click(box.x, box.y).catch(() => {}); await sleep(350); }
              const back = await page.evaluate(TEXT_HASH);
              if (back !== baseText) { dbg('reload after', t.label); await goto(page, `${BASE}${m.path}`); await settle(page, 800); await closeLayers(page); baseText = await page.evaluate(TEXT_HASH); }
            }
          } catch (err) {
            dbg('error', t.label, String(err.message).split('\n')[0]);
            await closeLayers(page).catch(() => {});
            if (!page.url().includes(m.path.split('?')[0])) { await goto(page, `${BASE}${m.path}`).catch(() => {}); await settle(page, 800); }
          }
        }
        states[m.path] = result;
        console.log(`✓ ${m.path}  ${result.length} states (${result.filter((r) => r.file).length} shots, ${triggers.length} triggers) ${Date.now() - t0} ms`);
      } catch (e) {
        console.log(`✗ ${m.path}: ${String(e.message).split('\n')[0]}`);
        if (result.length) states[m.path] = result; // otherwise leave it for the next batch (retry)
        try { await page.goto('about:blank', { timeout: 5000 }); } catch { /* ok */ }
      }
      await fs.writeFile(statesPath, JSON.stringify(states));
    }
    await ctx.close();
  }
  await browser.close();
  const remaining = manifest.filter((m) => !states[m.path]).length;
  console.log(`\n${Object.keys(states).length} pages → ${statesPath}${remaining ? ` (${remaining} remaining)` : ' (all done)'}`);
  process.exit(remaining ? 3 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
