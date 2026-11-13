// Écran #/repas — « Buvette & catering ». Sous-onglets :
//  - Repas : compteurs de repas par jour + régimes particuliers (catering).
//  - Buvette : articles avec quantités achetées/vendues, prix → coût, CA, marge,
//    stock restant. Par édition (historique via les éditions passées).
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";
import { isAdmin, hasPole } from "../auth.js";

const JOURS = [["sam", "Samedi"], ["dim", "Dimanche"]];
let root, inclureNC = false, tab = "repas", items = [], byJour = {}, regimes = {}, loadErr = "";
const canWrite = () => isAdmin() || hasPole("buvette_catering");
const eur = (n) => (Math.round((n || 0) * 100) / 100).toFixed(2) + " €";

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = head("Aucune édition sélectionnée") + `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await load();
  draw();
}

const head = (sub) => `<div class="page-head"><div><h1>Buvette &amp; catering</h1><div class="sub">${esc(sub)}</div></div>
  <div class="head-actions">${tab === "repas" ? `<button class="btn small${inclureNC ? " primary" : ""}" id="nc">Inclure non confirmés</button>` : ""}</div></div>`;

async function load() {
  loadErr = "";
  const [rp, rSam, rDim, bi] = await Promise.all([
    supa.rpc("repas_par_jour", { p_edition: store.editionId, p_inclure_non_confirmes: inclureNC }),
    supa.rpc("liste_regimes", { p_edition: store.editionId, p_jour: "sam" }),
    supa.rpc("liste_regimes", { p_edition: store.editionId, p_jour: "dim" }),
    supa.from("buvette_items").select("*").eq("edition_id", store.editionId).order("categorie").order("nom"),
  ]);
  if (rp.error) loadErr = rp.error.message;
  byJour = {}; (rp.data ?? []).forEach((r) => (byJour[r.j_code] = r));
  regimes = { sam: rSam.data ?? [], dim: rDim.data ?? [] };
  items = bi.data ?? [];
}

function draw() {
  const subTabs = `<div class="utabs">
    <button data-tab="repas"${tab === "repas" ? ' class="on"' : ""}>Repas</button>
    <button data-tab="buvette"${tab === "buvette" ? ' class="on"' : ""}>Buvette</button></div>`;
  const sub = tab === "repas" ? (inclureNC ? "Partenaires confirmés + non confirmés" : "Partenaires confirmés uniquement") : "Articles achetés / vendus";
  root.innerHTML = head(sub) + subTabs + (tab === "buvette" ? buvetteTab() : repasTab());
  wire();
}

/* ---------- Repas ---------- */
function repasTab() {
  if (loadErr) return `<div class="card"><p class="msg">${loadErr.includes("acces") ? "Accès réservé au pôle Buvette / catering et aux admins." : "Erreur : " + esc(loadErr)}</p></div>`;
  const cards = JOURS.map(([j, lbl]) => {
    const d = byJour[j] || { nb_partenaires: 0, nb_benevoles: 0, nb_total: 0 };
    const regs = (regimes[j] || []).map((r) => `<li><b>${esc(r.nom)}</b> <span class="mini">(${r.source === "benevole" ? "bénévole" : "partenaire"})</span> — ${esc(r.texte)}</li>`).join("")
      || `<li class="muted">Aucun régime signalé.</li>`;
    return `<div class="card"><h2>${lbl}</h2>
      <div class="kpis">
        <div class="kpi"><div class="kpi-val">${d.nb_total}</div><div class="kpi-lbl">Total repas</div></div>
        <div class="kpi"><div class="kpi-val">${d.nb_partenaires}</div><div class="kpi-lbl">Partenaires</div></div>
        <div class="kpi"><div class="kpi-val">${d.nb_benevoles}</div><div class="kpi-lbl">Bénévoles</div></div>
      </div>
      <h3 style="font:700 13px var(--display);margin:14px 0 8px">Régimes particuliers</h3>
      <ul class="reg-list">${regs}</ul></div>`;
  }).join("");
  return `<div class="dash-grid">${cards}</div>`;
}

/* ---------- Buvette ---------- */
function buvetteTab() {
  const cout = items.reduce((s, i) => s + i.qte_achetee * i.prix_achat, 0);
  const ca = items.reduce((s, i) => s + i.qte_vendue * i.prix_vente, 0);
  const kpis = `<div class="grid g3">
    <div class="kpi"><span class="v">${eur(ca)}</span>Chiffre d'affaires</div>
    <div class="kpi"><span class="v">${eur(cout)}</span>Coût d'achat</div>
    <div class="kpi"><span class="v" style="color:${ca - cout >= 0 ? "#15803D" : "#991B1B"}">${eur(ca - cout)}</span>Marge</div></div>`;

  const addForm = canWrite() ? `<div class="card"><div class="ihead"><h3>Ajouter un article</h3></div>
    <div class="filters" style="align-items:flex-end">
      <label>Article<input id="i-nom" placeholder="Bière, sandwich…"></label>
      <label>Catégorie<input id="i-cat" placeholder="Boisson, Snack…"></label>
      <label>Prix achat (€)<input type="number" step="0.01" min="0" id="i-pa" style="width:100px"></label>
      <label>Prix vente (€)<input type="number" step="0.01" min="0" id="i-pv" style="width:100px"></label>
      <label>Qté achetée<input type="number" min="0" id="i-qa" style="width:100px"></label>
      <button class="btn primary" id="i-add">Ajouter</button>
    </div><p class="msg" id="i-msg" aria-live="polite"></p></div>` : "";

  const ro = canWrite() ? "" : " disabled";
  const num = (it, f, w = 90) => `<input type="number" step="${f.startsWith("prix") ? "0.01" : "1"}" min="0" data-aid="${it.id}" data-af="${f}" value="${it[f]}" style="width:${w}px;margin:0"${ro}>`;
  const rows = items.map((it) => {
    const r = it.qte_achetee - it.qte_vendue;
    const caI = it.qte_vendue * it.prix_vente;
    return `<tr>
      <td><input data-aid="${it.id}" data-af="nom" value="${esc(it.nom)}" style="min-width:140px;margin:0"${ro}></td>
      <td><input data-aid="${it.id}" data-af="categorie" value="${esc(it.categorie || "")}" style="min-width:110px;margin:0"${ro}></td>
      <td>${num(it, "qte_achetee")}</td>
      <td>${num(it, "qte_vendue")}</td>
      <td style="text-align:right"><b class="${r < 0 ? "" : ""}" style="${r < 0 ? "color:#991B1B" : ""}">${r}</b></td>
      <td>${num(it, "prix_achat")}</td>
      <td>${num(it, "prix_vente")}</td>
      <td style="text-align:right">${eur(caI)}</td>
      <td style="text-align:right">${canWrite() ? `<button class="btn small danger" data-idel="${it.id}">Suppr.</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="9" class="muted">Aucun article. ${canWrite() ? "Ajoute-en un ci-dessus." : ""}</td></tr>`;

  const table = `<div class="card"><div class="scroll"><table class="data-table">
    <thead><tr><th>Article</th><th>Catégorie</th><th>Acheté</th><th>Vendu</th><th style="text-align:right">Reste</th><th>Prix achat</th><th>Prix vente</th><th style="text-align:right">CA</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="mini">Historique : les articles sont enregistrés par édition — change d'édition pour consulter une campagne passée.</p></div>`;

  return kpis + addForm + table;
}

/* ---------- câblage ---------- */
function wire() {
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; draw(); }));
  const nc = root.querySelector("#nc"); if (nc) nc.onclick = async () => { inclureNC = !inclureNC; await load(); draw(); };
  const add = root.querySelector("#i-add"); if (add) add.onclick = addItem;
  root.querySelectorAll("[data-idel]").forEach((b) => (b.onclick = () => delItem(b.dataset.idel)));
  root.querySelectorAll("[data-aid]").forEach((inp) => (inp.onchange = () => editItem(inp.dataset.aid, inp.dataset.af, inp)));
}

