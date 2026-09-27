# demo/ — interactive iPhone walkthrough of the whole app

Everything needed to run the app **without a Supabase project** (plain
PostgreSQL + PostgREST + a tiny auth/realtime emulator), fill it with the
demo data from `supabase/seed_test_data.sql`, capture **one screenshot of
every page** (servant side, owner module, every optional module and the
child portal) and present them as an **interactive iPhone mockup tour**:

- iPhone 15 Pro frame — the real page scrolls inside it; the app header and
  bottom bar stay pinned like on the device
- per page: what the page is for (Arabic + English) and a numbered list of
  its **parts and their use**
- numbered callouts drawn on the screenshot with **leader lines** to the
  matching list item — hover to highlight, click to scroll the phone there,
  keys 1–9 jump to a part
- toolbar (SVG icon buttons): page ◀ ▶ · **callout ◀ ▶** (step through the
  parts) · **phone size − / + / fit** · **fullscreen** · **⚙ settings**
- the phone keeps the exact iPhone ratio (430 × 932) at any size; ⚙ lets you
  set **width and height in px**, unlock the ratio, or pick S / M / L / XL /
  fit-screen presets. No camera island.
- ⚙ settings (saved in the browser): auto-tour timing (seconds per callout,
  pause before the next page, dwell on pages without callouts, loop),
  **keyboard bindings for every action** (click a field, press a key),
  auto-scroll on/off
- leader lines are drawn on a window-level overlay from the number badge on
  the phone to its list item; they follow scrolling of the phone, the stage
  and the list, and are hidden for parts scrolled off the screen (their
  list items dim)
- sidebar by section, deep links (`#12`), grid of all pages, **auto tour**
  (walks every part of every page), AR / EN / both toggle
- default keys: ← → pages · ↑ ↓ callouts · 1–9 jump to a part · Space play ·
  F fullscreen · + − 0 phone size · G grid · S settings · Esc close
- **every menu, dialog, sheet, tab and expander** (550 states over the 99
  pages): the explorer clicks every non-destructive control of every page and
  screenshots what opens. In the viewer each page has a **states bar** (Page ·
  القائمة الجانبية · نافذة «تاريخ العمل» · الفلاتر · …) and the sidebar nests
  them under the page (▾ N); the phone shows the opened state with the
  **trigger outlined in gold** (which button opened it), its own callouts
  and a description of what it is and does. Menus ◀ ▶ toolbar buttons /
  PgUp PgDn keys step through them, Backspace / Esc returns to the page;
  deep links `#12.3` = page 12, state 3. The auto tour opens them too
  (toggle in ⚙).
- explanation panel in three tabs: **الأجزاء / Parts** (numbered callouts
  with leader lines) · **الأزرار والقوائم / Buttons & menus** (every control
  of the page or of the opened dialog with what it does, taken from the
  README — with «open ↗» / «go to ↗» buttons that jump to the state or page
  it leads to; hovering a control outlines it on the phone) · **من الدليل /
  From README** (the page's row of *Functional Entry Points*, the matching
  *Currently Completed Features* bullets and the full module sections of
  the repository README, rendered as collapsible cards with line numbers).
  Q / W / E switch the tabs.

```
demo/
  gallery/index.html   ← OPEN THIS — the interactive tour (99 pages + 550 menus/dialogs, ~930 callouts, 2 400 explained controls)
  gallery/img/*.png    ← the screenshots (430 px wide; pages full-page, dialogs viewport)
  shots/manifest.json  ← title · route · persona · note per page
  shots/regions.json   ← bounding boxes of the UI parts of every page
  shots/states.json    ← per page: every explored state (trigger · kind · title · regions · buttons · screenshot)
  shots/states/*.png   ← the state screenshots
  capture.mjs          ← Playwright walker (list of pages + personas) → screenshots
  extract-regions.mjs  ← Playwright walker → regions.json (header, nav, cards, forms, fields, tiles…)
  explore-states.mjs   ← Playwright explorer: clicks every safe control → states.json + states/*.png
  explanations.mjs     ← the texts: purpose of every page + its parts (AR + EN), matched to regions
  glossary.mjs         ← what every button / menu / control does (AR + EN), matched by its label (≈210 rules from the README)
  readme-map.mjs       ← README.md → entry-point row + feature bullets + module sections per page, Markdown → HTML
  viewer.html          ← the viewer UI (HTML/CSS/JS template; __DATA__ / __README__ are injected by the builder)
  build-gallery.mjs    ← manifest + regions + states + explanations + glossary + README + PNGs + viewer.html → gallery/index.html
  run-capture.sh       ← batched runner for small machines (restarts next dev between batches)
  local-supabase.mjs   ← Supabase emulator (auth · rest proxy · storage · realtime)
  postgrest.conf       ← PostgREST config (schema public, anon role, JWT secret)
```

## What is in the gallery

| Section | Pages |
|---|---|
| الدخول والتسجيل | login (servant / child), servant signup, child signup |
| الصفحات الأساسية | home widgets, children list, scanner, statistics, settings hub |
| إدارة المخدومين / إدارة الخدام | people · add · requests · invite tabs, families |
| الإعدادات | churches, services, classes, events, causes, call feedbacks, data requests, card templates + designer, backup |
| وحدة المالك | hub, module grants, permission profiles, persons, customization (taskbar · header · widgets · names · codes) |
| الوحدات | shepherds, store (hub · inventory · POS · archive), exams, birthdays, messages, notifications, online classes, achievements, occasions, exam results (6 pages), library, activity log (4 tabs), reports (3), access control (2) |
| بوابة المخدوم | home, attendance, points, data/QR, exams + player, messages + thread, notifications, online + live room, achievements, occasions + ticket, library, options |

