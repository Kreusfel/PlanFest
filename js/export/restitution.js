// Bon de restitution (PDF, jsPDF) : pour un prêteur (ludothèque, bar à jeux, boutique…),
// la liste des jeux prêtés pour le festival, avec cases à cocher, date et signatures.
// `jeux` = [{ titre, exemplaires, rendu }] (préparés par l'écran Jeux).
import { jsPDF } from "../../vendor/jspdf.js";
import { slug } from "../ui/util.js";

export function bonRestitution(preteur, editionNom, jeux) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 18, W = 210;
  let y = 22;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(30);
  doc.text("Bon de restitution", M, y); y += 9;
  doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(60);
  doc.text(`${editionNom || ""} — La Jurande des Conte-Brumes`, M, y); y += 7;
  doc.setFont("helvetica", "bold"); doc.setTextColor(30);
  doc.text(`Prêteur : ${preteur}`, M, y); y += 10;

  doc.setFontSize(10); doc.setTextColor(90);
  doc.text("Rendu", M, y); doc.text("Jeu", M + 18, y); doc.text("Exemplaires", W - M - 24, y);
  y += 3; doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 7;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(40);
  jeux.forEach((j) => {
    if (y > 250) { doc.addPage(); y = 22; }
    doc.setDrawColor(120); doc.rect(M + 2, y - 4, 5, 5);
    if (j.rendu) { doc.setFont("helvetica", "bold"); doc.text("x", M + 3.2, y); doc.setFont("helvetica", "normal"); }
    const lignes = doc.splitTextToSize(j.titre, W - 2 * M - 50);
    doc.text(lignes, M + 18, y);
    doc.text(String(j.exemplaires || 1), W - M - 14, y);
    y += 7 * lignes.length;
  });
  y += 8;
  if (y > 240) { doc.addPage(); y = 30; }
  doc.setFontSize(11);
  doc.text("Rendu le : ____ / ____ / ________", M, y); y += 16;
  doc.text("Pour le prêteur (nom, signature) :", M, y);
  doc.text("Pour la Jurande (nom, signature) :", W / 2 + 4, y);
  doc.save(`restitution-${slug(preteur)}.pdf`);
}
