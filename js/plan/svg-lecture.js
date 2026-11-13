// Plan d'une salle en SVG, en LECTURE SEULE (page publique, vue « Sur le terrain »).
// L'éditeur de plan a son propre rendu interactif (render.js).
//  - salle : { cols, rows, ici_x?, ici_y? }   (1 case = 1 m)
//  - els   : éléments de la salle { id?, kind, x, y, w, h, numero, type_table, mode,
//            sous, label, nom (partenaire), couleur }
//  - options.surligner : id d'élément entouré en rouge (table recherchée)
//  - options.touchable : ajoute data-el="<id>" sur chaque élément (toucher → détail)
import { esc } from "../ui/util.js";

const CELL = 24, M = 16;

export function tableStyle(e) {
  if (e.kind === "bloc") return { fill: "#E4E4E7", stroke: "#6B6B73", dash: "" };
  if (e.type_table === "partenaire") return { fill: e.couleur || "#DBEAFE", stroke: "#94A3B8", dash: "" };
  if (e.type_table === "jurande") return e.mode === "libre"
    ? { fill: "#FFFFFF", stroke: "#111111", dash: ' stroke-dasharray="4 3"' }
    : { fill: "#FEF3C7", stroke: "#D4A72C", dash: "" };
  return { fill: "#FFFFFF", stroke: "#991B1B", dash: ' stroke-dasharray="4 3"' };
}

export function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

export function salleSVG(salle, els, options = {}) {
  const { surligner = null, touchable = false } = options;
  const W = salle.cols * CELL, H = salle.rows * CELL;
  let g = `<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (let i = 0; i <= salle.cols; i++) g += `<line x1="${i * CELL}" y1="0" x2="${i * CELL}" y2="${H}" stroke="#F1F1F3"/>`;
  for (let j = 0; j <= salle.rows; j++) g += `<line x1="0" y1="${j * CELL}" x2="${W}" y2="${j * CELL}" stroke="#F1F1F3"/>`;
  g += `<rect width="${W}" height="${H}" fill="none" stroke="#111" stroke-width="1.5"/>`;
  let halo = "";
  els.forEach((e) => {
    const px = e.x * CELL, py = e.y * CELL, w = e.w * CELL, h = e.h * CELL, s = tableStyle(e);
    const attr = touchable && e.id ? ` data-el="${esc(e.id)}" style="cursor:pointer"` : "";
    let el = `<rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" rx="3" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.3"${s.dash}/>`;
    const label = e.kind === "bloc" ? (e.label || e.sous || "") : (e.nom || e.numero || "");
    const sub = e.kind === "table" && e.nom && e.numero ? `n°${e.numero}` : "";
    const cx = px + w / 2;
    el += `<text x="${cx}" y="${py + h / 2 + (sub ? -1 : 4)}" text-anchor="middle" font-size="11" font-weight="600" fill="#111">${esc(trunc(label, Math.max(4, Math.floor(w / 7))))}</text>`;
    if (sub) el += `<text x="${cx}" y="${py + h / 2 + 11}" text-anchor="middle" font-size="9" fill="#52525B">${esc(sub)}</text>`;
    g += `<g${attr}>${el}</g>`;
    if (surligner && e.id === surligner) {
      // Dessiné en dernier pour passer au-dessus des voisins.
      halo = `<rect x="${px - 4}" y="${py - 4}" width="${w + 8}" height="${h + 8}" rx="6" fill="none" stroke="#DC2626" stroke-width="4"/>`;
    }
  });
  g += halo;
  if (salle.ici_x != null && salle.ici_y != null) {
    const ix = salle.ici_x * CELL, iy = salle.ici_y * CELL;
    g += `<g transform="translate(${ix},${iy})">
      <circle r="9" fill="#DC2626" stroke="#fff" stroke-width="2"/><circle r="3" fill="#fff"/>
      <text x="0" y="-13" text-anchor="middle" font-size="11" font-weight="700" fill="#DC2626" stroke="#fff" stroke-width="3" paint-order="stroke">Vous êtes ici</text></g>`;
  }
  return `<svg viewBox="0 0 ${W + 2 * M} ${H + 2 * M}" width="100%" style="max-width:${W + 2 * M}px;height:auto;display:block">
    <g transform="translate(${M},${M})">${g}</g></svg>`;
}
