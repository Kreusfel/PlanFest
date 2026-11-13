// Service worker PlanFest — l'application reste ouvrable sans réseau (jour J).
//
// Stratégie « réseau d'abord » pour les fichiers de l'app (même origine) :
//  - en ligne, on sert toujours la version fraîche (pas de code périmé après un push)
//    et on met la copie en cache au passage ;
//  - si le réseau ne répond pas en 4 s (wifi saturé) ou pas du tout, on sert le cache.
// Les données (Supabase, autre origine) ne sont JAMAIS mises en cache ici : les
// saisies hors-ligne passent par les files IndexedDB des écrans Accueil et Présences.
//
// Pas de liste de fichiers à maintenir : app.js importe tous les modules dès le
// démarrage, donc une ouverture en ligne suffit à tout mettre en cache.
// Changer VERSION seulement pour forcer le vidage complet des anciens caches.
const VERSION = "pf-v1";
const SHELL = ["./", "index.html", "css/app.css", "css/fonts.css", "config.js", "js/app.js", "icon.svg", "manifest.webmanifest"];
const DELAI_RESEAU_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // Supabase, BGG… : réseau direct
  event.respondWith(reseauDabord(req));
});

async function reseauDabord(req) {
  const cache = await caches.open(VERSION);
  const net = fetch(req, { cache: "no-store" }).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  const delai = new Promise((r) => setTimeout(() => r("delai"), DELAI_RESEAU_MS));
  const premier = await Promise.race([net.catch(() => "erreur"), delai]);
  if (premier instanceof Response) return premier;

  // Réseau en panne ou trop lent : la copie en cache si on l'a…
  const hit = await cache.match(req, { ignoreSearch: true })
    || (req.mode === "navigate" ? (await cache.match("index.html")) || (await cache.match("./")) : undefined);
  if (hit) return hit;
  // …sinon on continue d'attendre le réseau (lent mais pas forcément coupé).
  return net;
}
