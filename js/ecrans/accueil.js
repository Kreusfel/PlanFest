// Écran #/accueil — jour J. Deux sous-onglets indépendants :
//  - Entrées : comptage par groupe/famille (provenance ville/CP) via un panier
//    de tranches d'âge (+ / −) puis « Valider ». Résilient hors-ligne (IndexedDB).
//  - Inscriptions : inscrire des visiteurs aux parties, à tout moment, décorrélé
//    des entrées.
import { supa } from "../supabase.js";
import { session } from "../auth.js";
import { store } from "../store.js";
import { esc, toast } from "../ui/util.js";
import { qAdd, qAll, qDel } from "../offline/idb.js";

const TRANCHES = [["3+", "3 ans +"], ["6+", "6 ans +"], ["8+", "8 ans +"], ["13+", "13 ans +"], ["adulte", "Adulte"]];
const JOURS = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
let root, jours = ["sam", "dim"], jour = "sam", tab = "entrees";
let ville = "Fécamp", cp = "76400", basket = {}, counts = {}, synced = true, lastGroup = [];
let parties = [], insc = [], retry = null;
const onOnline = () => { if (store.editionId) refresh(); };
const onOffline = () => { if (root?.isConnected) draw(); };
const countsKey = () => `pf_accueil_${store.editionId}_${jour}`;

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1><div class="sub">Aucune édition</div></div></div>
      <div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  const ed = await supa.from("editions").select("jours_actifs").eq("id", store.editionId).single();
  jours = ed.data?.jours_actifs?.length ? ed.data.jours_actifs : ["sam", "dim"];
  if (!jours.includes(jour)) jour = jours[0];
  unmount();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  retry = setInterval(flush, 30000);  // wifi « connecté » sans Internet : on réessaie
  await refresh();
}

// Appelé par le routeur en quittant l'écran : plus d'écouteurs ni de réessai fantômes.
export function unmount() {
  window.removeEventListener("online", onOnline);
  window.removeEventListener("offline", onOffline);
  clearInterval(retry); retry = null;
}

async function refresh() {
  const ed = store.editionId;
  // Par pages de 1000 : Supabase plafonne une réponse à 1000 lignes par défaut, et un
  // samedi peut dépasser ce nombre d'entrées (le compteur restait bloqué à 1000).
  const data = [];
  let error = null;
  for (let from = 0; ; from += 1000) {
    const r = await supa.from("entrees").select("id,tranche_age").eq("edition_id", ed).eq("jour", jour)
      .order("id").range(from, from + 999);
    if (r.error) { error = r.error; break; }
    data.push(...(r.data ?? []));
    if (!r.data || r.data.length < 1000) break;
  }
  const c = {}; TRANCHES.forEach((t) => (c[t[0]] = 0));
  const serverIds = new Set();
  if (!error) {
    data.forEach((r) => { serverIds.add(r.id); c[r.tranche_age] = (c[r.tranche_age] || 0) + 1; });
    try { localStorage.setItem(countsKey(), JSON.stringify(c)); } catch { /* stockage indisponible */ }
  } else {
    // Hors ligne : derniers totaux serveur connus sur cet appareil (+ la file ci-dessous).
    try { Object.assign(c, JSON.parse(localStorage.getItem(countsKey())) || {}); } catch { /* rien */ }
  }
  const q = (await qAll()).filter((e) => e.edition_id === ed && e.jour === jour && !serverIds.has(e.id));
  q.forEach((e) => { c[e.tranche_age] = (c[e.tranche_age] || 0) + 1; });
  counts = c; synced = q.length === 0;
  const [pa, pi] = await Promise.all([
    supa.from("parties").select("id,jour,debut,fin,places,element_id,jeu_edition_id,jeux_editions(jeux(titre)),elements(numero)").eq("edition_id", ed),
    supa.from("partie_inscriptions").select("*").eq("edition_id", ed),
  ]);
  parties = pa.data || []; insc = pi.data || [];
  draw(); flush();
}

function draw() {
  const subTabs = `<div class="utabs">
    <button data-tab="entrees"${tab === "entrees" ? ' class="on"' : ""}>Entrées</button>
    <button data-tab="inscriptions"${tab === "inscriptions" ? ' class="on"' : ""}>Inscriptions aux parties</button></div>`;
  root.innerHTML = `<div class="page-head"><div><h1>Accueil</h1>
      <div class="sub">${navigator.onLine ? (synced ? "Synchronisé" : "Envoi en attente…") : "⚠ Hors ligne — saisies conservées"}</div></div></div>
    ${subTabs}${tab === "inscriptions" ? inscTab() : entreesTab()}`;
  wire();
}

