// Page publique #/public/infos/<editionId> — présentation libre (écrite par l'organisation)
// + récap auto des exposants confirmés. Sans compte.
import { supa } from "../supabase.js";
import { esc, safeUrl } from "../ui/util.js";
import { publicShell } from "./layout.js";

const ROLE_LBL = { partenaire: "Partenaire", editeur: "Éditeur", sponsor: "Sponsor" };

export async function render(app, editionId) {
  app.innerHTML = publicShell("infos", editionId, `<p class="muted">Chargement…</p>`);
  if (!editionId) { app.innerHTML = publicShell("infos", "", `<p>Lien incomplet.</p>`); return; }
  const [ed, exp] = await Promise.all([
    supa.rpc("edition_public", { p_edition: editionId }),
    supa.rpc("exposants_public", { p_edition: editionId }),
  ]);
  const presentation = ed.data?.presentation || "";
  const list = exp.data ?? [];
  const partenaires = list.filter((e) => (e.roles || []).includes("partenaire"));
  const soutiens = list.filter((e) => !(e.roles || []).includes("partenaire")
    && ((e.roles || []).includes("editeur") || (e.roles || []).includes("sponsor")));

  const intro = presentation
    ? `<section class="card"><div class="pub-presentation">${esc(presentation)}</div></section>`
    : "";

  const expoCard = (e, withEmplacement) => {
    const roles = (e.roles || []).map((r) => `<span class="chip">${esc(ROLE_LBL[r] || r)}</span>`).join(" ");
    const dot = `<span class="dot" style="background:${esc(e.couleur || "#E4E4E7")}"></span>`;
    return `<div class="card expo-card">
      <div class="expo-top">${e.logo_url ? `<img class="expo-logo" src="${esc(e.logo_url)}" alt="" loading="lazy">` : ""}
        <div><h3>${dot}${esc(e.nom)}</h3><div class="expo-roles">${roles}</div></div></div>
      ${withEmplacement && e.numeros ? `<div class="muted">Emplacement : table ${esc(e.numeros)}</div>` : ""}
      ${safeUrl(e.site) ? `<a href="${esc(safeUrl(e.site))}" target="_blank" rel="noopener">Site web</a>` : ""}
    </div>`;
  };

  const sectionExpo = partenaires.length
    ? `<section class="pub-day"><h2>Exposants présents</h2>
        <div class="grid g3">${partenaires.map((e) => expoCard(e, true)).join("")}</div></section>`
    : "";
  const sectionSoutien = soutiens.length
    ? `<section class="pub-day"><h2>Merci pour leur soutien</h2>
        <div class="grid g3">${soutiens.map((e) => expoCard(e, false)).join("")}</div></section>`
    : "";

  const body = intro || sectionExpo || sectionSoutien
    ? intro + sectionExpo + sectionSoutien
    : `<p>Les informations ne sont pas encore publiées.</p>`;
  app.innerHTML = publicShell("infos", editionId, body);
}