Personas: **owner** `10000000000001 / Test@1234` for every servant page,
**child** `30101010100001 / 123456` for the portal.

## Reproduce

```bash
# 1. PostgreSQL 17 on port 5433 with the local shim + all migrations + demo data
PGHOST=/tmp PGPORT=5433 supabase/tests/run_migrations.sh
psql -h /tmp -p 5433 -U postgres -d app -f supabase/seed_test_data.sql
psql -h /tmp -p 5433 -U postgres -d app <<'SQL'
-- PostgREST ≥ 12 passes the claims as ONE json GUC; the shim reads request.jwt.claim.*
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon') $$;
alter table auth.users add column if not exists encrypted_password text;
update auth.users set encrypted_password = crypt('Test@1234', gen_salt('bf'));
grant usage on schema public, auth, storage to service_role;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
SQL

# 2. PostgREST (static binary) + the emulator
postgrest demo/postgrest.conf &                      # :3001
npm i -g pg ws && node demo/local-supabase.mjs &      # :54321  (needs pg + ws)

# 3. the app
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key
SUPABASE_SERVICE_ROLE_KEY=demo-service-role-key
EOF
npm run dev                                           # :3000

# 4. capture + regions + gallery (playwright-core + system chromium)
node demo/capture.mjs --out demo/shots                # or: demo/run-capture.sh 8
node demo/extract-regions.mjs --out demo/shots        # or: demo/run-capture.sh 12 extract-regions.mjs
pg_dump -Fc -h /tmp -p 5433 -U postgres app > snap.dump   # the explorer clicks things: snapshot first
node demo/explore-states.mjs --out demo/shots         # or: demo/run-capture.sh 6 explore-states.mjs  (~70 min)
pg_restore -h /tmp -p 5433 -U postgres -d app --clean --if-exists snap.dump
node demo/build-gallery.mjs                           # → demo/gallery/index.html
node demo/build-gallery.mjs --inline                  # single self-contained HTML (~150 MB with all states)
```

### How the explorer decides what to click (`explore-states.mjs`)

For every page it collects every visible `button`, `[role=button]`,
`[role=tab]`, `summary` and internal link outside the bottom bar, drops
anything whose label matches the **DANGER** list (حذف · إرسال · حفظ · تأكيد ·
تسجيل الخروج · استيراد · تصدير · طباعة · نشر · ابدأ · إنهاء · اعتماد · رفض …)
and `type=submit`, ranks the rest (menu button → header → إضافة / الفلاتر /
الترتيب / تفاصيل … → tabs & expanders → other buttons), keeps at most two
controls per label and at most 14 screenshots per page. Links are visited
directly (`goto`) and recorded as a **navigate** state — with a screenshot
when the destination is not already a page of the tour, or just as a link
otherwise. Every other control is re-located by id / label, clicked (through
a direct DOM click when a sticky element covers it), and the result is
classified: **sidemenu / modal / sheet** (an open `.fixed.inset-0`,
`[role=dialog]`, `#side-menu` … panel) · **tab** · **expand** (the page text
changed). Layers are closed with their close button → Escape → backdrop
click; toggles are clicked again; if the page text is still not back to the
baseline it is reloaded. `--debug` prints every decision, `--only /children
--limit 1 --max 10` tests a single page. Browser dialogs are dismissed
automatically. Nothing destructive is clicked, but the DB snapshot / restore
around the run is the real safety net.

Both walkers are resumable (skip pages already in `manifest.json` /
`regions.json`) and accept `--only <substring>` and `--limit N`. Add a page
by appending to `PAGES` in `capture.mjs`; describe it (and its parts) in
`explanations.mjs` — a part is `{ match, ar, en }` where `match` is a
RegExp tested against the region's heading / text, or `'kind:header'`,
`'kind:nav'`, `'kind:tabs'`, `'kind:form'`, `'kind:tile'`… Parts without an
explicit explanation get a generic one from the region kind and its heading.

## Emulator notes (`local-supabase.mjs`)

- `/auth/v1` — password grant checked with `crypt()` against
  `auth.users.encrypted_password`, refresh tokens, `GET/PUT /user`, signup,
  minimal `admin/users` (used by `/api/servants/*`). Issues HS256 JWTs with
  the PostgREST secret (`role: authenticated`, `sub: <uid>`), so **RLS runs
  for real** on every query.
- `/rest/v1` — proxied to PostgREST with CORS; the demo anon key becomes the
  `anon` role, the demo service key becomes a `service_role` JWT.
- `/storage/v1` — no files in the demo → photos fall back to initials/icons.
- `/realtime/v1` — phoenix array protocol: joins/heartbeats acknowledged so
  channels stay `SUBSCRIBED`; broadcast is echoed to the other sockets; no
  `postgres_changes` events (the pages re-fetch on focus anyway).

Only for local demos — no rate limiting, no e-mail, plain-text demo keys.
