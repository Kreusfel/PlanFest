-- ========================================================================
-- 030 — Suppression d'un compte par un admin (écran Administration)
-- Supprime l'utilisateur Supabase (auth.users). En cascade : profils,
-- responsables_pole. Mis à NULL : benevoles.profil_id (la fiche bénévole est
-- conservée), cree_par / saisi_par (l'historique reste).
-- L'invitation de l'adresse est aussi supprimée, pour pouvoir réinviter.
-- Garde-fous : admin uniquement, pas soi-même, pas le dernier admin.
-- Nécessite 001.
-- ========================================================================
create or replace function public.supprimer_compte(p_profil uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_email text; v_role text;
begin
  if not est_admin() then
    raise exception 'Suppression de compte réservée aux admins';
  end if;
  if p_profil = auth.uid() then
    raise exception 'Tu ne peux pas supprimer ton propre compte';
  end if;
  select email, role into v_email, v_role from profils where id = p_profil;
  if not found then
    raise exception 'Compte introuvable';
  end if;
  if v_role = 'admin' and (select count(*) from profils where role = 'admin' and actif) <= 1 then
    raise exception 'Impossible de supprimer le dernier admin';
  end if;
  delete from invitations where lower(email) = lower(v_email);
  delete from auth.users where id = p_profil;
end $$;

revoke all on function public.supprimer_compte(uuid) from public, anon;
grant execute on function public.supprimer_compte(uuid) to authenticated;
