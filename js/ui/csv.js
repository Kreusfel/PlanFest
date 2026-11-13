// Lecture de CSV collés ou importés (Excel, LibreOffice, Google Sheets).
// Séparateurs acceptés : virgule, point-virgule, tabulation ; guillemets « "" » gérés.
// Les lignes entièrement vides sont ignorées.
export function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  const finLigne = () => { row.push(field); if (row.some((v) => v.trim() !== "")) rows.push(row); row = []; field = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; finLigne(); }
    else field += c;
  }
  if (field !== "" || row.length) finLigne();
  return rows;
}

// Normalise un en-tête de colonne : sans accents, minuscules, lettres et chiffres seuls
// (« Code postal » → « codepostal »), pour reconnaître les variantes de nommage.
export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
