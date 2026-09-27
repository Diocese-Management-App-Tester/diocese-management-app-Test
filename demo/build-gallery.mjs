#!/usr/bin/env node
/**
 * demo/build-gallery.mjs — interactive iPhone walkthrough of every page.
 *
 * Inputs : demo/shots/manifest.json (pages), demo/shots/*.png (screenshots),
 *          demo/shots/regions.json (bounding boxes of UI parts, from
 *          extract-regions.mjs), demo/explanations.mjs (texts).
 * Output : demo/gallery/index.html (+ img/) — or one self-contained file
 *          with --inline.
 *
 * Features: iPhone 15 Pro mockup with the real page scrolling inside it,
 * per-page explanation (Arabic + English), numbered callouts with leader
 * lines drawn to the actual parts of the screenshot (hover / click to
 * highlight, click scrolls the phone to the part), section navigation,
 * keyboard ← → , auto-play tour, grid overview, deep links (#12).
 *
 *   node demo/build-gallery.mjs [--shots demo/shots] [--out demo/gallery] [--inline]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pages as EXPL, generic as GENERIC, byKind as BYKIND } from './explanations.mjs';
import { explain, fallback, stateExplain } from './glossary.mjs';
import { readmeFor, mdToHtml } from './readme-map.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : [])).filter((x) => x.length)
);
const SHOTS = path.resolve(args.shots || 'demo/shots');
const OUT = path.resolve(args.out || 'demo/gallery');
const INLINE = !!args.inline;

const manifest = JSON.parse(await fs.readFile(path.join(SHOTS, 'manifest.json'), 'utf8')).filter((m) => !m.error);
let regions = {};
try { regions = JSON.parse(await fs.readFile(path.join(SHOTS, 'regions.json'), 'utf8')); } catch { console.warn('no regions.json — callouts will be missing'); }
let STATES = {};
try { STATES = JSON.parse(await fs.readFile(path.join(SHOTS, 'states.json'), 'utf8')); } catch { console.warn('no states.json — menus / dialogs will be missing'); }
await fs.mkdir(path.join(OUT, 'img'), { recursive: true });

const PERSONA = { public: ['صفحة عامة', 'Public page'], owner: ['دخول: مالك التطبيق 10000000000001', 'Signed in: owner 10000000000001'], child: ['دخول: مخدوم 30101010100001', 'Signed in: child 30101010100001'] };

/** pick the callouts of one page: match explanation parts → regions */
function buildCallouts(m) {
  const reg = regions[m.path]?.regions || [];
  const ex = EXPL[m.path] || {};
  const parts = [...(ex.parts || []), ...GENERIC];
  const used = new Set();
  const out = [];
  const test = (rule, r) => {
    if (typeof rule === 'string' && rule.startsWith('kind:')) return r.kind === rule.slice(5);
    const rx = rule instanceof RegExp ? rule : new RegExp(String(rule));
    return rx.test(r.label || '') || rx.test(r.text || '') || (String(rule).startsWith('kind:') ? false : rx.test('kind:' + r.kind));
  };
  // 1. explicit parts, in the author's order
  for (const p of parts) {
    const rule = p.match instanceof RegExp || typeof p.match === 'string' ? p.match : null;
    if (!rule) continue;
    // 'kind:tile|...' style alternatives written as RegExp with kind: → handle
    // among all matching regions prefer the SMALLEST (a field over its form,
    // a tile over its card) so lines point at the exact part
    const hits = reg.map((r, i) => ({ r, i })).filter(({ r, i }) => !used.has(i) && (test(rule, r) || (rule instanceof RegExp && rule.test('kind:' + r.kind))));
    if (!hits.length) continue;
    hits.sort((a, b) => a.r.w * a.r.h - b.r.w * b.r.h);
    const hit = hits[0].r;
    used.add(reg.indexOf(hit));
    out.push({ ...pick(hit), ar: p.ar, en: p.en });
  }
  // 2. remaining meaningful regions (max 12 callouts total) with generic text
  const rest = reg.map((r, i) => ({ r, i })).filter(({ i }) => !used.has(i))
    .filter(({ r }) => !['field', 'button', 'tile'].includes(r.kind) || out.length < 4)
    .sort((a, b) => a.r.y - b.r.y);
  // collapse repeated siblings (rows of the same list: class headers, cards
  // of the same shape) into ONE callout on the first row
  const sig = (r) => `${r.kind}:${r.x}:${r.w}:${Math.round(r.h / 4)}`;
  const seenSig = new Set(out.map(sig));
  for (const { r } of rest) {
    if (out.length >= 12) break;
    if (seenSig.has(sig(r))) continue;
    seenSig.add(sig(r));
    // a good name has letters, not just a number / a bullet
    const goodName = (t) => t && /[\u0600-\u06FFA-Za-z]{2}/.test(t);
    let name = goodName(r.label) ? r.label : r.text.split(' ').slice(0, 6).join(' ');
    if (!goodName(name)) name = '';
    if (!name && !['header', 'nav', 'tabs', 'form'].includes(r.kind)) continue; // an unnamed block says nothing useful
    const [ar, en] = BYKIND[r.kind] || BYKIND.block;
    out.push({ ...pick(r), ar: name ? `${name} — ${ar}` : ar, en: name ? `${name} — ${en}` : en });
  }
  // order by vertical position, header first, nav last
  out.sort((a, b) => (a.kind === 'header' ? -1 : b.kind === 'header' ? 1 : a.kind === 'nav' ? 1 : b.kind === 'nav' ? -1 : a.y - b.y));
  return out;
}
const pick = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, kind: r.kind, label: r.label || r.text.slice(0, 40) });

