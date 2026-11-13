// Écran #/terrain — consultation sur téléphone, en lecture seule (jour J).
// Onglets : Mon planning (mes parties + mes permanences) · Programme · Plan.
// Toutes les données viennent d'un seul appel (RPC terrain, migration 034), gardé sur
// l'appareil : l'écran reste consultable sans réseau, avec l'heure de la dernière mise à jour.
// Sous-adresses : #/terrain/moi · #/terrain/programme · #/terrain/plan[/<id élément>]
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc, aujourdhui, refocus } from "../ui/util.js";
import { salleSVG } from "../plan/svg-lecture.js";

const JOUR_LBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const ONGLETS = [["moi", "Mon planning"], ["programme", "Programme"], ["plan", "Plan"]];

let root, data = null, majLe = null, horsLigne = false;
let onglet = "moi", jour = "sam", salleIdx = 0, surligne = null, q = "", aVenir = true, minuteur = null;

const cacheKey = () => "pf_terrain_" + store.editionId;
const hm = (t) => (t || "").slice(0, 5);
const minutes = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };

export async function render(container, sub = "") {
  root = container;
  clearInterval(minuteur);
  if (!store.editionId) {
    root.innerHTML = `<div class="terrain"><div class="card"><p>Aucune édition choisie.</p>
      <a class="btn primary" href="#/editions">Choisir une édition</a></div></div>`;
    return;
  }
  const [o, el] = (sub || "").split("/");
  onglet = ONGLETS.some(([k]) => k === o) ? o : "";
  surligne = onglet === "plan" && el ? el : null;

  // Affichage immédiat depuis la copie locale, puis mise à jour réseau.
  lireCache();
  if (data) { initVue(); draw(); }
  else root.innerHTML = `<div class="terrain"><div class="card"><p class="muted">Chargement…</p></div></div>`;
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onInput);
  root.addEventListener("submit", onSubmit);
  await charger();
  minuteur = setInterval(() => { if (root?.isConnected) draw(); }, 60000);  // « en cours » suit l'heure
}

export function unmount() { clearInterval(minuteur); minuteur = null; }

function lireCache() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()));
    if (c?.data) { data = c.data; majLe = c.at; }
    else { data = null; majLe = null; }
  } catch { data = null; majLe = null; }
}

async function charger() {
  const { data: d, error } = await supa.rpc("terrain", { p_edition: store.editionId });
  if (!root?.isConnected) return;
  if (error || !d) {
    horsLigne = true;
    if (!data) {
      root.innerHTML = `<div class="terrain"><div class="card"><p class="msg">Impossible de charger les données${error ? " : " + esc(error.message) : ""}.</p>
        <button class="btn" data-t="refresh">Réessayer</button></div></div>`;
      return;
    }
  } else {
    const premier = !data;
    data = d; majLe = Date.now(); horsLigne = false;
    try { localStorage.setItem(cacheKey(), JSON.stringify({ at: majLe, data })); } catch { /* stockage plein */ }
    if (premier) initVue();
  }
  draw();
}

// Onglet et jour par défaut, une fois les données connues.
function initVue() {
  if (!onglet) onglet = data.moi ? "moi" : "programme";
  const jours = joursActifs();
  const j = jourDuFestival();
  if (j && jours.includes(j)) jour = j;
  else if (!jours.includes(jour)) jour = jours[0];
  if (surligne) allerA(surligne);
}

function joursActifs() {
  const j = data?.edition?.jours_actifs;
  return j?.length ? j : ["sam", "dim"];
}

