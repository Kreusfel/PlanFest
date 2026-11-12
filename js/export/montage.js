// Export « liste de montage » en PDF (jsPDF vendorisé) : par salle, nombre de
// tables par type, chaises, prises électriques demandées, tables sans partenaire.
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";

const TYPE_LBL = { partenaire: "Partenaire", jurande: "Jurande", non_attribuee: "À attribuer" };

export async function exportMontage(editionId, editionNom) {
  const [s, e, oe] = await Promise.all([
    supa.from("salles").select("*").eq("edition_id", editionId).order("nom"),
    supa.from("elements").select("*").eq("edition_id", editionId).eq("kind", "table"),
    supa.from("organisme_editions").select("id, electricite").eq("edition_id", editionId),
  ]);
  if (s.error || e.error) throw s.error || e.error;
  const elec = new Set((oe.data ?? []).filter((x) => x.electricite).map((x) => x.id));
  const salles = s.data ?? [], tables = e.data ?? [];

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 16;
  let y = 20;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text("Liste de montage", M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  y += 7; doc.text(editionNom || "", M, y);
  y += 10;

  for (const salle of salles) {
    const ts = tables.filter((t) => t.salle_id === salle.id);
    const byType = { partenaire: 0, jurande: 0, non_attribuee: 0 };
    let chaises = 0, prises = 0, sansPartenaire = 0;
    for (const t of ts) {
      byType[t.type_table] = (byType[t.type_table] || 0) + 1;
      chaises += t.chaises || 0;
      if (t.organisme_edition_id && elec.has(t.organisme_edition_id)) prises++;
      if (t.type_table === "partenaire" && !t.organisme_edition_id) sansPartenaire++;
    }
    if (y > 270) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`${salle.nom}  —  ${ts.length} table(s)`, M, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    const lignes = [
      `Par type : ${TYPE_LBL.partenaire} ${byType.partenaire} · ${TYPE_LBL.jurande} ${byType.jurande} · ${TYPE_LBL.non_attribuee} ${byType.non_attribuee}`,
      `Chaises : ${chaises}`,
      `Prises électriques demandées : ${prises}`,
      `Tables partenaire sans attribution : ${sansPartenaire}`,
    ];
    for (const l of lignes) { doc.text(l, M + 2, y); y += 6; }
    doc.setDrawColor(210); doc.line(M, y, W - M, y); y += 8;
  }
  if (!salles.length) { doc.text("Aucune salle.", M, y); }

  const nom = (editionNom || "edition").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save(`montage-${nom}.pdf`);
}