const goodName = (t) => t && /[\u0600-\u06FFA-Za-z]{2}/.test(t);
/** callouts of one explored state: explained buttons first, then named regions */
function stateCallouts(st) {
  const out = [], seen = new Set();
  const sig = (r) => `${r.kind}:${r.x}:${r.w}:${Math.round(r.h / 4)}`;
  for (const b of st.buttons || []) {
    if (out.length >= 14) break;
    if (b.label === '(icon)' || !goodName(b.label)) continue;
    const e = explain(b.label); if (!e) continue;
    const key = b.label.replace(/[\d٠-٩]+/g, '').trim(); if (seen.has(key)) continue; seen.add(key);
    out.push({ x: b.x, y: b.y, w: b.w, h: b.h, kind: b.kind, label: b.label, ar: `${b.label} — ${e.ar}`, en: `${b.label} — ${e.en}` });
  }
  const seenSig = new Set(out.map(sig));
  for (const r of (st.regions || []).slice().sort((a, b) => a.y - b.y)) {
    if (out.length >= 14) break;
    if (seenSig.has(sig(r))) continue; seenSig.add(sig(r));
    if (out.some((c) => Math.abs(c.x - r.x) < 6 && Math.abs(c.y - r.y) < 6)) continue;
    let name = goodName(r.label) ? r.label : (r.text || '').split(' ').slice(0, 6).join(' ');
    if (!goodName(name)) name = '';
    if (!name && !['header', 'nav', 'tabs', 'form'].includes(r.kind)) continue;
    const e = name ? explain(name) : null;
    const [ar, en] = BYKIND[r.kind] || BYKIND.block;
    out.push({ ...pick(r), ar: name ? `${name} — ${e ? e.ar : ar}` : ar, en: name ? `${name} — ${e ? e.en : en}` : en });
  }
  out.sort((a, b) => (a.kind === 'header' ? -1 : b.kind === 'header' ? 1 : a.kind === 'nav' ? 1 : b.kind === 'nav' ? -1 : a.y - b.y));
  return out;
}
const KIND_LABEL = { sidemenu: ['القائمة الجانبية', 'Side menu'], modal: ['نافذة', 'Dialog'], sheet: ['ورقة سفلية', 'Bottom sheet'], tab: ['تبويب', 'Tab'], expand: ['لوحة موسّعة', 'Expanded'], navigate: ['صفحة', 'Page'] };
const pathIndex = new Map(manifest.map((m, k) => [m.path, k]));

// README docs, deduplicated across pages
const SECT = [], SECT_IDX = new Map(), FEAT = [], FEAT_IDX = new Map();
function readmeRefs(m) {
  const r = readmeFor(m.path);
  const feats = r.features.map((f) => { if (!FEAT_IDX.has(f)) { FEAT_IDX.set(f, FEAT.length); FEAT.push(mdToHtml('- ' + f)); } return FEAT_IDX.get(f); });
  const secs = r.sections.map((sc) => { if (!SECT_IDX.has(sc.title)) { SECT_IDX.set(sc.title, SECT.length); SECT.push({ title: sc.title, line: sc.line, html: mdToHtml(sc.md) }); } return SECT_IDX.get(sc.title); });
  return { entry: r.entry ? mdToHtml(r.entry).replace(/^<p>|<\/p>$/g, '') : '', feats, secs };
}