// Code du jour si on est pendant le festival (vendredi = veille du samedi), sinon null.
function jourDuFestival() {
  const sam = data?.edition?.date_samedi; if (!sam) return null;
  const decale = (n) => {
    const d = new Date(sam + "T12:00:00"); d.setDate(d.getDate() + n);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const auj = aujourdhui();
  return { [decale(-1)]: "ven", [decale(0)]: "sam", [decale(1)]: "dim" }[auj] || null;
}
// Minutes écoulées aujourd'hui si le jour affiché est aujourd'hui, sinon null.
function maintenant() {
  if (jourDuFestival() !== jour) return null;
  const d = new Date(); return d.getHours() * 60 + d.getMinutes();
}

const elements = () => new Map((data.elements || []).map((e) => [e.id, e]));
function ou(elementId, els = elements()) {
  const e = els.get(elementId); if (!e) return "";
  const salle = (data.salles || []).find((s) => s.id === e.salle_id)?.nom || "";
  const quoi = e.kind === "table" ? (e.numero ? `table n°${e.numero}` : "table") : (e.label || e.sous || "repère");
  return [salle, quoi].filter(Boolean).join(" · ");
}
function allerA(elementId) {
  const e = elements().get(elementId); if (!e) return;
  const i = (data.salles || []).findIndex((s) => s.id === e.salle_id);
  if (i >= 0) salleIdx = i;
  surligne = elementId; onglet = "plan";
}

/* ---------- rendu ---------- */
function draw() {
  if (!data || !root?.isConnected) return;
  history.replaceState(null, "", "#/terrain/" + onglet + (onglet === "plan" && surligne ? "/" + surligne : ""));
  const jours = joursActifs();
  const date = majLe ? new Date(majLe) : null;
  const bandeau = horsLigne && date
    ? `<p class="sync-warn">Hors ligne — données du ${date.toLocaleDateString("fr-FR")} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.</p>` : "";
  const pills = jours.length > 1
    ? `<div class="salle-tabs t-jours">${jours.map((j) => `<button class="pill-btn${j === jour ? " on" : ""}" data-jour="${j}">${esc(JOUR_LBL[j] || j)}</button>`).join("")}</div>` : "";
  const corps = onglet === "plan" ? vuePlan() : onglet === "programme" ? vueProgramme() : vueMoi();
  root.innerHTML = `<div class="terrain">
    <div class="t-head"><div><h1>${esc(ONGLETS.find(([k]) => k === onglet)?.[1] || "")}</h1>
      <div class="sub">${esc(data.edition?.nom || "")}</div></div>
      <button class="btn small" data-t="refresh" aria-label="Actualiser les données">Actualiser</button></div>
    ${bandeau}${pills}${corps}
    <nav class="t-tabs" aria-label="Sections">${ONGLETS.map(([k, l]) =>
      `<button data-onglet="${k}"${k === onglet ? ' class="on" aria-current="page"' : ""}>${esc(l)}</button>`).join("")}</nav>
  </div>`;
}

// Carte d'un créneau (partie ou permanence).
function carte({ debut, fin, quoi, detail, elementId, etat }) {
  const badge = etat === "now" ? `<span class="tag ok">En cours</span>` : etat === "next" ? `<span class="tag warn">Ensuite</span>` : "";
  return `<div class="t-card${etat === "now" ? " now" : ""}">
    <div class="t-time">${esc(hm(debut))}–${esc(hm(fin))} ${badge}</div>
    <div class="t-what">${esc(quoi)}</div>
    ${detail ? `<div class="t-where">${detail}</div>` : ""}
    ${elementId ? `<button class="btn small" data-goto="${esc(elementId)}">Voir sur le plan</button>` : ""}
  </div>`;
}
// Marque « en cours » et le premier « ensuite » d'une liste triée par heure.
function etats(items, now) {
  if (now == null) return items.map(() => "");
  let next = false;
  return items.map((it) => {
    if (minutes(it.debut) <= now && now < minutes(it.fin)) return "now";
    if (!next && minutes(it.debut) > now) { next = true; return "next"; }
    return "";
  });
}

function vueMoi() {
  if (!data.moi) {
    return `<div class="card"><p>Ton compte n'est pas relié à une fiche bénévole inscrite sur cette édition.
      Demande à un responsable bénévoles de t'inscrire.</p>
      <button class="btn" data-onglet="programme">Voir le programme</button></div>`;
  }
  const els = elements();
  const items = [
    ...(data.parties || []).filter((p) => p.benevole_edition_id === data.moi && p.jour === jour)
      .map((p) => ({ ...p, quoi: p.jeu || p.titre || "Animation", detail: esc(ou(p.element_id, els)) + (p.places ? ` · ${p.inscrits}/${p.places} inscrits` : "") })),
    ...(data.permanences || []).filter((p) => p.benevole_edition_id === data.moi && p.jour === jour)
      .map((p) => ({ ...p, quoi: p.poste, detail: esc(ou(p.element_id, els)) })),
  ].sort((a, b) => minutes(a.debut) - minutes(b.debut));
  if (!items.length) return `<div class="card"><p class="muted">Rien de prévu pour toi ce ${esc((JOUR_LBL[jour] || jour).toLowerCase())}.</p></div>`;
  const et = etats(items, maintenant());
  return `<div class="t-list">${items.map((it, i) => carte({ debut: it.debut, fin: it.fin, quoi: it.quoi, detail: it.detail, elementId: it.element_id, etat: et[i] })).join("")}</div>`;
}

function vueProgramme() {
  const els = elements(), now = maintenant();
  const needle = q.trim().toLowerCase();
  let ps = (data.parties || []).filter((p) => p.jour === jour);
  if (now != null && aVenir) ps = ps.filter((p) => minutes(p.fin) > now);
  if (needle) ps = ps.filter((p) => [p.jeu, p.titre, p.animateur, ou(p.element_id, els)].some((v) => (v || "").toLowerCase().includes(needle)));
  ps.sort((a, b) => minutes(a.debut) - minutes(b.debut));
  const outils = `<div class="t-outils">
    <input id="t-q" type="search" placeholder="Jeu, table, animateur…" value="${esc(q)}" aria-label="Rechercher dans le programme">
    ${now != null ? `<label class="chk-inline"><input type="checkbox" id="t-avenir"${aVenir ? " checked" : ""}> En cours et à venir</label>` : ""}
  </div>`;
  if (!ps.length) return outils + `<div class="card"><p class="muted">Aucune partie${needle ? " pour cette recherche" : ""}.</p></div>`;
  const groupes = new Map();
  ps.forEach((p) => { const k = hm(p.debut); if (!groupes.has(k)) groupes.set(k, []); groupes.get(k).push(p); });
  return outils + [...groupes].map(([h, liste]) => `<h2 class="t-heure">${esc(h)}</h2><div class="t-list">${liste.map((p) => {
    const complet = p.places != null && p.inscrits >= p.places;
    const encours = now != null && minutes(p.debut) <= now && now < minutes(p.fin);
    const detail = esc(ou(p.element_id, els))
      + (p.animateur ? ` · ${esc(p.animateur)}` : "")
      + (p.places != null ? ` · <span class="${complet ? "t-complet" : ""}">${p.inscrits}/${p.places}${complet ? " complet" : ""}</span>` : "");
    return carte({ debut: p.debut, fin: p.fin, quoi: p.jeu || p.titre || "Animation", detail, elementId: p.element_id, etat: encours ? "now" : "" });
  }).join("")}</div>`).join("");
}

function vuePlan() {
  const salles = data.salles || [];
  if (!salles.length) return `<div class="card"><p class="muted">Aucune salle sur le plan.</p></div>`;
  if (salleIdx >= salles.length) salleIdx = 0;
  const salle = salles[salleIdx];
  const els = (data.elements || []).filter((e) => e.salle_id === salle.id);
  const tabs = salles.length > 1
    ? `<div class="salle-tabs">${salles.map((s, i) => `<button class="pill-btn${i === salleIdx ? " on" : ""}" data-salle="${i}">${esc(s.nom)}</button>`).join("")}</div>` : "";
  const recherche = `<form class="t-outils" id="t-table">
    <input id="t-num" inputmode="numeric" placeholder="Table n°" aria-label="Numéro de table">
    <button class="btn" type="submit">Trouver</button></form>`;
  return `${recherche}${tabs}<div class="card t-plan">${salleSVG(salle, els, { surligner: surligne, touchable: true })}</div>
    <p class="mini">Touche une table pour voir ce qui s'y passe. Pince pour zoomer.</p>${detailElement()}`;
}

// Panneau sous le plan : ce qui se passe sur l'élément surligné, le jour affiché.
function detailElement() {
  if (!surligne) return "";
  const e = elements().get(surligne); if (!e) return "";
  const titre = e.kind === "table" ? `Table n°${e.numero ?? "?"}` : (e.label || e.sous || "Repère");
  const type = e.kind !== "table" ? "" : e.type_table === "partenaire" ? (e.nom || "Partenaire")
    : e.type_table === "jurande" ? (e.mode === "libre" ? "Jurande · jeu libre" : "Jurande · animée") : "À attribuer";
  const ps = (data.parties || []).filter((p) => p.element_id === e.id && p.jour === jour).sort((a, b) => minutes(a.debut) - minutes(b.debut));
  const pm = (data.permanences || []).filter((p) => p.element_id === e.id && p.jour === jour).sort((a, b) => minutes(a.debut) - minutes(b.debut));
  const lignes = [
    ...ps.map((p) => `<li><b>${esc(hm(p.debut))}–${esc(hm(p.fin))}</b> ${esc(p.jeu || p.titre || "Animation")}${p.animateur ? ` · ${esc(p.animateur)}` : ""}${p.places != null ? ` · ${p.inscrits}/${p.places}` : ""}</li>`),
    ...pm.map((p) => `<li><b>${esc(hm(p.debut))}–${esc(hm(p.fin))}</b> ${esc(p.poste)}${p.benevole ? ` · ${esc(p.benevole)}` : ""}</li>`),
  ];
  return `<div class="card t-detail"><div class="ihead"><h3>${esc(titre)}</h3>
      <button class="btn small ghost" data-t="fermer" aria-label="Fermer le détail">×</button></div>
    ${type ? `<p class="muted">${esc(type)}</p>` : ""}
    ${lignes.length ? `<ul class="t-ul">${lignes.join("")}</ul>` : `<p class="muted">Rien de programmé ce ${esc((JOUR_LBL[jour] || jour).toLowerCase())}.</p>`}</div>`;
}

/* ---------- interactions ---------- */
function onClick(ev) {
  const t = ev.target;
  const b = t.closest("[data-onglet],[data-jour],[data-salle],[data-goto],[data-t],[data-el]");
  if (!b) return;
  if (b.dataset.onglet) { onglet = b.dataset.onglet; if (onglet !== "plan") surligne = null; window.scrollTo(0, 0); return draw(); }
  if (b.dataset.jour) { jour = b.dataset.jour; return draw(); }
  if (b.dataset.salle) { salleIdx = +b.dataset.salle; surligne = null; return draw(); }
  if (b.dataset.goto) { allerA(b.dataset.goto); window.scrollTo(0, 0); return draw(); }
  if (b.dataset.el) { surligne = b.dataset.el; draw(); root.querySelector(".t-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }); return; }
  if (b.dataset.t === "fermer") { surligne = null; return draw(); }
  if (b.dataset.t === "refresh") { charger(); }
}

function onInput(ev) {
  const t = ev.target;
  if (t.id === "t-q" && ev.type === "input") { q = t.value; const pos = t.selectionStart; draw(); refocus(root, "#t-q", pos); }
  if (t.id === "t-avenir" && ev.type === "change") { aVenir = t.checked; draw(); }
}

// Recherche « Table n° » (formulaire : Entrée ou bouton).
function onSubmit(ev) {
  if (ev.target?.id !== "t-table") return;
  ev.preventDefault();
  const n = (ev.target.querySelector("#t-num")?.value || "").trim().toLowerCase();
  if (!n || !data) return;
  const e = (data.elements || []).find((x) => x.kind === "table" && String(x.numero ?? "").toLowerCase() === n);
  if (!e) { const inp = ev.target.querySelector("#t-num"); if (inp) { inp.value = ""; inp.placeholder = `Pas de table n°${n}`; } return; }
  allerA(e.id); draw();
}
