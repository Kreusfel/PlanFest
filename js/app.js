// Routeur à fragments d'adresse (#/...), barre latérale et garde d'accès.
import { refreshSession, session, isActif, isAdmin, hasPole, signOut, onAuth, simPoles, isSimulating } from "./auth.js";
import { supa } from "./supabase.js";
import { store, setEdition } from "./store.js";
import { esc } from "./ui/util.js";
import * as connexion from "./ecrans/connexion.js";
import * as editions from "./ecrans/editions.js";
import * as planScreen from "./ecrans/plan.js";
import * as admin from "./ecrans/admin.js";
import * as organismes from "./ecrans/organismes.js";
import * as repartition from "./ecrans/repartition.js";
import * as jeux from "./ecrans/jeux.js";
import * as ludotheque from "./ecrans/ludotheque.js";
import * as benevoles from "./ecrans/benevoles.js";
import * as subventions from "./ecrans/subventions.js";
import * as dashboard from "./ecrans/dashboard.js";
import * as repas from "./ecrans/repas.js";
import * as communication from "./ecrans/communication.js";
import * as intergeneration from "./ecrans/intergeneration.js";
import * as competences from "./ecrans/competences.js";
import * as mesCompetences from "./ecrans/mes-competences.js";
import * as permanences from "./ecrans/permanences.js";
import * as monPlanning from "./ecrans/mon-planning.js";
import * as accueil from "./ecrans/accueil.js";
import * as presences from "./ecrans/presences.js";
import * as bilan from "./ecrans/bilan.js";
import * as inscriptions from "./ecrans/inscriptions.js";
import * as inscriptionPublic from "./public/inscription.js";
import * as programmePublic from "./public/programme.js";
import * as publicPlan from "./public/plan.js";
import * as publicExposants from "./public/exposants.js";
import { editionPubliee } from "./public/layout.js";

const app = document.getElementById("app");

const SCREENS = {
  "/": dashboard,
  "/plan": planScreen,
  "/organismes": organismes,
  "/repartition": repartition,
  "/jeux": jeux,
  "/ludotheque": ludotheque,
  "/permanences": permanences,
  "/mon-planning": monPlanning,
  "/mes-competences": mesCompetences,
  "/competences": competences,
  "/benevoles": benevoles,
  "/presences": presences,
  "/accueil": accueil,
  "/repas": repas,
  "/communication": communication,
  "/intergeneration": intergeneration,
  "/subventions": subventions,
  "/inscriptions": inscriptions,
  "/bilan": bilan,
  "/editions": editions,
  "/admin": admin,
};

// `poles` = pôles que l'écran sert (pour le groupe « Mon pôle » prioritaire).
// `can` = visibilité : les écrans opérationnels sont visibles en lecture par tout
// utilisateur actif (l'édition reste verrouillée en interne + RLS) ; seuls Présences
// (outil jour J) et les écrans Réglages/Bilan restent réservés.
const NAV = [
  { group: "Pilotage", path: "/", label: "Tableau de bord", can: () => true, poles: [] },
  { group: "Préparer", path: "/organismes", label: "Organismes", can: () => true, poles: ["partenaires", "jeux_editeurs", "sponsors", "communication"] },
  { group: "Préparer", path: "/ludotheque", label: "Ludothèque", can: () => true, poles: ["jeux_editeurs"] },
  { group: "Préparer", path: "/jeux", label: "Sélection Jeux", can: () => true, poles: ["jeux_editeurs"] },
  { group: "Préparer", path: "/benevoles", label: "Bénévoles", can: () => true, poles: ["animateurs_benevoles", "intergenerationnelle"] },
  { group: "Préparer", path: "/competences", label: "Compétences (équipe)", can: () => true, poles: ["animateurs_benevoles"] },
  { group: "Préparer", path: "/subventions", label: "Subventions", can: () => true, poles: ["sponsors"] },
  { group: "Préparer", path: "/inscriptions", label: "Inscriptions reçues", can: () => true, poles: ["partenaires", "animateurs_benevoles"] },
  { group: "Préparer", path: "/communication", label: "Communication", can: () => true, poles: ["communication"] },
  { group: "Préparer", path: "/intergeneration", label: "Intergénérationnel", can: () => true, poles: ["intergenerationnelle"] },
  { group: "Planifier", path: "/plan", label: "Plan des salles", can: () => true, poles: ["logistique_securite", "partenaires"] },
  { group: "Planifier", path: "/repartition", label: "Répartition tables", can: () => true, poles: ["partenaires"] },
  { group: "Planifier", path: "/permanences", label: "Animations", can: () => true, poles: ["animateurs_benevoles"] },
  { group: "Planifier", path: "/repas", label: "Buvette & catering", can: () => true, poles: ["buvette_catering"] },
  { group: "Jour J", path: "/accueil", label: "Accueil (entrées)", can: () => true, poles: [] },
  { group: "Jour J", path: "/presences", label: "Présences", can: () => isAdmin() || hasPole("animateurs_benevoles"), poles: ["animateurs_benevoles"] },
  { group: "Après", path: "/bilan", label: "Bilan", can: () => isAdmin(), poles: [] },
  { group: "Mon espace", path: "/mon-planning", label: "Mon planning", can: () => true, poles: [] },
  { group: "Mon espace", path: "/mes-competences", label: "Mes compétences", can: () => true, poles: [] },
  { group: "Réglages", path: "/editions", label: "Éditions", can: () => isAdmin(), poles: [] },
  { group: "Réglages", path: "/admin", label: "Administration", can: () => isAdmin(), poles: [] },
];