const slides = [];
let nStates = 0, nControls = 0;
for (const m of manifest) {
  let src = `img/${m.file}`;
  try {
    const buf = await fs.readFile(path.join(SHOTS, m.file));
    if (INLINE) src = `data:image/png;base64,${buf.toString('base64')}`;
    else await fs.writeFile(path.join(OUT, 'img', m.file), buf);
  } catch { src = ''; }
  const ex = EXPL[m.path] || {};
  // ---- explored states (menus / dialogs / tabs / expanders / linked pages)
  const states = [];
  const controls = [], ctlSeen = new Set();
  const addControl = (label, kind, extra = {}) => {
    if (!goodName(label) || label === '(icon)') return;
    const key = label.replace(/[\d٠-٩]+/g, '').trim() + '|' + kind; if (ctlSeen.has(key)) return; ctlSeen.add(key);
    const e = explain(label) || fallback(kind);
    controls.push({ label, kind, ar: e.ar, en: e.en, ...extra });
  };
  for (const st of STATES[m.path] || []) {
    const navIdx = st.navTo != null && pathIndex.has(st.navTo) ? pathIndex.get(st.navTo) : null;
    if (!st.file) { // a link to another page of the tour
      addControl(st.trigger.label, 'link', { nav: navIdx, x: st.trigger.x, y: st.trigger.y, w: st.trigger.w, h: st.trigger.h });
      continue;
    }
    let ssrc = `img/${path.basename(st.file)}`;
    try {
      const buf = await fs.readFile(path.join(SHOTS, st.file));
      if (INLINE) ssrc = `data:image/png;base64,${buf.toString('base64')}`;
      else await fs.writeFile(path.join(OUT, 'img', path.basename(st.file)), buf);
    } catch { continue; }
    const se = stateExplain(st.kind, st.trigger.label, st.title);
    const kl = KIND_LABEL[st.kind] || [st.kind, st.kind];
    const idx = states.length;
    states.push({
      id: st.id, kind: st.kind, kindLabel: kl, title: st.title || st.trigger.label, navTo: st.navTo, nav: navIdx,
      trigger: { label: st.trigger.label, kind: st.trigger.kind, x: st.trigger.x, y: st.trigger.y, w: st.trigger.w, h: st.trigger.h },
      src: ssrc, viewportOnly: !!st.viewportOnly, pageH: st.height || 0, layer: st.layer || null,
      ar: se.ar, en: se.en, callouts: stateCallouts(st),
      buttons: (st.buttons || []).filter((b) => goodName(b.label) && b.label !== '(icon)').slice(0, 60).map((b) => { const e = explain(b.label) || fallback(b.kind); return { label: b.label, kind: b.kind, ar: e.ar, en: e.en }; }),
    });
    addControl(st.trigger.label, st.trigger.kind, { state: idx, x: st.trigger.x, y: st.trigger.y, w: st.trigger.w, h: st.trigger.h });
    // the buttons seen on full-page states belong to the page itself
    if (!st.viewportOnly) for (const b of st.buttons || []) addControl(b.label, b.kind);
  }
  nStates += states.length; nControls += controls.length;
  slides.push({
    section: m.section, title: m.title, path: m.path, finalUrl: m.finalUrl, persona: PERSONA[m.persona] || [m.persona, m.persona],
    ar: ex.ar || m.note || '', en: ex.en || '', src, pageH: regions[m.path]?.height || 0,
    callouts: buildCallouts(m), states, controls, readme: readmeRefs(m),
  });
}
const sections = [...new Set(slides.map((s) => s.section))];

// the viewer UI lives in demo/viewer.html (plain HTML/CSS/JS, easy to edit);
// the builder only injects the data. The data can be > 100 MB when inlined,
// so it is streamed to the file piece by piece instead of one giant string.
const tpl = (await fs.readFile(new URL('./viewer.html', import.meta.url), 'utf8'))
  .replaceAll('__COUNT__', String(slides.length))
  .replaceAll('__NSTATES__', String(nStates))
  .replace('__SECTIONS__', () => JSON.stringify(sections))
  .replace('__README__', () => JSON.stringify({ sections: SECT, features: FEAT }));
const [head, tail] = tpl.split('__DATA__');
{
  const fh = await fs.open(path.join(OUT, 'index.html'), 'w');
  await fh.write(head);
  await fh.write('[');
  for (let k = 0; k < slides.length; k++) { await fh.write((k ? ',' : '') + JSON.stringify(slides[k])); slides[k].states = slides[k].states.map((st) => ({ ...st, src: '' })); }
  await fh.write(']');
  await fh.write(tail);
  await fh.close();
}
const withCallouts = slides.filter((s) => s.callouts.length).length;
console.log(`gallery → ${path.join(OUT, 'index.html')} (${slides.length} pages, ${withCallouts} with callouts, ${slides.reduce((a, s) => a + s.callouts.length, 0)} callouts, ${nStates} menus/dialogs/tabs, ${nControls} explained controls, ${SECT.length} README sections${INLINE ? ', inlined' : ''})`);
