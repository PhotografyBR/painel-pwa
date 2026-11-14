/* Rede primeiro, cache so quando nao ha conexao. So a casca (codigo, sem nenhum
   dado). O cofre vem do GitHub, de outra origem, e a copia offline dele e guardada
   pelo app.js, cifrada. */
const VERSAO = "13d54eb6ed86";
const CACHE = "fr-" + VERSAO;
const ESSENCIAIS = ["./", "index.html", "app.js", "cofre.js", "app.tpl.html",
  "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ESSENCIAIS.map(u =>
      fetch(u, { cache: "reload" }).then(r => r.ok && c.put(u, r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", ev => {
  const req = ev.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  ev.respondWith((async () => {
    try {
      const r = await fetch(req, { cache: "no-cache" });
      if (r.ok) { (await caches.open(CACHE)).put(req, r.clone()); return r; }
      const guardado = await caches.match(req, { ignoreSearch: true });
      return guardado || r;
    } catch (e) {
      const guardado = await caches.match(req, { ignoreSearch: true });
      if (guardado) return guardado;
      if (req.mode === "navigate") {
        const i = await caches.match("index.html");
        if (i) return i;
      }
      return new Response("sem conexão", { status: 503 });
    }
  })());
});
