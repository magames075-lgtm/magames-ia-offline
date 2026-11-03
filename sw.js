// Service worker: app offline (cache) + cabeçalhos COOP/COEP para liberar multi-thread (SharedArrayBuffer)
// O modelo da IA fica no armazenamento OPFS (gerenciado pelo wllama), não neste cache.
const VERSION = 'mio-v1.0.0';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'vendor/wllama/index.js',
];
// O motor certo para o aparelho é guardado no 1º uso (build principal ou compat)
const ENGINE_MAIN = ['vendor/wllama/wllama.wasm'];
const ENGINE_COMPAT = ['vendor/wllama-compat/wllama.js', 'vendor/wllama-compat/wllama.wasm'];

function needCompat() {
  if (!WebAssembly.Suspending) return true;
  try { new WebAssembly.Memory({ address: 'i64', initial: BigInt(1) }); return false; } catch { return true; }
}
self.addEventListener('install', (e) => {
  const files = SHELL.concat(needCompat() ? ENGINE_COMPAT : ENGINE_MAIN);
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(files.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withIsolation(res) {
  if (!res || res.status === 0 || res.type === 'opaque') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // downloads do Hugging Face passam direto
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const isNav = req.mode === 'navigate';
    const key = isNav ? 'index.html' : req;
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) {
      if (url.pathname.includes('/vendor/')) return withIsolation(cached); // wasm/libs só mudam com nova versão
      // Atualiza em segundo plano quando há internet (stale-while-revalidate)
      e.waitUntil(fetch(req.url.split('?')[0], { cache: 'no-cache' }).then((r) => { if (r.ok) return cache.put(key, r); }).catch(() => {}));
      return withIsolation(cached);
    }
    try {
      const r = await fetch(req);
      if (r.ok && url.pathname.startsWith(new URL('./', self.location).pathname)) cache.put(req, r.clone());
      return withIsolation(r);
    } catch (err) {
      const fallback = isNav ? await cache.match('index.html') : null;
      return fallback ? withIsolation(fallback) : new Response('Offline', { status: 503 });
    }
  })());
});
