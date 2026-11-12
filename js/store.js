// État en mémoire minimal (Phase 0). S'enrichira avec le plan et le temps réel.
export const store = {
  editionId: localStorage.getItem("pf_edition") || null,
};

export function setEdition(id) {
  store.editionId = id || null;
  if (id) localStorage.setItem("pf_edition", id);
  else localStorage.removeItem("pf_edition");
}
