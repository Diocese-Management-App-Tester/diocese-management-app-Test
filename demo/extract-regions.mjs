#!/usr/bin/env node
/**
 * demo/extract-regions.mjs — for every page in demo/shots/manifest.json,
 * revisit it (same 430 px viewport as the screenshot) and record the
 * bounding boxes of the UI parts that the interactive gallery draws
 * callout lines to: header, bottom nav, and every meaningful block inside
 * <main> (sections, cards, forms, tab strips, buttons, lists).
 *
 * Output: demo/shots/regions.json  { "<path>": { width, height, regions:[{x,y,w,h,text,kind}] } }
 *
 *   node demo/extract-regions.mjs [--out demo/shots] [--only <substr>] [--limit N]
 * Resumable like capture.mjs. Needs the app + backend running (see README).
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
const CHROME = process.env.CHROME || '/usr/bin/chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, extra = 1200) {
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch { /* ok */ }
  try { await page.waitForFunction(() => !document.querySelector('.animate-spin, .animate-pulse'), null, { timeout: 8000 }); } catch { /* ok */ }
  await sleep(extra);
}
async function login(page, as, code, password) {
  await page.goto(`${BASE}/login${as === 'child' ? '?as=child' : ''}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await settle(page, 500);
  await page.fill('input[placeholder="الكود / الرقم القومي"]', code);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => (as === 'child' ? u.pathname.startsWith('/child') : !u.pathname.startsWith('/login')), { timeout: 60000 });
  await settle(page, 1500);
}

/** runs in the page: returns candidate regions (document coordinates) */
function extract() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const seen = new Set();
  const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height }; };
  const push = (el, kind, textOverride) => {
    if (!el) return;
    const r = rect(el);
    if (r.w < 40 || r.h < 24) return;
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const heading = el.querySelector('h1, h2, h3, h4, [class*="font-extrabold"]');
    out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), kind,
      text: clean(textOverride ?? el.innerText).slice(0, 160), label: clean(heading?.innerText || '').slice(0, 60) });
  };

  // fixed chrome (page scrolled to 0 → document coords == viewport coords)
  push(document.querySelector('#app-header, #child-header, header'), 'header');
  push(document.querySelector('#bottom-nav, #child-bottom-nav'), 'nav');

  const main = document.querySelector('#main-content, #child-main, main') || document.body;
  const isBlock = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = el.className || '';
    return /\bcard\b/.test(cls) || ['section', 'form', 'article', 'table'].includes(tag)
      || el.getAttribute('role') === 'tablist' || /rounded-(2xl|3xl)/.test(cls) && /(bg-|border|shadow)/.test(cls);
  };
  // outermost blocks (skip descendants of an already-chosen block), but a
  // block that is a tall container of ≥ 2 blocks is split into its children
  const chosen = [];
  const visit = (el) => {
    if (!(el instanceof HTMLElement)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 28) return;
    if (isBlock(el)) {
      const inner = [...el.querySelectorAll('*')].filter((c) => c instanceof HTMLElement && isBlock(c) && c.getBoundingClientRect().height >= 60);
      if (r.height > 520 && inner.length >= 2) { for (const c of el.children) visit(c); return; }
      chosen.push(el); return;
    }
    for (const c of el.children) visit(c);
  };
  visit(main);
  // loose page parts that are not cards (title rows, tab strips, toolbars, tiles grids)
  for (const el of main.querySelectorAll('h1, h2, [role="tablist"], .grid')) {
    if (chosen.some((c) => c.contains(el) || el.contains(c))) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.height > 400) continue;
    chosen.push(el);
  }
  chosen.sort((a, b) => rect(a).y - rect(b).y);
  for (const el of chosen) {
    const tag = el.tagName.toLowerCase();
    let kind = 'block';
    if (/^h[1-3]$/.test(tag)) kind = 'title';
    else if (tag === 'form' || el.querySelector('input, select, textarea')) kind = 'form';
    else if (el.getAttribute('role') === 'tablist' || (el.querySelectorAll('button').length >= 2 && el.getBoundingClientRect().height < 80)) kind = 'tabs';
    else if (el.querySelectorAll('button, a').length >= 2 && el.getBoundingClientRect().height < 120) kind = 'actions';
    else if (el.querySelectorAll('li, article, .card, [class*="rounded"]').length >= 3) kind = 'list';
    push(el, kind);
  }
  // public pages: brand block (logo + diocese name)
  const h1 = document.querySelector('h1');
  if (h1 && !chosen.some((b) => b.contains(h1))) push(h1.parentElement || h1, 'title');
  // fields + primary buttons in the first two forms
  for (const f of chosen.filter((b) => b.tagName === 'FORM' || b.querySelector('input, select, textarea')).slice(0, 2)) {
    for (const el of f.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea, button[type=submit]')) {
      const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText) || el.innerText || el.type;
      push(el, el.tagName === 'BUTTON' ? 'button' : 'field', label);
    }
  }
  // KPI tiles inside small grids
  for (const g of main.querySelectorAll('.grid')) {
    const kids = [...g.children];
    if (kids.length < 2 || kids.length > 6) continue;
    if (!chosen.some((c) => c === g || c.contains(g))) continue;
    for (const c of kids.slice(0, 4)) { const r = c.getBoundingClientRect(); if (r.height >= 40 && r.height < 160 && r.width < 300) push(c, 'tile'); }
  }
  return { width: document.documentElement.clientWidth, height: docH, regions: out };
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(OUT, 'manifest.json'), 'utf8'));
  const regPath = path.join(OUT, 'regions.json');
  let regions = {};
  try { regions = JSON.parse(await fs.readFile(regPath, 'utf8')); } catch { /* fresh */ }

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process', '--no-zygote', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let budget = LIMIT;
  for (const persona of ['public', 'owner', 'child']) {
    if (budget <= 0) break;
    const list = manifest.filter((m) => m.persona === persona && !m.error && !regions[m.path] && (!ONLY || m.path.includes(ONLY))).slice(0, budget);
    if (!list.length) continue;
    budget -= list.length;
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, locale: 'ar-EG', timezoneId: 'Africa/Cairo', permissions: ['camera'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    if (persona === 'owner') await login(page, 'servant', '10000000000001', 'Test@1234');
    if (persona === 'child') await login(page, 'child', '30101010100001', '123456');
    for (const m of list) {
      const t0 = Date.now();
      try {
        await page.goto(`${BASE}${m.path}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await settle(page, m.settle ?? 1200);
        await page.evaluate(() => window.scrollTo(0, 0));
        const r = await page.evaluate(extract);
        regions[m.path] = r;
        console.log(`✓ ${m.path}  ${r.regions.length} regions (${Date.now() - t0} ms)`);
      } catch (e) {
        console.log(`✗ ${m.path}: ${String(e.message).split('\n')[0]}`);
        regions[m.path] = { width: 430, height: 0, regions: [], error: String(e.message).split('\n')[0] };
      }
      await fs.writeFile(regPath, JSON.stringify(regions));
    }
    await ctx.close();
  }
  await browser.close();
  const remaining = manifest.filter((m) => !m.error && !regions[m.path]).length;
  console.log(`\n${Object.keys(regions).length} pages → ${regPath}${remaining ? ` (${remaining} remaining)` : ' (all done)'}`);
  process.exit(remaining ? 3 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
