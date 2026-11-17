// Routeur à fragments d'adresse (#/...), barre latérale et garde d'accès.
import { refreshSession, session, isActif, isAdmin, hasPole, signOut, onAuth, simPoles, isSimulating } from "./auth.js";
import { supa, lienEmail } from "./supabase.js";
import { store, setEdition } from "./store.js";
import { esc } from "./ui/util.js";
import * as connexion from "./ecrans/connexion.js";
import * as editions from "./ecrans/editions.js";
import * as planScreen from "./ecrans/plan.js";
import * as admin from "./ecrans/admin.js";
import * as organismes from "./ecrans/organismes.js";
import * as repartition from "./ecrans/repartition.js";
import * as jeux from "./ecrans/jeux.js";
import * as fournisseurs from "./ecrans/fournisseurs.js";
import * as benevoles from "./ecrans/benevoles.js";
import * as subventions from "./ecrans/subventions.js";
import * as dashboard from "./ecrans/dashboard.js";
import * as repas from "./ecrans/repas.js";
import * as communication from "./ecrans/communication.js";
import * as intergeneration from "./ecrans/intergeneration.js";
import * as competences from "./ecrans/competences.js";
import * as mesCompetences from "./ecrans/mes-competences.js";
import * as mesInfos from "./ecrans/mes-infos.js";
import * as permanences from "./ecrans/permanences.js";
import * as terrain from "./ecrans/terrain.js";
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
  "/fournisseurs": fournisseurs,
  // Ancienne adresse : la ludothèque est un onglet de « Jeux ».
  "/ludotheque": { render: (c) => jeux.render(c, "ludo"), unmount: jeux.unmount },
  "/permanences": permanences,
  "/terrain": terrain,
  // Ancienne adresse : « Mon planning » est désormais un onglet de « Sur le terrain ».
  "/mon-planning": { render: (c) => terrain.render(c, "moi"), unmount: terrain.unmount },
  "/mes-competences": mesCompetences,
  "/mes-infos": mesInfos,
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
// `can` = visibilité dans le menu : un écran n'apparaît que si la personne peut en voir
// les données (sinon il s'ouvrait vide, sans explication). Les droits réels restent en base.
const pour = (...poles) => () => isAdmin() || poles.some((p) => hasPole(p));
const tous = () => true;
const NAV = [
  { group: "Pilotage", path: "/", label: "Accueil", can: tous, poles: [] },
  { group: "Préparer", path: "/organismes", label: "Organismes", can: pour("partenaires", "jeux_editeurs", "sponsors", "communication", "logistique_securite"), poles: ["partenaires", "jeux_editeurs", "sponsors", "communication"] },
  { group: "Jeux et fournisseurs", path: "/jeux", label: "Jeux", can: tous, poles: ["jeux_editeurs", "intergenerationnelle"] },
  { group: "Jeux et fournisseurs", path: "/jeux/obtenir", label: "À obtenir", can: tous, poles: ["jeux_editeurs"] },
  { group: "Jeux et fournisseurs", path: "/fournisseurs", label: "Fournisseurs", can: tous, poles: ["jeux_editeurs"] },
  { group: "Préparer", path: "/benevoles", label: "Bénévoles", can: pour("animateurs_benevoles"), poles: ["animateurs_benevoles"] },
  { group: "Préparer", path: "/competences", label: "Compétences (équipe)", can: pour("animateurs_benevoles"), poles: ["animateurs_benevoles"] },
  { group: "Préparer", path: "/subventions", label: "Subventions", can: pour("sponsors"), poles: ["sponsors"] },
  { group: "Préparer", path: "/inscriptions", label: "Inscriptions reçues", can: pour("partenaires", "animateurs_benevoles"), poles: ["partenaires", "animateurs_benevoles"] },
  { group: "Préparer", path: "/communication", label: "Communication", can: pour("communication"), poles: ["communication"] },
  { group: "Préparer", path: "/intergeneration", label: "Intergénérationnel", can: pour("intergenerationnelle"), poles: ["intergenerationnelle"] },
  { group: "Planifier", path: "/plan", label: "Plan des salles", can: tous, poles: ["logistique_securite", "partenaires"] },
  { group: "Planifier", path: "/repartition", label: "Répartition tables", can: pour("partenaires", "logistique_securite"), poles: ["partenaires"] },
  { group: "Planifier", path: "/permanences", label: "Animations", can: tous, poles: ["animateurs_benevoles"] },
  { group: "Planifier", path: "/repas", label: "Buvette & catering", can: pour("buvette_catering"), poles: ["buvette_catering"] },
  { group: "Jour J", path: "/terrain", label: "Sur le terrain", can: tous, poles: [] },
  { group: "Jour J", path: "/accueil", label: "Accueil (entrées)", can: tous, poles: [] },
  { group: "Jour J", path: "/presences", label: "Présences", can: pour("animateurs_benevoles"), poles: ["animateurs_benevoles"] },
  { group: "Après", path: "/bilan", label: "Bilan", can: () => isAdmin() || session.poles.length > 0, poles: [] },
  { group: "Mon espace", path: "/terrain/moi", label: "Mon planning", can: tous, poles: [] },
  { group: "Mon espace", path: "/mes-infos", label: "Mes infos", can: tous, poles: [] },
  { group: "Mon espace", path: "/mes-competences", label: "Mes compétences", can: tous, poles: [] },
  { group: "Réglages", path: "/editions", label: "Éditions", can: () => isAdmin(), poles: [] },
  { group: "Réglages", path: "/admin", label: "Administration", can: () => isAdmin(), poles: [] },
];