/* ---------- Entrées ---------- */
function entreesTab() {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const basketN = Object.values(basket).reduce((a, b) => a + b, 0);
  const jourBtns = jours.map((j) => `<button class="pill-btn${j === jour ? " on" : ""}" data-jour="${j}">${esc(JOURS[j] || j)}</button>`).join("");

  const prov = `<div class="card"><div class="filters" style="align-items:flex-end">
      <label>Ville<input id="e-ville" value="${esc(ville)}"></label>
      <label>Code postal<input id="e-cp" value="${esc(cp)}" style="width:110px"></label>
      <span class="muted">Provenance appliquée au prochain groupe validé (défaut Fécamp 76400).</span>
    </div></div>`;

  const tiles = TRANCHES.map(([k, lbl]) => `<div class="acc-tile">
      <button class="acc-add" data-add="${k}"><span class="acc-count">${basket[k] || 0}</span><span class="acc-lbl">${esc(lbl)}</span><span class="acc-plus">+1</span></button>
      <button class="acc-sub" data-sub="${k}" aria-label="Retirer un ${esc(lbl)}"${basket[k] ? "" : " disabled"}>−</button>
    </div>`).join("");

  const valider = `<div class="acc-valider">
      <button class="btn primary big" id="e-valider"${basketN ? "" : " disabled"}>Valider le groupe${basketN ? ` — ${basketN} pers.` : ""}</button>
      ${basketN ? `<button class="btn" id="e-clear">Vider</button>` : ""}
    </div>`;

  const recap = `<div class="card"><div class="ihead"><h3>${esc(JOURS[jour] || jour)} — ${total} entrée${total > 1 ? "s" : ""}</h3>
      ${lastGroup.length ? `<button class="btn small" id="e-undo">Annuler le dernier groupe (${lastGroup.length})</button>` : ""}</div>
    <div class="grid g4">${TRANCHES.map(([k, lbl]) => `<div class="kpi"><span class="v">${counts[k] || 0}</span>${esc(lbl)}</div>`).join("")}</div></div>`;

  return `<div class="salle-tabs">${jourBtns}</div>${prov}
    <div class="card"><div class="ihead"><h3>Nouveau groupe</h3></div>
      <div class="acc-grid">${tiles}</div>${valider}</div>
    ${recap}`;
}

/* ---------- Inscriptions aux parties ---------- */
function inscTab() {
  const nbPar = new Map();
  insc.forEach((i) => nbPar.set(i.partie_id, (nbPar.get(i.partie_id) || 0) + i.nb));
  const jOrder = { ven: 0, sam: 1, dim: 2 };
  const sorted = [...parties].sort((a, b) => (jOrder[a.jour] - jOrder[b.jour]) || (a.debut || "").localeCompare(b.debut || ""));
  const byJour = {};
  sorted.forEach((p) => (byJour[p.jour] = byJour[p.jour] || []).push(p));
  const body = Object.keys(byJour).sort((a, b) => jOrder[a] - jOrder[b]).map((j) => {
    const rows = byJour[j].map((p) => {
      const jeu = p.jeux_editions?.jeux?.titre || "Partie";
      const t = p.elements?.numero ? `Table n°${p.elements.numero}` : "";
      const pris = nbPar.get(p.id) || 0;
      const reste = p.places != null ? p.places - pris : null;
      const full = reste != null && reste <= 0;
      const mine = insc.filter((i) => i.partie_id === p.id);
      return `<div class="card insc-card">
        <div class="ihead"><h3>${esc((p.debut || "").slice(0, 5))}–${esc((p.fin || "").slice(0, 5))} · ${esc(jeu)}</h3>
          <span class="tag ${full ? "bad" : "ok"}">${p.places != null ? `${pris}/${p.places}` : `${pris}`} inscrit${pris > 1 ? "s" : ""}${full ? " · complet" : ""}</span></div>
        <div class="muted" style="margin:-4px 0 8px">${esc(t)}</div>
        <div class="filters" style="align-items:flex-end">
          <label>Nom (optionnel)<input data-inom="${p.id}" placeholder="Famille, prénom…"${full ? " disabled" : ""}></label>
          <label>Nombre<input type="number" min="1" value="1"${reste != null ? ` max="${reste}"` : ""} data-inb="${p.id}" style="width:80px"${full ? " disabled" : ""}></label>
          <button class="btn primary" data-iadd="${p.id}"${full ? " disabled" : ""}>${full ? "Complet" : "Inscrire"}</button>
          ${reste != null && !full ? `<span class="muted">${reste} place${reste > 1 ? "s" : ""} restante${reste > 1 ? "s" : ""}</span>` : ""}
        </div>
        ${mine.length ? `<details class="insc-list"><summary>${mine.length} inscription${mine.length > 1 ? "s" : ""}</summary>
          ${mine.map((i) => `<div class="insc-row"><span>${esc(i.nom || "—")} · ${i.nb} pers.</span><button class="btn small danger" data-idel="${i.id}" aria-label="Supprimer l'inscription">×</button></div>`).join("")}</details>` : ""}
      </div>`;
    }).join("");
    return `<div class="ihead" style="margin-top:8px"><h2 class="sect-title">${esc(JOURS[j] || j)}</h2></div>${rows}`;
  }).join("") || `<div class="card"><p class="muted">Aucune partie planifiée. Les parties se créent dans « Animations ».</p></div>`;
  return `<p class="mini" style="margin:8px 2px">Inscription libre, à tout moment, indépendante du comptage des entrées.</p>${body}`;
}

