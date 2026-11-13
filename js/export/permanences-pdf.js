// Export PDF des permanences bénévoles (jsPDF vendorisé) :
//  - exportFeuillesBenevoles : une page A4 par bénévole, ses permanences + animations.
//  - exportPlanningTables   : planning par table (animations + permanences sur la table).
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";
import { slug } from "../ui/util.js";

const JO = { ven: 0, sam: 1, dim: 2 };
const JLBL = { ven: "Vendredi", sam: "Samedi", dim: "Dimanche" };
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
function finFromDuree(debut, duree) {
  const [h, m] = String(debut).split(":").map(Number);
  const tot = h * 60 + m + (duree || 0);
  return `${String(Math.floor(tot / 60) % 24).padStart(2, "0")}:${String(tot % 60).padStart(2, "0")}`;
}
const byJourHeure = (a, b) => (JO[a.jour] - JO[b.jour]) || String(a.debut).localeCompare(String(b.debut));

export async function exportFeuillesBenevoles(editionId, editionNom) {
  const [be, pm, pa, el] = await Promise.all([
    supa.from("benevoles_editions").select("id, statut, benevoles(nom)").eq("edition_id", editionId),
    supa.from("permanences").select("benevole_edition_id, poste, jour, debut, fin, element_id").eq("edition_id", editionId),
    supa.from("parties").select("benevole_edition_id, jour, debut, duree_min, titre, element_id, jeu_edition_id, jeux_editions(jeux(titre))").eq("edition_id", editionId),
    supa.from("elements").select("id, numero").eq("edition_id", editionId),
  ]);
  if (be.error) throw be.error;
  const numById = new Map((el.data ?? []).map((e) => [e.id, e.numero]));
  const benById = new Map((be.data ?? []).filter((b) => b.statut !== "annule").map((b) => [b.id, b.benevoles?.nom || "?"]));
  const byBen = new Map();
  const push = (id, e) => { if (!id) return; if (!byBen.has(id)) byBen.set(id, []); byBen.get(id).push(e); };
  (pm.data ?? []).forEach((p) => push(p.benevole_edition_id, { jour: p.jour, debut: p.debut, fin: p.fin, label: p.poste, table: p.element_id ? numById.get(p.element_id) : null }));
  (pa.data ?? []).forEach((p) => {
    const titre = p.jeux_editions?.jeux?.titre || p.titre || "Animation";
    push(p.benevole_edition_id, { jour: p.jour, debut: p.debut, fin: finFromDuree(p.debut, p.duree_min), label: "Animation — " + titre, table: p.element_id ? numById.get(p.element_id) : null });
  });
  const ids = [...byBen.keys()].filter((id) => benById.has(id)).sort((a, b) => benById.get(a).localeCompare(benById.get(b), "fr"));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  ids.forEach((id, i) => {
    if (i > 0) doc.addPage();
    let y = 28;
    doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.setTextColor(30);
    doc.text(benById.get(id), 20, y); y += 9;
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(90);
    doc.text(`Feuille bénévole — ${editionNom || ""}`, 20, y); y += 6;
    doc.setDrawColor(210); doc.line(20, y, 190, y); y += 10;
    const entries = byBen.get(id).sort(byJourHeure);
    let curJ = null;
    entries.forEach((e) => {
      if (y > 275) { doc.addPage(); y = 20; curJ = null; }
      if (e.jour !== curJ) { curJ = e.jour; y += 3; doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(30); doc.text(JLBL[e.jour] || e.jour, 20, y); y += 7; }
      doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(50);
      const t = e.table ? `   (table n°${e.table})` : "";
      doc.text(`${hhmm(e.debut)}–${hhmm(e.fin)}    ${e.label}${t}`, 24, y, { maxWidth: 166 }); y += 7;
    });
  });
  if (!ids.length) { doc.setFontSize(12); doc.text("Aucune permanence ni animation attribuée à un bénévole.", 20, 20); }
  doc.save(`feuilles-benevoles-${slug(editionNom)}.pdf`);
}

