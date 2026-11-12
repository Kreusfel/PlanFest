export function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[m]));
}

// Accord singulier / pluriel : plur(1,'jeu','jeux') → "1 jeu", plur(3,…) → "3 jeux".
export function plur(n, singulier, pluriel) {
  return `${n} ${n > 1 ? pluriel : singulier}`;
}
