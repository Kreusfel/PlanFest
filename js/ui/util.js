export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[m]));
}

// Accord singulier / pluriel : plur(1,'jeu','jeux') → "1 jeu", plur(3,…) → "3 jeux".
export function plur(n, singulier, pluriel) {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

// Lien externe saisi par un tiers (site web d'un partenaire…) : seuls http(s) passent,
// pour qu'un « javascript:… » ne s'exécute jamais au clic. Retourne "" sinon.
export function safeUrl(u) {
  const s = String(u ?? "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}
