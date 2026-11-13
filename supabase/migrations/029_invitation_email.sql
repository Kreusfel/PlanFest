-- ========================================================================
-- 029 — Invitations par e-mail (Edge Function « inviter »)
-- La fonction utilise la clé service_role pour activer un compte créé AVANT
-- son invitation (le trigger creer_profil ne joue qu'à la création du compte).
-- profils_garde laisse donc passer le rôle service_role, en plus des admins.
-- Nécessite 001.
-- ========================================================================
create or replace function public.profils_garde() returns trigger
language plpgsql as $$
begin
  if not est_admin() and coalesce(auth.role(), '') <> 'service_role' then
    if new.role is distinct from old.role or new.actif is distinct from old.actif then
      raise exception 'Modification du rôle ou du statut réservée aux admins';
    end if;
  end if;
  return new;
end $$;