// Couleur et nom par pôle : pastilles de repérage dans la nav + légende.
const POLE_COLORS = {
  partenaires: "#2563EB", jeux_editeurs: "#7C3AED", animateurs_benevoles: "#16A34A",
  buvette_catering: "#EA580C", sponsors: "#0D9488", communication: "#DB2777",
  logistique_securite: "#CA8A04", intergenerationnelle: "#0EA5E9",
};
const POLE_NOMS = {
  partenaires: "Partenaires", jeux_editeurs: "Jeux & éditeurs", animateurs_benevoles: "Animateurs & bénévoles",
  buvette_catering: "Buvette & catering", sponsors: "Sponsors", communication: "Communication",
  logistique_securite: "Logistique & sécurité", intergenerationnelle: "Intergénérationnelle",
};
const poleDots = (n) => (n.poles || []).map((p) => `<i class="poledot" style="background:${POLE_COLORS[p] || "#ccc"}" title="${esc(POLE_NOMS[p] || p)}"></i>`).join("");
function poleLegend() {
  return `<details class="pole-legend"><summary>Légende des pôles</summary>
    <div class="pole-legend-grid">${Object.entries(POLE_NOMS).map(([code, nom]) => `<span><i class="poledot" style="background:${POLE_COLORS[code]}"></i>${esc(nom)}</span>`).join("")}</div></details>`;
}

// Construit la barre de navigation : si l'utilisateur est responsable d'un pôle
// (hors admin), ses écrans remontent dans un groupe « Mon pôle » ; le reste suit,
// visible mais atténué (secondaire).
function buildNav(path) {
  const items = NAV.filter((x) => x.can());
  const myPoles = isAdmin() ? [] : session.poles;
  const link = (n, cls) => `<a href="#${n.path}" class="navlink${cls}${n.path === path ? " on" : ""}"><span>${esc(n.label)}</span>${(n.poles || []).length ? `<span class="poledots">${poleDots(n)}</span>` : ""}</a>`;
  const shown = new Set();
  const take = (pred) => { const a = items.filter((n) => !shown.has(n.path) && pred(n)); a.forEach((n) => shown.add(n.path)); return a; };

  // Ordre prioritaire : Tableau de bord → Mon pôle → Mon espace (toujours actif) → le reste.
  const pilotage = take((n) => n.group === "Pilotage");
  const mine = myPoles.length ? take((n) => (n.poles || []).some((p) => myPoles.includes(p))) : [];
  const espace = take((n) => n.group === "Mon espace");
  const rest = items.filter((n) => !shown.has(n.path));

  let nav = pilotage.map((n) => link(n, "")).join("");
  if (mine.length) nav += `<div class="grp grp-pole">Mon pôle</div>` + mine.map((n) => link(n, "")).join("");
  if (espace.length) nav += `<div class="grp">Mon espace</div>` + espace.map((n) => link(n, "")).join("");
  const sec = myPoles.length ? " secondary" : "";
  if (rest.length) {
    nav += `<div class="nav-sep"></div>`;
    let lastGroup = null;
    for (const n of rest) {
      if (n.group !== lastGroup) { nav += `<div class="grp${sec}">${esc(n.group)}</div>`; lastGroup = n.group; }
      nav += link(n, sec);
    }
  }
  return nav;
}

