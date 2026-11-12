// Service worker NEUTRALISÉ (développement).
// Ancienne version mettait l'app en cache et servait du code périmé (page blanche quand
// un fichier changeait, ex. util.js sans le nouvel export). Cette version ne met plus rien
// en cache : dès que le navigateur la récupère, elle vide les caches, se désinstalle et
// recharge les onglets ouverts. Plus aucune manipulation DevTools nécessaire.
// (À réécrire en vrai SW hors-ligne avant le jour J.)
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url));
    } catch (_) { /* ignore */ }
  })());
});
// Pas de handler "fetch" : toutes les requêtes passent directement au réseau.
