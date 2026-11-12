// Écran #/repas — Phase 2. Repas par jour + régimes (admin, responsable buvette_catering).
import { supa } from "../supabase.js";
import { store } from "../store.js";
import { esc } from "../ui/util.js";

const JOURS = [["sam", "Samedi"], ["dim", "Dimanche"]];
let root, inclureNC = false;

export async function render(container) {
  root = container;
  if (!store.editionId) {
    root.innerHTML = head("Aucune édition sélectionnée") + `<div class="card"><p><a class="btn primary" href="#/editions">Choisir une édition</a></p></div>`;
    return;
  }
  await draw();
}
const head = (sub) => `<div class="page-head"><div><h1>Repas</h1><div class="sub">${esc(sub)}</div></div>
  <div class="head-actions"><button class="btn small${inclureNC ? " primary" : ""}" id="nc">Inclure non confirmés</button></div></div>`;

async function draw() {
  root.innerHTML = head("Chargement…") + `<div class="card"><p class="muted">…</p></div>`;
  wireOnce();
  const [rp, rSam, rDim] = await Promise.all([
    supa.rpc("repas_par_jour", { p_edition: store.editionId, p_inclure_non_confirmes: inclureNC }),
    supa.rpc("liste_regimes", { p_edition: store.editionId, p_jour: "sam" }),
    supa.rpc("liste_regimes", { p_edition: store.editionId, p_jour: "dim" }),
  ]);
  if (rp.error) {
    root.innerHTML = head("") + `<div class="card"><p class="msg">${rp.error.message.includes("acces") ? "Accès réservé au pôle Buvette / catering et aux admins." : "Erreur : " + esc(rp.error.message)}</p></div>`;
    return;
  }
  const byJour = {}; (rp.data ?? []).forEach((r) => (byJour[r.j_code] = r));
  const regimes = { sam: rSam.data ?? [], dim: rDim.data ?? [] };
  const cards = JOURS.map(([j, lbl]) => {
    const d = byJour[j] || { nb_partenaires: 0, nb_benevoles: 0, nb_total: 0 };
    const regs = regimes[j].map((r) => `<li><b>${esc(r.nom)}</b> <span class="mini">(${r.source === "benevole" ? "bénévole" : "partenaire"})</span> — ${esc(r.texte)}</li>`).join("")
      || `<li class="muted">Aucun régime signalé.</li>`;
    return `<div class="card">
      <h2>${lbl}</h2>
      <div class="kpis">
        <div class="kpi"><div class="kpi-val">${d.nb_total}</div><div class="kpi-lbl">Total repas</div></div>
        <div class="kpi"><div class="kpi-val">${d.nb_partenaires}</div><div class="kpi-lbl">Partenaires</div></div>
        <div class="kpi"><div class="kpi-val">${d.nb_benevoles}</div><div class="kpi-lbl">Bénévoles</div></div>
      </div>
      <h3 style="font:700 13px var(--display);margin:14px 0 8px">Régimes particuliers</h3>
      <ul class="reg-list">${regs}</ul>
    </div>`;
  }).join("");
  root.innerHTML = head(inclureNC ? "Partenaires confirmés + non confirmés" : "Partenaires confirmés uniquement") + `<div class="dash-grid">${cards}</div>`;
}

function wireOnce() {
  if (root.__repasWired) return;
  root.__repasWired = true;
  root.addEventListener("click", (e) => { if (e.target.closest("#nc")) { inclureNC = !inclureNC; draw(); } });
}