function currentPath() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }

function render() {
  const path = currentPath();
  if (path.startsWith("/public")) { renderPublic(path); return; }
  if (!session.user) { app.innerHTML = ""; connexion.render(app); return; }
  if (!isActif()) { renderInactif(); return; }
  renderShell();
}

// Pages publiques (sans compte) : ne montent pas la barre latérale.
async function renderPublic(path) {
  const seg = path.split("/"); // ["", "public", "<quoi>", "<id>", ...]
  const quoi = seg[2] || "";
  app.innerHTML = "";
  if (!quoi) { // #/public → programme de l'édition publiée
    const ed = await editionPubliee();
    if (ed && ed.id) location.hash = `#/public/programme/${ed.id}`;
    else app.innerHTML = `<div class="public-wrap"><div class="public-body"><p>Aucun programme publié pour l'instant.</p></div></div>`;
    return;
  }
  if (quoi === "programme") programmePublic.render(app, seg[3] || "");
  else if (quoi === "plan") publicPlan.render(app, seg[3] || "");
  else if (quoi === "infos" || quoi === "exposants") publicExposants.render(app, seg[3] || "");
  else if (quoi === "inscription") inscriptionPublic.render(app, seg[3] || "", seg[4] || "");
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
  const nav = buildNav(path);
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand">PlanFest</div>
      <select class="ed" id="ed-select" aria-label="Édition en cours">${edOptions()}</select>
      <nav class="sidenav">${nav}</nav>
      <div class="side-foot">
        ${isSimulating() ? `<div class="sim-badge">🧪 Simulation pôle : <b>${esc(simPoles().join(", "))}</b> <button class="link" id="sim-off">quitter</button></div>` : ""}
        ${session.profil?.role === "admin" ? `<label class="view-as">Voir en tant que
          <select id="pole-view">
            <option value="">Admin — tout voir</option>
            ${Object.entries(POLE_NOMS).map(([code, nom]) => `<option value="${code}"${(simPoles() || []).includes(code) ? " selected" : ""}>${esc(nom)}</option>`).join("")}
          </select></label>` : ""}
        ${poleLegend()}
        <div class="who">${esc(session.user.email)}${isAdmin() ? " · admin" : (session.poles.length ? " · responsable" : "")}</div>
        <button class="btn ghost small" id="signout">Déconnexion</button>
      </div>
    </aside>
    <main class="main"><div id="view"></div></main>
  </div>`;
  document.getElementById("signout").onclick = () => signOut();
  const simOff = document.getElementById("sim-off");
  if (simOff) simOff.onclick = () => { localStorage.removeItem("pf_sim_pole"); location.reload(); };
  const pv = document.getElementById("pole-view");
  if (pv) pv.onchange = () => {
    if (pv.value) localStorage.setItem("pf_sim_pole", pv.value);
    else localStorage.removeItem("pf_sim_pole");
    location.reload();
  };
  const sel = document.getElementById("ed-select");
  if (sel) sel.onchange = () => { setEdition(sel.value); renderShell(); };
  SCREENS[path].render(document.getElementById("view"), sub);
  if (!editionsList.length) loadEditions();
}

// Liste des éditions pour le sélecteur de la barre latérale.
let editionsList = [];
function edOptions() {
  if (!editionsList.length) {
    return `<option>${esc(editionsList.find((e) => e.id === store.editionId)?.nom || "Édition…")}</option>`;
  }
  const opts = editionsList.map((e) => `<option value="${e.id}"${e.id === store.editionId ? " selected" : ""}>${esc(e.nom)}</option>`).join("");
  return store.editionId ? opts : `<option value="" selected disabled>Choisir une édition…</option>` + opts;
}
async function loadEditions() {
  const { data } = await supa.from("editions").select("id,nom").order("date_samedi", { ascending: false });
  editionsList = data || [];
  const sel = document.getElementById("ed-select");
  if (sel) sel.innerHTML = edOptions();
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