// Nom par pôle (sélecteur « Voir en tant que » des admins).
const POLE_NOMS = {
  partenaires: "Partenaires", jeux_editeurs: "Jeux & éditeurs", animateurs_benevoles: "Animateurs & bénévoles",
  buvette_catering: "Buvette & catering", sponsors: "Sponsors", communication: "Communication",
  logistique_securite: "Logistique & sécurité", intergenerationnelle: "Intergénérationnelle",
};
// Construit la barre de navigation recentrée sur « Jeux et fournisseurs » :
//  - Tableau de bord, puis le groupe primaire Jeux / À obtenir / Fournisseurs ;
//  - tout le reste du festival (bénévoles, buvette, plan…) est regroupé et REPLIÉ sous
//    « Reste du festival » (déplié automatiquement quand on est sur une de ces pages).
// `full` = chemin complet (ex. /jeux/obtenir) pour l'état actif ; `base` = route de l'écran.
function buildNav(full, base) {
  const items = NAV.filter((x) => x.can());
  // Actif = l'item au chemin le plus précis qui correspond ; sinon on retombe sur la base.
  const activePath = items.some((n) => n.path === full) ? full : base;
  const link = (n) => `<a href="#${n.path}" class="navlink${n.path === activePath ? " on" : ""}"><span>${esc(n.label)}</span></a>`;

  const PRIMAIRE = ["Pilotage", "Jeux et fournisseurs"];
  const pilotage = items.filter((n) => n.group === "Pilotage");
  const coeur = items.filter((n) => n.group === "Jeux et fournisseurs");
  const reste = items.filter((n) => !PRIMAIRE.includes(n.group));

  let nav = pilotage.map(link).join("");
  if (coeur.length) nav += `<div class="grp">Jeux et fournisseurs</div>` + coeur.map(link).join("");

  if (reste.length) {
    const ouvert = reste.some((n) => n.path === activePath) ? " open" : "";
    let body = "", lastGroup = null;
    for (const n of reste) {
      if (n.group !== lastGroup) { body += `<div class="grp secondary">${esc(n.group)}</div>`; lastGroup = n.group; }
      body += link(n);
    }
    nav += `<details class="nav-reste"${ouvert}><summary>Reste du festival</summary>
      <div class="nav-reste-body">${body}</div></details>`;
  }
  return nav;
}

function currentPath() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }

// Écran affiché : son unmount() éventuel est appelé avant d'en afficher un autre
// (retire écouteurs globaux, temps réel… — ex. le plan et ses raccourcis clavier).
let currentScreen = null;
function leaveScreen() {
  try { currentScreen?.unmount?.(); } catch (e) { console.error(e); }
  currentScreen = null;
}

let choixMotDePasse = lienEmail.type === "invite" || lienEmail.type === "recovery";

