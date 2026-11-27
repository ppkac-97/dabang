// Cache vỏ app để mở được khi mất mạng. Đổi VER khi sửa file để điện thoại lấy bản mới.
const VER = 'dabang-v4';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'topik.json', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = u.origin === location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!sameOrigin && !font) return;               // GitHub API, Gemini, ảnh báo: đi thẳng mạng
  if (u.pathname.endsWith('widget.js')) return;
  // stale-while-revalidate
  e.respondWith(caches.open(VER).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: sameOrigin });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
