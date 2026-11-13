// Export étiquettes de table en PDF (jsPDF) : 8 par page A4, numéro + partenaire + bande couleur.
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";
import { slug } from "../ui/util.js";

function hexToRgb(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [200, 200, 200];
}

export async function exportEtiquettes(editionId, editionNom) {
  const [els, oe] = await Promise.all([
    supa.from("elements").select("numero, organisme_edition_id").eq("edition_id", editionId).eq("kind", "table").eq("type_table", "partenaire"),
    supa.from("organisme_editions").select("id, couleur, organismes(nom)").eq("edition_id", editionId),
  ]);
  if (els.error) throw els.error;
  const map = {}; (oe.data ?? []).forEach((o) => (map[o.id] = { nom: o.organismes?.nom || "", couleur: o.couleur || "#cccccc" }));
  const tables = (els.data ?? []).sort((a, b) => (parseInt(a.numero, 10) || 0) - (parseInt(b.numero, 10) || 0));

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cols = 2, rows = 4, W = 210, H = 297, mx = 10, my = 12;
  const cw = (W - 2 * mx) / cols, ch = (H - 2 * my) / rows, per = cols * rows;

  tables.forEach((t, i) => {
    if (i > 0 && i % per === 0) doc.addPage();
    const idx = i % per, cx = mx + (idx % cols) * cw, cy = my + Math.floor(idx / cols) * ch;
    const info = map[t.organisme_edition_id] || { nom: "", couleur: "#cccccc" };
    doc.setDrawColor(200); doc.rect(cx + 2, cy + 2, cw - 4, ch - 4);
    const rgb = hexToRgb(info.couleur); doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.rect(cx + 2, cy + 2, cw - 4, 9, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(46); doc.setTextColor(40);
    doc.text(String(t.numero || "?"), cx + cw / 2, cy + ch / 2 + 6, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(60);
    doc.text(info.nom || "(à attribuer)", cx + cw / 2, cy + ch - 10, { align: "center", maxWidth: cw - 12 });
  });
  if (!tables.length) { doc.setFontSize(12); doc.text("Aucune table partenaire dans le plan.", 14, 20); }
  doc.save(`etiquettes-${slug(editionNom)}.pdf`);
}