function render() {
  const path = currentPath();
  if (path.startsWith("/public")) { leaveScreen(); renderPublic(path); return; }
  if (!session.user || choixMotDePasse || !isActif()) leaveScreen();
  if (!session.user) { app.innerHTML = ""; connexion.render(app, lienEmail.erreur); lienEmail.erreur = null; return; }
  // Arrivée par un lien d'invitation ou « mot de passe oublié » : choisir son mot de passe.
  if (choixMotDePasse) {
    connexion.renderMotDePasse(app, lienEmail.type === "invite", () => { choixMotDePasse = false; render(); });
    return;
  }
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
  const nav = buildNav(full, path);
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-text"><b>PlanFest</b><small>La Jurande des Conte-Brumes</small></span></div>
      <select class="ed" id="ed-select" aria-label="Édition en cours">${edOptions()}</select>
      <button class="btn small menu-btn" id="menu-btn" aria-expanded="false" aria-controls="sidenav">Menu</button>
      <nav class="sidenav" id="sidenav">${nav}</nav>
      <div class="side-foot">
        ${isSimulating() ? `<div class="sim-badge">🧪 Simulation pôle : <b>${esc(simPoles().join(", "))}</b> <button class="link" id="sim-off">quitter</button></div>` : ""}
        ${session.profil?.role === "admin" ? `<label class="view-as">Voir en tant que
          <select id="pole-view">
            <option value="">Admin — tout voir</option>
            ${Object.entries(POLE_NOMS).map(([code, nom]) => `<option value="${code}"${(simPoles() || []).includes(code) ? " selected" : ""}>${esc(nom)}</option>`).join("")}
          </select></label>` : ""}
        <div class="who">${esc(session.user.email)}${isAdmin() ? " · admin" : (session.poles.length ? " · responsable" : "")}</div>
        <button class="btn ghost small" id="signout">Déconnexion</button>
      </div>
    </aside>
    <main class="main"><div id="view"></div></main>
  </div>`;
  document.getElementById("signout").onclick = () => signOut();
  // Téléphone : déplier / replier la navigation (un clic sur un lien re-rend tout, donc replie).
  const menuBtn = document.getElementById("menu-btn");
  menuBtn.onclick = () => {
    const open = document.querySelector(".sidebar").classList.toggle("open");
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.textContent = open ? "Fermer" : "Menu";
  };
  const simOff = document.getElementById("sim-off");
  if (simOff) simOff.onclick = () => { localStorage.removeItem("pf_sim_pole"); location.reload(); };
  const pv = document.getElementById("pole-view");
  if (pv) pv.onchange = () => {
    if (pv.value) localStorage.setItem("pf_sim_pole", pv.value);
    else localStorage.removeItem("pf_sim_pole");
    location.reload();
  };
  const sel = document.getElementById("ed-select");
  // Changer d'édition recharge la page : un chargement encore en cours sur l'ancienne
  // édition ne peut plus afficher (ni faire enregistrer) ses données sous la nouvelle.
  // Le plan envoie ses modifs en attente avant (unmount + beforeunload).
  if (sel) sel.onchange = () => { setEdition(sel.value); leaveScreen(); location.reload(); };
  leaveScreen();
  currentScreen = SCREENS[path];
  currentScreen.render(document.getElementById("view"), sub);
  loadEditions();  // à chaque écran : une édition créée ou renommée apparaît sans recharger
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
  // Sur téléphone, l'ouverture de l'app mène à « Sur le terrain » (consultation) plutôt
  // qu'au tableau de bord, qui reste accessible par le menu.
  if (/^#?\/?$/.test(location.hash) && window.matchMedia("(max-width: 760px)").matches) {
    history.replaceState(null, "", location.pathname + location.search + "#/terrain");
  }
  await refreshSession();
  // Retirer les jetons ou l'erreur du lien e-mail de la barre d'adresse.
  if (lienEmail.type || lienEmail.erreur) history.replaceState(null, "", location.pathname + location.search);
  render();
  // Ne ré-afficher que si l'utilisateur change (connexion, déconnexion, autre compte).
  // Le renouvellement du jeton (~ toutes les heures) ne doit pas refaire l'écran :
  // ça effaçait la saisie en cours et l'historique d'annulation du plan.
  onAuth(async (event) => {
    if (event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") return;
    const avant = session.user?.id ?? null;
    await refreshSession();
    if ((session.user?.id ?? null) !== avant || event === "SIGNED_OUT") render();
  });
  window.addEventListener("hashchange", () => {
    const path = currentPath();
    if (path.startsWith("/public")) renderPublic(path);
    else if (session.user && isActif() && !choixMotDePasse) renderShell();
    else render();
  });
}
boot();

// Service worker : garde l'application ouvrable sans réseau le jour J (voir sw.js,
// stratégie « réseau d'abord » : en ligne on a toujours la dernière version).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
}