/* ---------- câblage ---------- */
function wire() {
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
  root.querySelectorAll("[data-jour]").forEach((b) => (b.onclick = () => { jour = b.dataset.jour; refresh(); }));
  root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => { basket[b.dataset.add] = (basket[b.dataset.add] || 0) + 1; draw(); }));
  root.querySelectorAll("[data-sub]").forEach((b) => (b.onclick = () => { basket[b.dataset.sub] = Math.max(0, (basket[b.dataset.sub] || 0) - 1); if (!basket[b.dataset.sub]) delete basket[b.dataset.sub]; draw(); }));
  const ev = root.querySelector("#e-ville"); if (ev) ev.onchange = () => { ville = ev.value.trim(); };
  const ec = root.querySelector("#e-cp"); if (ec) ec.onchange = () => { cp = ec.value.trim(); };
  const val = root.querySelector("#e-valider"); if (val) val.onclick = validerGroupe;
  const clr = root.querySelector("#e-clear"); if (clr) clr.onclick = () => { basket = {}; draw(); };
  const un = root.querySelector("#e-undo"); if (un) un.onclick = undoGroup;
  root.querySelectorAll("[data-iadd]").forEach((b) => (b.onclick = () => inscrire(b.dataset.iadd)));
  root.querySelectorAll("[data-idel]").forEach((b) => (b.onclick = () => delInsc(b.dataset.idel)));
}

async function validerGroupe() {
  // Capture la provenance courante au cas où le champ n'a pas déclenché change.
  ville = (root.querySelector("#e-ville")?.value ?? ville).trim();
  cp = (root.querySelector("#e-cp")?.value ?? cp).trim();
  const group = [];
  for (const [k, n] of Object.entries(basket)) {
    for (let i = 0; i < n; i++) {
      const item = { id: crypto.randomUUID(), edition_id: store.editionId, jour, tranche_age: k,
        ville: ville || null, code_postal: cp || null, saisi_le: new Date().toISOString(), saisi_par: session.user.id };
      await qAdd(item); group.push(item);
    }
  }
  if (!group.length) return;
  lastGroup = group; basket = {};
  // Mise à jour optimiste des compteurs
  group.forEach((e) => (counts[e.tranche_age] = (counts[e.tranche_age] || 0) + 1));
  synced = false; draw(); flush();
}

async function undoGroup() {
  if (!lastGroup.length) return;
  const enFile = new Set((await qAll().catch(() => [])).map((e) => e.id));
  const restants = [];
  for (const e of lastGroup) {
    if (enFile.has(e.id)) await qDel(e.id).catch(() => {});  // jamais parti : retrait local suffit
    const { error } = await supa.from("entrees").delete().eq("id", e.id);
    // Déjà envoyée et suppression impossible (hors ligne) : on ne fait pas semblant.
    if (error && !enFile.has(e.id)) { restants.push(e); continue; }
    counts[e.tranche_age] = Math.max(0, (counts[e.tranche_age] || 0) - 1);
  }
  lastGroup = restants; draw();
  if (restants.length) toast(`Annulation incomplète (réseau) : ${restants.length} entrée(s) restent comptées. Réessaie quand le réseau revient.`);
}

async function inscrire(partieId) {
  const nom = (root.querySelector(`[data-inom="${partieId}"]`)?.value || "").trim() || null;
  const nb = parseInt(root.querySelector(`[data-inb="${partieId}"]`)?.value, 10) || 1;
  const p = parties.find((x) => x.id === partieId);
  if (p && p.places != null) {
    const pris = insc.filter((i) => i.partie_id === partieId).reduce((s, i) => s + i.nb, 0);
    if (pris + nb > p.places) { toast(`Impossible : ${p.places - pris} place(s) restante(s) sur ${p.places} (déjà ${pris} inscrit·e·s).`); return; }
  }
  const { data, error } = await supa.from("partie_inscriptions")
    .insert({ edition_id: store.editionId, partie_id: partieId, nom, nb, saisi_par: session.user.id }).select().single();
  if (error) { toast("Inscription non enregistrée : " + error.message); return; }
  insc.push(data); draw();
}
async function delInsc(id) {
  const { error } = await supa.from("partie_inscriptions").delete().eq("id", id);
  if (error) { toast("Suppression impossible : " + error.message); return; }
  insc = insc.filter((i) => i.id !== id); draw();
}

let flushing = false;
async function flush() {
  if (flushing) return;  // pas de test navigator.onLine : il ment sur un wifi sans Internet
  flushing = true;
  try {
    const q = await qAll();
    for (const e of q) { const { error } = await supa.from("entrees").upsert(e); if (!error) await qDel(e.id); }
    const left = (await qAll()).length;
    if (synced !== (left === 0)) { synced = left === 0; if (root?.isConnected) draw(); }
  } catch { /* IndexedDB indisponible */ } finally { flushing = false; }
}
