// Contreparties (table contreparties, migration 052) : affichage et actions communs aux
// écrans Jeux (fiche d'un jeu obtenu par don / prêt), Organismes (sponsors, partenaires) et
// Communication (liste complète).
import { supa } from "../supabase.js";
import { esc, toast, aujourdhui } from "./util.js";

export const NATURES = [["photos", "Photos"], ["compte_rendu", "Compte rendu"], ["communication", "Communication"], ["logo", "Logo"], ["autre", "Autre"]];
export const ORIGINES = [["jeu", "Jeu"], ["sponsor", "Sponsor"], ["partenaire", "Partenaire"], ["autre", "Autre"]];
export const natureLbl = (k) => (NATURES.find((x) => x[0] === k) || [k, k])[1];
export const origineLbl = (k) => (ORIGINES.find((x) => x[0] === k) || [k, k])[1];

// Une contrepartie : case « faite », type, description, échéance (en retard en rouge).
export function ligneContrepartie(c, w, avecBeneficiaire = false) {
  const retard = !c.faite && c.echeance && c.echeance < aujourdhui();
  return `<div class="cp-ligne${c.faite ? " faite" : ""}">
    <span class="chk-inline"><input type="checkbox" data-cpfait="${c.id}"${c.faite ? " checked" : ""}${w ? "" : " disabled"} aria-label="Contrepartie faite"></span>
    <span><span class="pill grey">${esc(natureLbl(c.nature))}</span>
      ${avecBeneficiaire ? `<b>${esc(c.beneficiaire)}</b> · ` : ""}${esc(c.description || "")}
      ${c.echeance ? ` <span class="${retard ? "tag bad" : "muted"}">${retard ? "en retard · " : "avant le "}${esc(c.echeance)}</span>` : ""}
      ${c.faite && c.faite_le ? ` <span class="muted">faite le ${esc(c.faite_le)}</span>` : ""}</span>
    ${w ? `<button class="btn small ghost" data-cpdel="${c.id}" aria-label="Supprimer la contrepartie">×</button>` : ""}
  </div>`;
}

// Petit formulaire d'ajout (type, description, échéance) ; le contexte (à qui, d'où) est
// fourni par l'écran au moment de l'ajout.
export function formulaireContrepartie() {
  return `<div class="filters cp-form" style="align-items:flex-end">
    <label>Type<select id="cp-nature">${NATURES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
    <label>Détail<input id="cp-desc" placeholder="ex. 5 photos du stand, post Instagram…"></label>
    <label>Avant le<input type="date" id="cp-ech"></label>
    <button type="button" class="btn small primary" data-cpadd>Ajouter</button></div>`;
}

// Bloc complet pour une fiche : liste + ajout.
export function blocContreparties(liste, w, titre = "Contreparties demandées") {
  return `<div class="card"><h2>${esc(titre)}</h2>
    ${liste.length ? liste.map((c) => ligneContrepartie(c, w)).join("") : `<p class="muted">Aucune contrepartie demandée.</p>`}
    ${w ? formulaireContrepartie() : ""}
    <p class="mini">Toutes les contreparties sont suivies dans Communication → Contreparties.</p></div>`;
}

// Gère un clic / changement sur les éléments ci-dessus. `contexte` = champs à enregistrer
// avec une nouvelle contrepartie (edition_id, beneficiaire, organisme_id, origine,
// jeu_edition_id). `liste` = tableau en mémoire de l'écran (mis à jour sur place).
// Renvoie true si l'action a été traitée (l'écran doit alors se redessiner).
export async function actionContrepartie(t, liste, contexte) {
  const fait = t.closest?.("[data-cpfait]");
  if (fait && t.type === "checkbox") {
    const c = liste.find((x) => x.id === fait.dataset.cpfait); if (!c) return false;
    const patch = { faite: t.checked, faite_le: t.checked ? aujourdhui() : null };
    const { error } = await supa.from("contreparties").update(patch).eq("id", c.id);
    if (error) { toast("Erreur : " + error.message); return false; }
    Object.assign(c, patch); return true;
  }
  const del = t.closest?.("[data-cpdel]");
  if (del) {
    if (!confirm("Supprimer cette contrepartie ?")) return false;
    const { error } = await supa.from("contreparties").delete().eq("id", del.dataset.cpdel);
    if (error) { toast("Erreur : " + error.message); return false; }
    const i = liste.findIndex((x) => x.id === del.dataset.cpdel); if (i >= 0) liste.splice(i, 1);
    return true;
  }
  if (t.closest?.("[data-cpadd]")) {
    const box = t.closest(".card") || document;
    const ctx = typeof contexte === "function" ? contexte(box) : contexte;
    if (!ctx) return false;
    if (!ctx.beneficiaire) { toast("Indique à qui on doit cette contrepartie."); return false; }
    const row = { ...ctx, nature: box.querySelector("#cp-nature")?.value || "autre",
      description: (box.querySelector("#cp-desc")?.value || "").trim() || null,
      echeance: box.querySelector("#cp-ech")?.value || null };
    const { data, error } = await supa.from("contreparties").insert(row).select().single();
    if (error) { toast("Erreur : " + error.message); return false; }
    liste.push(data); return true;
  }
  return false;
}
