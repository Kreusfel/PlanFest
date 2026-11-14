// Export fiches d'accueil partenaires en PDF (jsPDF) : une page A4 par partenaire.
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";
import { slug } from "../ui/util.js";


// Consignes par défaut, si l'édition n'en a pas saisi (Répartition tables).
export const CONSIGNES = [
  "Récupérez votre badge à l'accueil en arrivant.",
  "Installation possible dès 8h00 le jour J.",
  "Un référent logistique passe en matinée pour vérifier votre stand.",
  "Les repas sont servis sur présentation du badge.",
];

export async function exportFiches(editionId, editionNom) {
  const [oe, els, salles] = await Promise.all([
    supa.from("organisme_editions").select("id, personnes_sam, personnes_dim, organismes(nom)")
      .eq("edition_id", editionId).contains("roles", ["partenaire"]),
    supa.from("elements").select("numero, organisme_edition_id, salle_id").eq("edition_id", editionId).eq("kind", "table"),
    supa.from("salles").select("id,nom").eq("edition_id", editionId),
  ]);
  if (oe.error) throw oe.error;
  const ed = await supa.from("editions").select("consignes_exposants").eq("id", editionId).single();
  const consignes = (ed.data?.consignes_exposants || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lignes = consignes.length ? consignes : CONSIGNES;
  const salleNom = (id) => (salles.data ?? []).find((s) => s.id === id)?.nom || "";
  const partners = (oe.data ?? []).filter((o) => o.organismes)
    .sort((a, b) => a.organismes.nom.localeCompare(b.organismes.nom, "fr"));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  partners.forEach((o, i) => {
    if (i > 0) doc.addPage();
    const tables = (els.data ?? []).filter((e) => e.organisme_edition_id === o.id);
    let y = 32;
    doc.setFont("helvetica", "bold"); doc.setFontSize(26); doc.setTextColor(30);
    doc.text(o.organismes.nom, 20, y); y += 18;
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(50);
    const emp = tables.length
      ? tables.map((t) => `${salleNom(t.salle_id)} — table n°${t.numero || "?"}`).join("   ·   ")
      : "Table non encore attribuée";
    doc.text("Emplacement : " + emp, 20, y, { maxWidth: 170 }); y += 12;
    doc.text(`Repas réservés : samedi ${o.personnes_sam || 0} · dimanche ${o.personnes_dim || 0}`, 20, y); y += 16;
    doc.setDrawColor(210); doc.line(20, y, 190, y); y += 12;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("Consignes d'accueil", 20, y); y += 9;
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(70);
    lignes.forEach((l) => {
      const morceaux = doc.splitTextToSize("•  " + l, 160);
      doc.text(morceaux, 24, y); y += 6 * morceaux.length + 3;
    });
  });
  if (!partners.length) { doc.setFontSize(12); doc.text("Aucun partenaire pour cette édition.", 20, 20); }
  doc.save(`fiches-accueil-${slug(editionNom)}.pdf`);
}