const imsg = (t) => { const m = root.querySelector("#i-msg"); if (m) m.textContent = t; };

async function addItem() {
  const nom = (root.querySelector("#i-nom").value || "").trim();
  if (!nom) return imsg("Nom de l'article requis.");
  const row = {
    edition_id: store.editionId, nom,
    categorie: (root.querySelector("#i-cat").value || "").trim() || null,
    prix_achat: parseFloat(root.querySelector("#i-pa").value) || 0,
    prix_vente: parseFloat(root.querySelector("#i-pv").value) || 0,
    qte_achetee: parseInt(root.querySelector("#i-qa").value, 10) || 0,
  };
  imsg("Ajout…");
  const { data, error } = await supa.from("buvette_items").insert(row).select().single();
  if (error) return imsg("Erreur : " + error.message);
  items.push(data); items.sort((a, b) => (a.categorie || "").localeCompare(b.categorie || "") || a.nom.localeCompare(b.nom, "fr"));
  draw();
}

async function editItem(id, field, inp) {
  let val;
  if (field === "nom" || field === "categorie") val = inp.value.trim() || (field === "nom" ? null : null);
  else if (field.startsWith("prix")) val = parseFloat(inp.value) || 0;
  else val = parseInt(inp.value, 10) || 0;
  if (field === "nom" && !val) { inp.classList.add("err"); return; }
  const { error } = await supa.from("buvette_items").update({ [field]: val }).eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  const it = items.find((x) => x.id === id); if (it) it[field] = val;
  draw(); // recalcule les totaux et colonnes dérivées
}

async function delItem(id) {
  const it = items.find((x) => x.id === id);
  if (!confirm(`Supprimer « ${it?.nom || "cet article"} » ?`)) return;
  const { error } = await supa.from("buvette_items").delete().eq("id", id);
  if (error) { alert("Erreur : " + error.message); return; }
  items = items.filter((x) => x.id !== id); draw();
}