export async function exportPlanningTables(editionId, editionNom) {
  const [sal, el, pa, pm, be] = await Promise.all([
    supa.from("salles").select("id, nom").eq("edition_id", editionId).order("cree_le"),
    supa.from("elements").select("id, numero, salle_id, type_table, mode, kind, sous, label").eq("edition_id", editionId).in("kind", ["table", "bloc"]),
    supa.from("parties").select("element_id, jour, debut, duree_min, titre, benevole_edition_id, jeu_edition_id, jeux_editions(jeux(titre))").eq("edition_id", editionId),
    supa.from("permanences").select("element_id, jour, debut, fin, poste, benevole_edition_id").eq("edition_id", editionId),
    supa.from("benevoles_editions").select("id, benevoles(nom)").eq("edition_id", editionId),
  ]);
  if (el.error) throw el.error;
  const benById = new Map((be.data ?? []).map((b) => [b.id, b.benevoles?.nom || "?"]));
  const salNom = new Map((sal.data ?? []).map((s) => [s.id, s.nom]));
  const act = new Map();
  const push = (id, e) => { if (!id) return; if (!act.has(id)) act.set(id, []); act.get(id).push(e); };
  (pa.data ?? []).forEach((p) => {
    const titre = p.jeux_editions?.jeux?.titre || p.titre || "Animation";
    push(p.element_id, { jour: p.jour, debut: p.debut, fin: finFromDuree(p.debut, p.duree_min), label: titre, who: p.benevole_edition_id ? benById.get(p.benevole_edition_id) : "— sans animateur" });
  });
  (pm.data ?? []).forEach((p) => push(p.element_id, { jour: p.jour, debut: p.debut, fin: p.fin, label: "Permanence — " + p.poste, who: p.benevole_edition_id ? benById.get(p.benevole_edition_id) : "— non attribué" }));
  // Permanences sans table → regroupées par poste (ex. Accueil, Buvette).
  const byPoste = new Map();
  (pm.data ?? []).forEach((p) => {
    if (p.element_id) return;
    const k = (p.poste || "Poste").trim();
    if (!byPoste.has(k)) byPoste.set(k, []);
    byPoste.get(k).push({ jour: p.jour, debut: p.debut, fin: p.fin, who: p.benevole_edition_id ? benById.get(p.benevole_edition_id) : "— non attribué" });
  });
  const tabs = (el.data ?? []).filter((t) => (t.type_table === "jurande" && t.mode === "animee") || act.has(t.id))
    .sort((a, b) => (salNom.get(a.salle_id) || "").localeCompare(salNom.get(b.salle_id) || "") || (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 24, curSalle = null;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(30);
  doc.text(`Planning des tables — ${editionNom || ""}`, 20, y); y += 12;
  if (!tabs.length && !byPoste.size) { doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.text("Aucune table ni permanence.", 20, y); }
  tabs.forEach((t) => {
    if (y > 268) { doc.addPage(); y = 20; curSalle = null; }
    const sn = salNom.get(t.salle_id) || "";
    if (sn !== curSalle) { curSalle = sn; y += 2; doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20); doc.text(sn, 20, y); y += 8; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(40);
    doc.text(t.kind === "bloc" ? (t.label || "Accueil") : `Table n°${t.numero ?? "?"}`, 22, y); y += 6;
    const entries = (act.get(t.id) || []).sort(byJourHeure);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(70);
    if (!entries.length) { doc.text("Aucune activité planifiée.", 26, y); y += 6; }
    entries.forEach((e) => {
      if (y > 283) { doc.addPage(); y = 20; }
      doc.text(`${JLBL[e.jour] || e.jour} ${hhmm(e.debut)}–${hhmm(e.fin)}  ·  ${e.label}  ·  ${e.who}`, 26, y, { maxWidth: 164 }); y += 6;
    });
    y += 3;
  });
  // Section « Postes » (permanences hors table : Accueil, Buvette…).
  const postes = [...byPoste.keys()].sort((a, b) => a.localeCompare(b, "fr"));
  if (postes.length) {
    if (y > 258) { doc.addPage(); y = 20; }
    y += 2; doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(20);
    doc.text("Postes", 20, y); y += 8;
    postes.forEach((poste) => {
      if (y > 268) { doc.addPage(); y = 20; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(40);
      doc.text(poste, 22, y); y += 6;
      doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(70);
      byPoste.get(poste).sort(byJourHeure).forEach((e) => {
        if (y > 283) { doc.addPage(); y = 20; }
        doc.text(`${JLBL[e.jour] || e.jour} ${hhmm(e.debut)}–${hhmm(e.fin)}  ·  ${e.who}`, 26, y, { maxWidth: 164 }); y += 6;
      });
      y += 3;
    });
  }
  doc.save(`planning-tables-${slug(editionNom)}.pdf`);
}
