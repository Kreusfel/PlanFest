-- ========================================================================
-- 033 — Données personnelles / RGPD (revue de code, vague 4). Nécessite 001..032.
--  1. purger_edition efface aussi : les formulaires publics bruts (e-mail,
--     téléphone, régime), les noms des inscrits aux parties, et les
--     coordonnées des bénévoles qui n'ont PAS accepté d'être recontactés
--     (s'ils n'ont ni compte ni inscription à une édition encore ouverte).
--  2. effacer_benevole efface aussi : ses formulaires publics, son
--     invitation et son compte de connexion (jamais un admin, jamais soi-même).
--  3. Carnet de contacts (comm_contacts) : lisible et modifiable par les pôles
--     qui s'en servent (communication, intergénérationnel) et les admins,
--     au lieu de tout compte actif. Le pôle intergénérationnel peut enfin y
--     ajouter des établissements (son écran le proposait, la base refusait).
-- ========================================================================

-- 1. Purge d'une édition ----------------------------------------------------
-- (le type de retour change : void → jsonb, d'où le drop préalable)
drop function if exists public.purger_edition(uuid);
create function public.purger_edition(p_edition uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_insc int; n_parties int; n_benev int;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;

  -- Déjà purgé avant 033 : régimes, présences, disponibilités.
  delete from regimes r using benevoles_editions be
    where r.benevole_edition_id = be.id and be.edition_id = p_edition;
  delete from regimes r using organisme_editions oe
    where r.organisme_edition_id = oe.id and oe.edition_id = p_edition;
  delete from presences p using benevoles_editions be
    where p.benevole_edition_id = be.id and be.edition_id = p_edition;
  delete from disponibilites d using benevoles_editions be
    where d.benevole_edition_id = be.id and be.edition_id = p_edition;

  -- Formulaires publics bruts (leurs données utiles ont été intégrées aux fiches).
  with a as (delete from inscriptions_benevoles where edition_id = p_edition returning 1),
       b as (delete from inscriptions_partenaires where edition_id = p_edition returning 1)
  select (select count(*) from a) + (select count(*) from b) into n_insc;

  -- Inscriptions aux parties : on garde le nombre de joueurs, plus le nom.
  update partie_inscriptions set nom = null where edition_id = p_edition and nom is not null;
  get diagnostics n_parties = row_count;

  -- Bénévoles de cette édition sans accord pour être recontactés : on efface
  -- e-mail et téléphone (le nom reste pour l'historique), sauf s'ils ont un
  -- compte PlanFest ou sont inscrits à une autre édition non clôturée.
  update benevoles b set email = null, telephone = null
   where not b.recontacter and b.profil_id is null
     and (b.email is not null or b.telephone is not null)
     and exists (select 1 from benevoles_editions be where be.benevole_id = b.id and be.edition_id = p_edition)
     and not exists (select 1 from benevoles_editions be join editions e on e.id = be.edition_id
                      where be.benevole_id = b.id and be.edition_id <> p_edition and e.etat <> 'cloturee');
  get diagnostics n_benev = row_count;

  return jsonb_build_object('formulaires', n_insc, 'noms_parties', n_parties, 'coordonnees_benevoles', n_benev);
end $$;

-- 2. Droit à l'effacement d'un bénévole -------------------------------------
create or replace function public.effacer_benevole(p_benevole uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text; v_profil uuid; v_role text;
begin
  if not est_admin() then raise exception 'acces refuse'; end if;
  select lower(email), profil_id into v_email, v_profil from benevoles where id = p_benevole;
  if not found then raise exception 'benevole introuvable'; end if;
  if v_profil is not null then
    if v_profil = auth.uid() then raise exception 'Tu ne peux pas effacer ta propre fiche'; end if;
    select role into v_role from profils where id = v_profil;
    if v_role = 'admin' then raise exception 'Cette personne est admin : la rétrograder avant de l''effacer'; end if;
  end if;

  if v_email is not null then
    delete from inscriptions_benevoles where lower(payload->>'email') = v_email;
    delete from invitations where lower(email) = v_email;
  end if;
  delete from benevoles where id = p_benevole;  -- cascade : inscriptions, dispos, présences, compétences
  if v_profil is not null then
    delete from auth.users where id = v_profil;  -- cascade : profil, rôles de pôle
  end if;
end $$;

-- 3. Carnet de contacts -----------------------------------------------------
drop policy if exists comm_contacts_lecture on public.comm_contacts;
drop policy if exists comm_contacts_ecriture on public.comm_contacts;
create policy comm_contacts_acces on public.comm_contacts for all to authenticated
  using (est_admin() or est_responsable('communication') or est_responsable('intergenerationnelle'))
  with check (est_admin() or est_responsable('communication') or est_responsable('intergenerationnelle'));

revoke all on function public.purger_edition(uuid) from public, anon;
grant execute on function public.purger_edition(uuid) to authenticated;
revoke all on function public.effacer_benevole(uuid) from public, anon;
grant execute on function public.effacer_benevole(uuid) to authenticated;
