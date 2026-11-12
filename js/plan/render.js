// Rendu SVG du plan, aligné sur la maquette. 1 case = 1 m (CELL px).
import { esc } from "../ui/util.js";
import { plan, salleElements, overlap } from "./model.js";

export const CELL = 40, M = 30;

export const BLOCS = {
  accueil:  { label: "Accueil",        w: 4, h: 3 },
  buvette:  { label: "Buvette",        w: 5, h: 3 },
  repas:    { label: "Zone repas",     w: 8, h: 4 },
  scene:    { label: "Scène",          w: 6, h: 3 },
  boutique: { label: "Boutique",       w: 4, h: 3 },
  entree:   { label: "Entrée / Sortie",w: 4, h: 1 },
  wc:       { label: "WC",             w: 2, h: 2 },
  mur:      { label: "Mur / cloison",  w: 1, h: 8 },
  texte:    { label: "Texte libre",    w: 6, h: 1 },
  autre:    { label: "Repère",         w: 3, h: 2 },
};

// Couleurs des tables par type (maquette)
function tableStyle(t) {
  if (t.type_table === "partenaire") return { fill: "#a9c6e8", stroke: "#5b82b5", dash: "" };
  if (t.type_table === "jurande")
    return t.mode === "libre"
      ? { fill: "var(--surface)", stroke: "var(--navy)", dash: ' stroke-dasharray="5 4"' }
      : { fill: "#fbdd85", stroke: "#d9a93a", dash: "" };
  return { fill: "var(--surface)", stroke: "#b4453f", dash: ' stroke-dasharray="5 4"' }; // non_attribuee
}

function selUI(w, h, single) {
  let o = `<rect x="-4" y="-4" width="${w + 8}" height="${h + 8}" rx="9" fill="none" style="stroke:var(--navy)" stroke-width="2.5" pointer-events="none"/>`;
  if (single)
    o += `<rect data-handle="1" x="${w - 8}" y="${h - 8}" width="16" height="16" rx="4" style="fill:var(--amber);stroke:var(--surface)" stroke-width="2" cursor="nwse-resize"/>`;
  return o;
}

function tableSVG(t, sel, single, bad) {
  const px = t.w * CELL, py = t.h * CELL, cx = px / 2, cy = py / 2;
  const s = tableStyle(t);
  const label = t.type_table === "non_attribuee" && !t.numero ? "?" : (t.numero ?? "");
  let h = `<g data-id="${t.id}" transform="translate(${t.x * CELL},${t.y * CELL})" style="cursor:move">`;
  h += `<rect x="1.5" y="1.5" width="${px - 3}" height="${py - 3}" rx="5" style="fill:${s.fill};stroke:${bad ? "var(--alert)" : s.stroke}" stroke-width="${sel ? 3 : 2}"${s.dash}/>`;
  h += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="var(--mono)" font-size="15" font-weight="700" style="fill:var(--ink)">${esc(label)}</text>`;
  if (bad) h += `<text x="${px - 9}" y="13" text-anchor="middle" font-size="12" font-weight="700" style="fill:var(--alert)">!</text>`;
  if (sel) h += selUI(px, py, single);
  return h + "</g>";
}

function blocSVG(b, sel, single) {
  const cfg = BLOCS[b.sous] || BLOCS.autre, px = b.w * CELL, py = b.h * CELL, cx = px / 2, cy = py / 2;
  let h = `<g data-id="${b.id}" transform="translate(${b.x * CELL},${b.y * CELL})" style="cursor:move">`;
  if (b.sous === "texte") {
    h += `<rect width="${px}" height="${py}" fill="transparent"/>`;
    h += `<text x="4" y="${py / 2 + 5}" font-family="var(--display)" font-size="15" font-weight="700" style="fill:var(--ink)">${esc(b.label || "Texte")}</text>`;
    h += `<line x1="2" x2="${px - 2}" y1="${py - 3}" y2="${py - 3}" style="stroke:var(--ink)" stroke-width="1.5"/>`;
  } else if (b.sous === "mur") {
    h += `<rect width="${px}" height="${py}" rx="2" fill="url(#hatch)" style="stroke:var(--line-strong)" stroke-width="1.5"/>`;
  } else {
    h += `<rect x="1" y="1" width="${px - 2}" height="${py - 2}" rx="7" style="fill:var(--grey);stroke:var(--line-strong)" stroke-width="2"/>`;
    h += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="var(--font)" font-size="13" font-weight="700" style="fill:var(--ink-2)">${esc(b.label || cfg.label)}</text>`;
  }
  if (sel) h += selUI(px, py, single);
  return h + "</g>";
}

export function renderPlan(layer, svg, salle) {
  const W = salle.cols * CELL, H = salle.rows * CELL;
  const els = salleElements(salle.id), single = plan.sel.size === 1;
  const tables = els.filter((e) => e.kind === "table");
  let h = "";
  const ink3 = 'style="fill:var(--ink-3)" font-family="var(--mono)" font-size="10"';
  for (let i = 0; i <= salle.cols; i += 5) h += `<text x="${M + i * CELL}" y="${M - 10}" text-anchor="middle" ${ink3}>${i}</text>`;
  for (let j = 0; j <= salle.rows; j += 5) h += `<text x="${M - 8}" y="${M + j * CELL + 3}" text-anchor="end" ${ink3}>${j}</text>`;
  h += `<text x="${M + W + 4}" y="${M - 10}" ${ink3}>m</text>`;
  h += `<g transform="translate(${M},${M})">`;
  h += `<rect width="${W}" height="${H}" style="fill:var(--surface)"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g5)"/>`;
  h += `<rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" fill="none" style="stroke:var(--navy)" stroke-width="4"/>`;
  els.filter((e) => e.kind === "bloc").forEach((b) => (h += blocSVG(b, plan.sel.has(b.id), single)));
  tables.forEach((t) => {
    const bad = tables.some((o) => o !== t && overlap(t, o));
    h += tableSVG(t, plan.sel.has(t.id), single, bad);
  });
  h += "</g>";
  layer.innerHTML = h;
  svg.setAttribute("viewBox", `0 0 ${W + 2 * M} ${H + 2 * M}`);
}
