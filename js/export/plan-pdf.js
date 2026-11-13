// Export du plan en PDF (toutes salles, une par page) ou PNG (salle courante).
// Modes : "numeros" (n° de table), "noms" (noms des partenaires), "couleurs" (sans texte).
import { jsPDF } from "../../vendor/jspdf.js";
import { supa } from "../supabase.js";
import { CELL, M } from "../plan/render.js";
import { esc, slug } from "../ui/util.js";

const trunc = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function style(e, info) {
  if (e.kind === "bloc") return { fill: "#E4E4E7", stroke: "#6B6B73", dash: "" };
  if (e.type_table === "partenaire") return { fill: info?.couleur || "#DBEAFE", stroke: "#94A3B8", dash: "" };
  if (e.type_table === "jurande") return e.mode === "libre"
    ? { fill: "#FFFFFF", stroke: "#111111", dash: ' stroke-dasharray="4 3"' }
    : { fill: "#FEF3C7", stroke: "#D4A72C", dash: "" };
  return { fill: "#FFFFFF", stroke: "#991B1B", dash: ' stroke-dasharray="4 3"' };
}

function buildSalleSVG(salle, els, mode, nameMap) {
  const W = salle.cols * CELL, H = salle.rows * CELL;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let i = 0; i <= salle.cols; i++) g += `<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#eee"/>`;
  for (let j = 0; j <= salle.rows; j++) g += `<line x1="0" y1="${j * CELL}" x2="${W}" y2="${j * CELL}" stroke="#eee"/>`;
  g += `<rect width="${W}" height="${H}" fill="none" stroke="#111" stroke-width="2"/>`;
  (els || []).forEach((e) => {
    const info = e.organisme_edition_id ? nameMap[e.organisme_edition_id] : null;
    const st = style(e, info), px = e.x * CELL, py = e.y * CELL, w = e.w * CELL, h = e.h * CELL;
    g += `<rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" rx="4" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.5"${st.dash}/>`;
    if (mode !== "couleurs") {
      let label = "";
      if (e.kind === "bloc") label = e.label || "";
      else if (mode === "noms") label = (info && info.nom) || e.numero || "";
      else label = e.numero || "";
      if (label) g += `<text x="${px + w / 2}" y="${py + h / 2 + 4}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="bold" fill="#111">${esc(trunc(label, Math.max(3, Math.floor(w / 7))))}</text>`;
    }
  });
  const vw = W + 2 * M, vh = H + 2 * M;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="0 0 ${vw} ${vh}"><g transform="translate(${M},${M})">${g}</g></svg>`, vw, vh };
}

function svgToPng(svgStr, scale = 2) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width * scale; c.height = img.height * scale;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/png"));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}

async function loadNames(editionId) {
  const { data } = await supa.from("organisme_editions").select("id, couleur, organismes(nom)").eq("edition_id", editionId);
  const m = {};
  (data ?? []).forEach((o) => { m[o.id] = { nom: o.organismes?.nom || "", couleur: o.couleur }; });
  return m;
}

export async function exportPlanPdf(editionId, salles, elementsOf, mode) {
  const nameMap = await loadNames(editionId);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageW = 297, pageH = 210, mx = 12, top = 18;
  let first = true;
  for (const s of salles) {
    const { svg, vw, vh } = buildSalleSVG(s, elementsOf(s.id), mode, nameMap);
    const png = await svgToPng(svg, 2);
    if (!first) doc.addPage();
    first = false;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(`${s.nom}  —  ${s.cols} × ${s.rows} m`, mx, 12);
    const aw = pageW - 2 * mx, ah = pageH - top - mx;
    const r = Math.min(aw / vw, ah / vh);
    doc.addImage(png, "PNG", mx + (aw - vw * r) / 2, top, vw * r, vh * r);
  }
  if (!salles.length) doc.text("Aucune salle.", 20, 20);
  doc.save("plan.pdf");
}

export async function exportPlanPng(editionId, salle, els, mode) {
  const nameMap = await loadNames(editionId);
  const { svg } = buildSalleSVG(salle, els, mode, nameMap);
  const png = await svgToPng(svg, 2);
  const a = document.createElement("a");
  a.href = png; a.download = `plan-${slug(salle.nom, "plan")}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}
