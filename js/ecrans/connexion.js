// Écran de connexion : se connecter, mot de passe oublié, choix du mot de passe.
// Pas de création de compte ici : on rejoint PlanFest uniquement par invitation e-mail.
import { signIn, resetPassword, setPassword } from "../auth.js";

// `erreurLien` : message renvoyé par Supabase quand un lien e-mail a échoué (souvent expiré).
export function render(c, erreurLien) {
  let mode = erreurLien ? "forgot" : "in"; // in | forgot

  function draw() {
    const withPass = mode !== "forgot";
    c.innerHTML = `<div class="centerbox"><div class="card auth">
      <h1>PlanFest</h1>
      <label>Email<input id="email" type="email" autocomplete="email" inputmode="email"></label>
      ${withPass ? `<label>Mot de passe<input id="pass" type="password"
        autocomplete="current-password"></label>` : ""}
      <button class="btn primary" id="go">${
        mode === "in" ? "Se connecter" : "Envoyer le lien"
      }</button>
      ${mode === "in" ? `<button class="link" id="forgot">Mot de passe oublié ?</button>` : ""}
      <p class="msg" id="msg" aria-live="polite"></p>
      ${mode === "in" ? `<p class="muted">Pas encore de compte ? Demande une invitation à un responsable :
        tu recevras un e-mail pour choisir ton mot de passe.</p>` : ""}
      ${mode === "forgot" ? `<button class="link" id="back">Retour à la connexion</button>` : ""}
    </div></div>`;

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
      const { error } = await signIn(email, pass);
      if (error) { msg.textContent = "Erreur : " + error.message; return; }
      msg.textContent = "Connexion…";
      // La connexion effective déclenche onAuthStateChange, qui réaffiche l'app.
    } catch (e) {
      msg.textContent = "Erreur réseau.";
    }
  }

  draw();
  if (erreurLien) {
    c.querySelector("#msg").textContent =
      "Ce lien n'est plus valable (" + erreurLien + "). Saisis ton e-mail pour en recevoir un nouveau, ou demande à un responsable de renvoyer l'invitation.";
  }
}

// Choix du mot de passe après un lien d'invitation (bienvenue) ou « mot de passe oublié ».
export function renderMotDePasse(c, invite, done) {
  c.innerHTML = `<div class="centerbox"><div class="card auth">
    <h1>${invite ? "Bienvenue sur PlanFest" : "Nouveau mot de passe"}</h1>
    <p class="muted">${invite ? "Choisis ton mot de passe pour finaliser ton compte." : "Choisis un nouveau mot de passe."}</p>
    <label>Mot de passe<input id="p1" type="password" autocomplete="new-password"></label>
    <label>Confirmer<input id="p2" type="password" autocomplete="new-password"></label>
    <button class="btn primary" id="go">Enregistrer</button>
    <p class="msg" id="msg" aria-live="polite"></p>
  </div></div>`;
  const msg = c.querySelector("#msg");
  c.querySelector("#go").onclick = async () => {
    const p1 = c.querySelector("#p1").value, p2 = c.querySelector("#p2").value;
    if (p1.length < 8) { msg.textContent = "8 caractères minimum."; return; }
    if (p1 !== p2) { msg.textContent = "Les deux mots de passe diffèrent."; return; }
    msg.textContent = "…";
    const { error } = await setPassword(p1);
    if (error) { msg.textContent = "Erreur : " + error.message; return; }
    done();
  };
}
