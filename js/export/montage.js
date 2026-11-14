// Export « liste de montage » en PDF (jsPDF vendorisé) : par salle, nombre de
// tables par type, chaises, prises électriques demandées, tables sans partenaire ;
// puis les demandes de chaque partenaire confirmé (tables, chaises, grilles, électricité).
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";

const TYPE_LBL = { partenaire: "Partenaire", jurande: "Jurande", non_attribuee: "À attribuer" };

export async function exportMontage(editionId, editionNom) {
  const [s, e, oe] = await Promise.all([
    supa.from("salles").select("*").eq("edition_id", editionId).order("nom"),
    supa.from("elements").select("*").eq("edition_id", editionId).eq("kind", "table"),
    supa.from("organisme_editions").select("id, statut, roles, electricite, tables_souhaitees, chaises_souhaitees, grilles_souhaitees, organismes(nom)").eq("edition_id", editionId),
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

  // Demandes des partenaires confirmés (fiche Organisme → Matériel souhaité).
  const parts = (oe.data ?? []).filter((o) => (o.roles || []).includes("partenaire") && o.statut === "confirme")
    .sort((a, b) => (a.organismes?.nom || "").localeCompare(b.organismes?.nom || "", "fr"));
  if (parts.length) {
    const placees = (id) => tables.filter((t) => t.organisme_edition_id === id).length;
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("Demandes des partenaires confirmés", M, y); y += 7;
    doc.setFontSize(10);
    const X = [M + 2, 100, 128, 148, 168];
    ["Partenaire", "Tables", "Chaises", "Grilles", "Électricité"].forEach((h, i) => doc.text(h, X[i], y));
    y += 5; doc.setFont("helvetica", "normal");
    let tot = { t: 0, c: 0, g: 0, e: 0 };
    for (const o of parts) {
      if (y > 280) { doc.addPage(); y = 20; }
      const pl = placees(o.id), sh = o.tables_souhaitees || 0;
      doc.text(o.organismes?.nom || "?", X[0], y, { maxWidth: X[1] - X[0] - 4 });
      doc.text(`${pl}/${sh}`, X[1], y);
      doc.text(String(o.chaises_souhaitees || 0), X[2], y);
      doc.text(String(o.grilles_souhaitees || 0), X[3], y);
      doc.text(o.electricite ? "oui" : "—", X[4], y);
      tot.t += sh; tot.c += o.chaises_souhaitees || 0; tot.g += o.grilles_souhaitees || 0; tot.e += o.electricite ? 1 : 0;
      y += 5.5;
    }
    doc.setDrawColor(210); doc.line(M, y - 3, W - M, y - 3); y += 2;
    doc.setFont("helvetica", "bold");
    doc.text(`Total : ${tot.t} tables · ${tot.c} chaises · ${tot.g} grilles · ${tot.e} branchement(s)`, M + 2, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); y += 5;
    doc.text("Tables : placées sur le plan / souhaitées.", M + 2, y);
  }

  const nom = (editionNom || "edition").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save(`montage-${nom}.pdf`);
}
