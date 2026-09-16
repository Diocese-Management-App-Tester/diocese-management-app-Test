// Service Worker — Diocese Management PWA
// Network-first for pages (realtime app), cache-first for static assets.
//
// Rules that matter (learned the hard way):
//  • respondWith() MUST always resolve to a real Response. Returning
//    `undefined` (cache miss) makes the browser fail the request with
//    «Failed to convert value to 'Response'» — pages went blank and images
//    disappeared on phones with flaky connections.
//  • Never touch cross-origin requests (Supabase storage / API / realtime,
//    Google fonts): let the browser handle them natively.
//  • Never serve an HTML fallback for an image / script / style request.
//
// Branding: the app is registered as `/sw.js?b=<version>&n=<short name>`
// (see PwaRegister). Icons come from /branding/icon/<size>, which the server
// renders from the NEXT_PUBLIC_APP_ICON_URL environment variable (or
// redirects to the bundled /icons when it is unset). A change of any branding
// variable changes `b`, which makes the browser install this worker afresh
// and drop the previous brand's cache.
const SW_PARAMS = new URLSearchParams(self.location.search);
const BRAND_VERSION = SW_PARAMS.get('b') || '0';
const APP_SHORT_NAME = SW_PARAMS.get('n') || 'D.M.A';
const CACHE_NAME = 'diocese-v5-' + BRAND_VERSION;
const OFFLINE_URL = '/offline';
// `?v=` mirrors src/lib/branding.ts so SW cache keys match the page's URLs.
const ICON = (size) => '/branding/icon/' + size + '?v=' + BRAND_VERSION;
const MANIFEST_URL = '/branding/manifest?v=' + BRAND_VERSION;
const STATIC_ASSETS = [
  OFFLINE_URL,
  MANIFEST_URL,
  ICON(96),
  ICON(192),
  ICON(512),
  ICON(180),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(STATIC_ASSETS.map((u) => cache.add(u))))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/branding/') ||
  url.pathname.startsWith('/_next/static/') ||
  url.pathname === '/favicon.ico' ||
  /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?)$/i.test(url.pathname);

const offlineResponse = () =>
  new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير متصل</title>' +
    '<body style="font-family:sans-serif;text-align:center;padding:3rem 1rem;color:#334155">' +
    '<h1 style="font-size:1.25rem">لا يوجد اتصال بالإنترنت</h1><p>تأكد من الاتصال ثم أعد المحاولة.</p>' +
    '<button onclick="location.reload()" style="padding:.6rem 1.2rem;border-radius:.75rem;border:0;background:#1e3a8a;color:#fff;font-weight:700">إعادة المحاولة</button>' +
    '</body></html>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Only same-origin. Supabase (storage / rest / realtime), fonts, etc. are
  // left entirely to the browser.
  if (url.origin !== self.location.origin) return;
  // Never intercept API routes or Next's image optimizer.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/image')) return;

  // Cache-first for immutable static assets
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
            }
            return res;
          })
          .catch(() => new Response('', { status: 504, statusText: 'offline' }));
      })
    );
    return;
  }

  // Network-first for navigations / pages; cached copy or offline page as fallback
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL).then((o) => o || offlineResponse()))
        )
    );
    return;
  }

  // Everything else (RSC payloads, data, …): plain network, never `undefined`
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || new Response('', { status: 504, statusText: 'offline' }))
    )
  );
});

// ---------------------------------------------------------------------
// Web Push (وحدة الإشعارات, migration 0034)
// Payload: { title, body, image, url, tag, recipient_id, is_child }
// ---------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'إشعار', body: event.data ? event.data.text() : '' }; }
  const title = data.title || APP_SHORT_NAME;
  const options = {
    body: data.body || '',
    icon: data.icon || ICON(192),
    badge: data.badge || ICON(96),
    image: data.image || undefined,
    dir: 'rtl',
    lang: 'ar',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || (data.is_child ? '/child/notifications' : '/notifications/inbox'), recipient_id: data.recipient_id || null },
  };
  event.waitUntil(
    self.registration.showNotification(title, options).then(() =>
      // tell open pages so the bell refreshes instantly
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'push', recipient_id: data.recipient_id || null }));
      })
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  const url = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.focus();
          if ('navigate' in c) return c.navigate(url).catch(() => c.postMessage({ type: 'navigate', url }));
          c.postMessage({ type: 'navigate', url });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// the browser rotated the subscription → the app re-registers on next open
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'pushsubscriptionchange' }));
    })
  );
});
