// Pages publiques #/public/inscription/<type>/<editionId> — formulaires anonymes.
// type = "partenaire" | "benevole". Insert seul (jamais de lecture), champ piège _hp.
import { supa } from "../supabase.js";
import { esc } from "../ui/util.js";

const CONF = {
  partenaire: {
    titre: "Inscription partenaire",
    table: "inscriptions_partenaires",
    champs: [
      ["nom", "Nom de la structure", "text", true],
      ["contact", "Personne de contact", "text", false],
      ["email", "E-mail", "email", true],
      ["tel", "Téléphone", "tel", false],
      ["site", "Site web", "url", false],
      ["personnes_sam", "Personnes présentes samedi", "number", false],
      ["personnes_dim", "Personnes présentes dimanche", "number", false],
      ["tables", "Tables souhaitées", "number", false],
      ["chaises", "Chaises souhaitées", "number", false],
      ["grilles", "Grilles d'exposition souhaitées", "number", false],
      ["electricite", "Besoin d'électricité", "checkbox", false],
      ["logo", "Lien vers votre logo (image en ligne)", "url", false],
      ["regime", "Régime alimentaire / allergies", "text", false],
      ["notes", "Précisions", "textarea", false],
    ],
  },
  benevole: {
    titre: "Inscription bénévole",
    table: "inscriptions_benevoles",
    champs: [
      ["nom", "Prénom et nom", "text", true],
      ["email", "E-mail", "email", true],
      ["tel", "Téléphone", "tel", false],
      ["equipes", "Équipes souhaitées (séparées par des virgules)", "text", false],
      ["dispos", "Tes disponibilités", "dispos", false],
      ["repas_sam", "Je prendrai le repas du samedi midi", "checkbox", false],
      ["repas_dim", "Je prendrai le repas du dimanche midi", "checkbox", false],
      ["regime", "Régime alimentaire / allergies", "text", false],
      ["notes", "Remarques…", "textarea", false],
      ["recontacter", "J'accepte d'être recontacté·e pour la prochaine édition", "checkbox", false],
    ],
  },
};

// Même grille que la fiche bénévole : vendredi = mise en place, dimanche soir = rangement.
const DISPO_ROWS = [["ven", "Vendredi", ["matin", "aprem"]], ["sam", "Samedi", ["matin", "aprem"]], ["dim", "Dimanche", ["matin", "aprem", "soir"]]];
const DEMI = [["matin", "Matin"], ["aprem", "Après-midi"], ["soir", "Soir"]];
function grilleDispos() {
  const head = `<tr><th></th>${DEMI.map(([, l]) => `<th>${l}</th>`).join("")}</tr>`;
  const body = DISPO_ROWS.map(([j, lbl, ds]) => `<tr><th>${lbl}</th>${DEMI.map(([d, dl]) => ds.includes(d)
    ? `<td><input type="checkbox" data-dispo="${j}|${d}" aria-label="${lbl} ${dl}"></td>` : "<td></td>").join("")}</tr>`).join("");
  return `<table class="dispo-grid">${head}${body}</table>
    <p class="mini">Vendredi = mise en place · dimanche soir = rangement.</p>`;
}

function shell(body) {
  return `<div class="public-wrap">
    <header class="public-head"><div class="brand">PlanFest</div></header>
    <div class="public-body">${body}</div>
    <footer class="public-foot">Festival du jeu de Fécamp · La Jurande des Conte-Brumes</footer>
  </div>`;
}

export async function render(app, type, editionId) {
  const conf = CONF[type];
  if (!conf || !editionId) { app.innerHTML = shell(`<p>Lien invalide.</p>`); return; }
  const fields = conf.champs.map(([k, lbl, t, req]) => {
    if (t === "checkbox") return `<span class="chk-inline pub-chk"><input type="checkbox" id="f-${k}"> ${esc(lbl)}</span>`;
    if (t === "dispos") return `<div class="champ-groupe"><span class="lbl">${esc(lbl)}</span>${grilleDispos()}</div>`;
    const input = t === "textarea"
      ? `<textarea id="f-${k}"></textarea>`
      : `<input id="f-${k}" type="${t}"${req ? " required" : ""}>`;
    return `<label>${esc(lbl)}${req ? " *" : ""}${input}</label>`;
  }).join("");
  app.innerHTML = shell(`<h1>${esc(conf.titre)}</h1>
    <p class="mini">Tes informations sont transmises à l'organisation du festival. Aucune donnée n'est publiée.</p>
    <form id="insc" class="card">
      ${fields}
      <input type="text" id="f-_hp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      <button class="btn primary" type="submit">Envoyer</button>
      <p class="msg" id="msg" aria-live="polite"></p>
    </form>`);

  const form = app.querySelector("#insc");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = app.querySelector("#msg");
    const payload = { _hp: app.querySelector("#f-_hp").value };
    for (const [k, , t] of conf.champs) {
      if (t === "checkbox") { if (app.querySelector(`#f-${k}`).checked) payload[k] = "oui"; continue; }
      if (t === "dispos") {
        const d = [...app.querySelectorAll("[data-dispo]:checked")].map((c) => c.dataset.dispo);
        if (d.length) payload[k] = d;
        continue;
      }
      const v = app.querySelector(`#f-${k}`).value.trim();
      if (v) payload[k] = v;
    }
    if (!payload.nom) { msg.textContent = "Le nom est requis."; return; }
    msg.textContent = "Envoi…";
    const { error } = await supa.from(conf.table).insert({ edition_id: editionId, payload });
    if (error) { msg.textContent = "Erreur : réessaie plus tard."; return; }
    app.innerHTML = shell(`<h1>Merci !</h1><p>Ton inscription a bien été envoyée. L'organisation te recontactera.</p>`);
  });
}
