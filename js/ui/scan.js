// Scan d'un code-barre par la caméra arrière du téléphone, via l'API navigateur
// BarcodeDetector (disponible sur Chrome Android). Ailleurs (Safari/iOS, vieux navigateurs),
// l'API est absente : on le signale et on retombe sur la douchette ou la saisie à la main.
//   scanDisponible() → true si on peut proposer le bouton caméra.
//   ouvrirScan()     → ouvre la caméra en plein écran, résout avec les chiffres lus, ou null
//                      (annulation / caméra indisponible ou refusée).
//   fermerScan()     → coupe tout (caméra + overlay) ; appelé par l'unmount de l'écran.

import { toast } from "./util.js";

let actif = null;  // { stream, overlay, raf, resolve } quand un scan est en cours

export function scanDisponible() {
  return "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia;
}

// Ferme le scan en cours (s'il y en a un) et résout sa promesse avec `code` (ou null).
export function fermerScan(code = null) {
  if (!actif) return;
  const { stream, overlay, raf, resolve } = actif;
  actif = null;
  if (raf) cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  overlay?.remove();
  resolve(code);
}

export async function ouvrirScan() {
  if (actif) fermerScan(null);  // un seul scan à la fois
  if (!scanDisponible()) {
    toast("Scan caméra non disponible sur ce navigateur : utilise la douchette ou tape le code.");
    return null;
  }
  // L'accès caméra exige une page en HTTPS et l'autorisation de l'utilisateur.
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    toast("Caméra indisponible ou refusée : autorise l'accès, ou tape le code à la main.");
    return null;
  }

  // On ne demande que les formats de boîtes de jeux réellement supportés (sinon le
  // constructeur peut lever). À défaut de liste, on laisse BarcodeDetector tout détecter.
  const voulus = ["ean_13", "ean_8", "upc_a", "upc_e"];
  let formats = voulus;
  try { const sup = await BarcodeDetector.getSupportedFormats(); formats = voulus.filter((f) => sup.includes(f)); } catch { /* ignore */ }
  let detector;
  try { detector = new BarcodeDetector(formats.length ? { formats } : undefined); }
  catch { stream.getTracks().forEach((t) => t.stop()); toast("Lecteur de code-barre non supporté ici."); return null; }

  const overlay = document.createElement("div");
  overlay.className = "scan-cam";
  overlay.innerHTML = `
    <div class="scan-cam-head"><span>Vise le code-barre du jeu</span>
      <button class="btn small" type="button" data-scan-annuler aria-label="Fermer le scanner">Annuler</button></div>
    <div class="scan-cam-stage"><video class="scan-cam-video" playsinline muted></video><div class="scan-cam-cadre" aria-hidden="true"></div></div>`;
  document.body.appendChild(overlay);
  const video = overlay.querySelector("video");
  video.srcObject = stream;
  await video.play().catch(() => { /* lecture auto parfois bloquée : la détection marche quand même */ });

  return new Promise((resolve) => {
    actif = { stream, overlay, raf: null, resolve };
    overlay.querySelector("[data-scan-annuler]").addEventListener("click", () => fermerScan(null));
    const lire = async () => {
      if (!actif) return;
      try {
        const codes = await detector.detect(video);
        const trouve = codes.map((c) => (c.rawValue || "").replace(/\D/g, "")).find((v) => v.length >= 6);
        if (trouve) return fermerScan(trouve);
      } catch { /* image pas encore prête : on réessaie à la frame suivante */ }
      if (actif) actif.raf = requestAnimationFrame(lire);
    };
    actif.raf = requestAnimationFrame(lire);
  });
}
