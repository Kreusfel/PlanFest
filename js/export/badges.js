// Export « badges exposants » en PDF (jsPDF) : 8 par page A4, un badge par personne
// présente (fiche Organisme → « Noms (pour les étiquettes) », un nom par ligne).
// Partenaires confirmés seulement ; bande de la couleur du partenaire.
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";
import { slug } from "../ui/util.js";

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 200, 200];
}

export async function exportBadges(editionId, editionNom) {
  const { data, error } = await supa.from("organisme_editions")
    .select("couleur, statut, roles, noms_personnes, organismes(nom)").eq("edition_id", editionId);
  if (error) throw error;
  const badges = [];
  (data ?? []).filter((o) => (o.roles || []).includes("partenaire") && o.statut === "confirme")
    .sort((a, b) => (a.organismes?.nom || "").localeCompare(b.organismes?.nom || "", "fr"))
    .forEach((o) => (o.noms_personnes || "").split(/\r?\n/).map((n) => n.trim()).filter(Boolean)
      .forEach((nom) => badges.push({ nom, org: o.organismes?.nom || "", couleur: o.couleur })));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cols = 2, rows = 4, W = 210, H = 297, mx = 10, my = 12;
  const cw = (W - 2 * mx) / cols, ch = (H - 2 * my) / rows, per = cols * rows;
  badges.forEach((b, i) => {
    if (i > 0 && i % per === 0) doc.addPage();
    const idx = i % per, cx = mx + (idx % cols) * cw, cy = my + Math.floor(idx / cols) * ch;
    doc.setDrawColor(200); doc.rect(cx + 2, cy + 2, cw - 4, ch - 4);   // trait de coupe
    const rgb = hexToRgb(b.couleur); doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(cx + 2, cy + 2, cw - 4, 9, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(60);
    doc.text("EXPOSANT", cx + cw / 2, cy + 8, { align: "center" });
    doc.setFontSize(22); doc.setTextColor(30);
    doc.text(b.nom, cx + cw / 2, cy + ch / 2, { align: "center", maxWidth: cw - 12 });
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(80);
    doc.text(b.org, cx + cw / 2, cy + ch / 2 + 12, { align: "center", maxWidth: cw - 12 });
    doc.setFontSize(9); doc.setTextColor(120);
    doc.text(editionNom || "", cx + cw / 2, cy + ch - 8, { align: "center", maxWidth: cw - 12 });
  });
  if (!badges.length) {
    doc.setFontSize(12);
    doc.text("Aucun nom saisi : remplir « Noms (pour les étiquettes) » sur les fiches des partenaires confirmés.", 14, 20, { maxWidth: 180 });
  }
  doc.save(`badges-${slug(editionNom)}.pdf`);
}
