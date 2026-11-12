// Écran de connexion : se connecter, créer un compte (adresse invitée), mot de passe oublié.
import { signIn, signUp, resetPassword } from "../auth.js";

export function render(c) {
  let mode = "in"; // in | up | forgot

  function draw() {
    const withPass = mode !== "forgot";
    c.innerHTML = `<div class="centerbox"><div class="card auth">
      <h1>PlanFest</h1>
      <div class="tabs">
        <button data-m="in" class="${mode === "in" ? "on" : ""}">Connexion</button>
        <button data-m="up" class="${mode === "up" ? "on" : ""}">Créer mon compte</button>
      </div>
      <label>Email<input id="email" type="email" autocomplete="email" inputmode="email"></label>
      ${withPass ? `<label>Mot de passe<input id="pass" type="password"
        autocomplete="${mode === "up" ? "new-password" : "current-password"}"></label>` : ""}
      <button class="btn primary" id="go">${
        mode === "in" ? "Se connecter" : mode === "up" ? "Créer le compte" : "Envoyer le lien"
      }</button>
      ${mode === "in" ? `<button class="link" id="forgot">Mot de passe oublié ?</button>` : ""}
      <p class="msg" id="msg" aria-live="polite"></p>
      ${mode === "up" ? `<p class="muted">Seules les adresses invitées peuvent créer un compte.
        Tu recevras un e-mail de confirmation à valider.</p>` : ""}
      ${mode === "forgot" ? `<button class="link" id="back">Retour à la connexion</button>` : ""}
    </div></div>`;

    c.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    const fg = c.querySelector("#forgot");
    if (fg) fg.onclick = () => { mode = "forgot"; draw(); };
    const bk = c.querySelector("#back");
    if (bk) bk.onclick = () => { mode = "in"; draw(); };
    c.querySelector("#go").onclick = submit;
  }

  async function submit() {
    const msg = c.querySelector("#msg");
    const email = (c.querySelector("#email").value || "").trim();
    const pass = c.querySelector("#pass")?.value || "";
    msg.textContent = "…";
    try {
      if (mode === "forgot") {
        const { error } = await resetPassword(email);
        msg.textContent = error ? "Erreur : " + error.message : "E-mail de réinitialisation envoyé.";
        return;
      }
      if (!email || !pass) { msg.textContent = "Email et mot de passe requis."; return; }
      const { error } = mode === "in" ? await signIn(email, pass) : await signUp(email, pass);
      if (error) { msg.textContent = "Erreur : " + error.message; return; }
      msg.textContent = mode === "in" ? "Connexion…" : "Compte créé — confirme ton e-mail puis connecte-toi.";
      // La connexion effective déclenche onAuthStateChange, qui réaffiche l'app.
    } catch (e) {
      msg.textContent = "Erreur réseau.";
    }
  }

  draw();
}
