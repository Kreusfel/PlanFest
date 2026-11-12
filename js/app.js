// Routeur à fragments d'adresse (#/...), barre latérale et garde d'accès.
import { refreshSession, session, isActif, isAdmin, hasPole, signOut, onAuth } from "./auth.js";
import { supa } from "./supabase.js";
import { store } from "./store.js";
import { esc } from "./ui/util.js";
import * as connexion from "./ecrans/connexion.js";
import * as editions from "./ecrans/editions.js";
import * as planScreen from "./ecrans/plan.js";
import * as admin from "./ecrans/admin.js";
import * as organismes from "./ecrans/organismes.js";
import * as jeux from "./ecrans/jeux.js";
import * as benevoles from "./ecrans/benevoles.js";
import * as subventions from "./ecrans/subventions.js";
import * as dashboard from "./ecrans/dashboard.js";
import * as repas from "./ecrans/repas.js";
import * as competences from "./ecrans/competences.js";
import * as animation from "./ecrans/animation.js";
import * as monPlanning from "./ecrans/mon-planning.js";
import * as accueil from "./ecrans/accueil.js";
import * as presences from "./ecrans/presences.js";
import * as bilan from "./ecrans/bilan.js";
import * as inscriptions from "./ecrans/inscriptions.js";
import * as inscriptionPublic from "./public/inscription.js";
import * as programmePublic from "./public/programme.js";

const app = document.getElementById("app");

const SCREENS = {
  "/": dashboard,
  "/plan": planScreen,
  "/organismes": organismes,
  "/jeux": jeux,
  "/planning-animation": animation,
  "/mon-planning": monPlanning,
  "/competences": competences,
  "/benevoles": benevoles,
  "/presences": presences,
  "/accueil": accueil,
  "/repas": repas,
  "/subventions": subventions,
  "/inscriptions": inscriptions,
  "/bilan": bilan,
  "/editions": editions,
  "/admin": admin,
};

const NAV = [
  { group: "Pilotage", path: "/", label: "Tableau de bord", can: () => true },
  { group: "Préparer", path: "/organismes", label: "Organismes", can: () => isAdmin() || hasPole("partenaires") || hasPole("jeux_editeurs") || hasPole("sponsors") },
  { group: "Préparer", path: "/jeux", label: "Jeux", can: () => true },
  { group: "Préparer", path: "/benevoles", label: "Bénévoles", can: () => isAdmin() || hasPole("animateurs_benevoles") },
  { group: "Préparer", path: "/subventions", label: "Subventions", can: () => isAdmin() || hasPole("sponsors") },
  { group: "Préparer", path: "/inscriptions", label: "Inscriptions reçues", can: () => isAdmin() || hasPole("partenaires") || hasPole("animateurs_benevoles") },
  { group: "Planifier", path: "/plan", label: "Plan des salles", can: () => true },
  { group: "Planifier", path: "/planning-animation", label: "Planning d'animation", can: () => true },
  { group: "Planifier", path: "/repas", label: "Repas", can: () => isAdmin() || hasPole("buvette_catering") },
  { group: "Jour J", path: "/accueil", label: "Accueil (entrées)", can: () => true },
  { group: "Jour J", path: "/presences", label: "Présences", can: () => isAdmin() || hasPole("animateurs_benevoles") },
  { group: "Après", path: "/bilan", label: "Bilan", can: () => isAdmin() },
  { group: "Mon espace", path: "/mon-planning", label: "Mon planning", can: () => true },
  { group: "Mon espace", path: "/competences", label: "Compétences", can: () => true },
  { group: "Réglages", path: "/editions", label: "Éditions", can: () => isAdmin() },
  { group: "Réglages", path: "/admin", label: "Administration", can: () => isAdmin() },
];

function currentPath() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }

function render() {
  const path = currentPath();
  if (path.startsWith("/public")) { renderPublic(path); return; }
  if (!session.user) { app.innerHTML = ""; connexion.render(app); return; }
  if (!isActif()) { renderInactif(); return; }
  renderShell();
}

// Pages publiques (sans compte) : ne montent pas la barre latérale.
function renderPublic(path) {
  const seg = path.split("/"); // ["", "public", "<quoi>", ...]
  app.innerHTML = "";
  if (seg[2] === "programme") programmePublic.render(app, seg[3] || "");
  else if (seg[2] === "inscription") inscriptionPublic.render(app, seg[3] || "", seg[4] || "");
  else app.innerHTML = `<div class="public-wrap"><div class="public-body"><p>Page publique inconnue.</p></div></div>`;
}

function renderInactif() {
  app.innerHTML = `<div class="centerbox"><div class="card auth">
    <h1>Compte en attente</h1>
    <p>Ton compte <b>${esc(session.user.email)}</b> n'est pas encore activé.
       Un administrateur doit t'inviter avant d'accéder à PlanFest.</p>
    <button class="btn primary" id="out">Se déconnecter</button>
  </div></div>`;
  document.getElementById("out").onclick = () => signOut();
}

function renderShell() {
  const full = currentPath();                       // ex. "/organismes/partenaires"
  const base = SCREENS[full] ? full : "/" + full.split("/")[1];
  const path = SCREENS[base] ? base : "/";
  const sub = full.startsWith(path) ? full.slice(path.length).replace(/^\//, "") : "";
  let nav = "", lastGroup = null;
  for (const n of NAV.filter((x) => x.can())) {
    if (n.group !== lastGroup) { nav += `<div class="grp">${esc(n.group)}</div>`; lastGroup = n.group; }
    nav += `<a href="#${n.path}" class="navlink${n.path === path ? " on" : ""}">${esc(n.label)}</a>`;
  }
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand">PlanFest</div>
      <a class="ed" href="#/editions"><span id="ed-label">${esc(edName || "Choisir une édition")}</span><span class="muted">▾</span></a>
      <nav class="sidenav">${nav}</nav>
      <div class="side-foot">
        <div class="who">${esc(session.user.email)}${isAdmin() ? " · admin" : ""}</div>
        <button class="btn ghost small" id="signout">Déconnexion</button>
      </div>
    </aside>
    <main class="main"><div id="view"></div></main>
  </div>`;
  document.getElementById("signout").onclick = () => signOut();
  SCREENS[path].render(document.getElementById("view"), sub);
  refreshEdLabel();
}

let edName = "";
async function refreshEdLabel() {
  if (!store.editionId) { edName = ""; const el = document.getElementById("ed-label"); if (el) el.textContent = "Choisir une édition"; return; }
  const { data } = await supa.from("editions").select("nom").eq("id", store.editionId).maybeSingle();
  edName = data?.nom || "Édition";
  const el = document.getElementById("ed-label"); if (el) el.textContent = edName;
}

async function boot() {
  await refreshSession();
  render();
  onAuth(async () => { await refreshSession(); render(); });
  window.addEventListener("hashchange", () => {
    const path = currentPath();
    if (path.startsWith("/public")) renderPublic(path);
    else if (session.user && isActif()) renderShell();
    else render();
  });
}
boot();

// Service worker DÉSACTIVÉ pendant le développement (évitait de servir du code périmé).
// On désenregistre tout SW déjà présent et on vide ses caches. À réactiver (register)
// avant le jour J pour le mode hors-ligne (le fichier sw.js reste prêt dans le dépôt).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
}
