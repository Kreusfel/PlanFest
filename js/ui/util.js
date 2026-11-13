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

// Date du jour au format AAAA-MM-JJ, en heure LOCALE (toISOString() donne l'heure
// UTC : entre minuit et 2 h à Paris, on obtenait la date de la veille).
export function aujourdhui() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Après un re-rendu complet, redonne le focus (et la position du curseur) à un champ
// recréé à l'identique — sinon une recherche se tape lettre par lettre.
export function refocus(root, selector, pos) {
  const el = root?.querySelector(selector);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(pos, pos); } catch { /* type sans curseur */ }
}

// Message bref en bas d'écran, non bloquant (remplace alert() sur les écrans de terrain).
// kind : "ok" | "err" (défaut "err").
export function toast(message, kind = "err") {
  let el = document.getElementById("pf-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "pf-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.className = "toast " + kind;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 5000);
}

// Fait télécharger un texte comme fichier (CSV, JSON…) par le navigateur.
export function telecharger(nom, texte, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([texte], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Nom de fichier à partir d'un libellé (« Fécamp 2027 » → « f-camp-2027 »).
export const slug = (s, defaut = "edition") => (s || defaut).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
