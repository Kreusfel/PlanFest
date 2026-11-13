-- ========================================================================
-- 031 — Sécurité (revue de code, vague 1). Nécessite 001..030.
--  1. Un compte désactivé perd ses droits d'admin et de responsable ;
--     un non-admin ne peut plus modifier l'e-mail de son profil.
--  2. Un responsable ne peut inviter qu'un simple membre, sans pôle.
--  3. Un bénévole lit sa propre inscription mais ne la modifie plus
--     (statut, équipes, repas, animateur : réservés aux gestionnaires).
--  4. Formulaires publics : pas d'auto-« traitée », date forcée, édition
--     non clôturée ; équipes demandées versées en note, jamais attribuées.
--  5. Une inscription publique ne peut plus être intégrée deux fois.
-- ========================================================================

-- 0. Garde-fou : il faut au moins un admin ACTIF, sinon plus personne ne
--    serait admin après cette migration. -----------------------------------
do $$ begin
  if not exists (select 1 from public.profils where role = 'admin' and actif) then
    raise exception 'Aucun admin actif : passer profils.actif = true pour un admin avant cette migration';
  end if;
end $$;

-- 1. Droits liés au compte ACTIF ------------------------------------------
create or replace function public.est_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and role = 'admin' and actif);
$$;

create or replace function public.est_responsable(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from responsables_pole rp
      join poles p on p.id = rp.pole_id
      join profils pr on pr.id = rp.profil_id
    where rp.profil_id = auth.uid() and p.code = p_code and pr.actif);
$$;

-- 1 bis. Un non-admin ne change ni son rôle, ni son statut, ni son e-mail de
--    profil (utilisé par l'invitation et la suppression de compte). ---------
create or replace function public.profils_garde() returns trigger
language plpgsql as $$
begin
  if not est_admin() and coalesce(auth.role(), '') <> 'service_role' then
    if new.role is distinct from old.role or new.actif is distinct from old.actif
       or new.email is distinct from old.email then
      raise exception 'Modification du rôle, du statut ou de l''e-mail réservée aux admins';
    end if;
  end if;
  return new;
end $$;

-- 2. Invitation par un responsable : membre, sans pôle ----------------------
drop policy if exists inv_resp_membre on public.invitations;
create policy inv_resp_membre on public.invitations for insert to authenticated
  with check (est_responsable('animateurs_benevoles') and role = 'membre' and pole_ids = '{}');

-- 3. Inscription d'un bénévole : lecture pour lui, écriture gestionnaires ---
drop policy if exists bened_acces on public.benevoles_editions;
create policy bened_lecture on public.benevoles_editions for select to authenticated
  using (gere_benevoles() or benevole_id = benevole_courant());
create policy bened_ecriture on public.benevoles_editions for all to authenticated
  using (gere_benevoles()) with check (gere_benevoles());

-- 4. Formulaires publics -----------------------------------------------------
-- Un envoi arrive toujours « non traité », daté par le serveur.
create or replace function public.inscription_publique_garde() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.traitee := false;
  new.recu_le := now();
  if new.edition_id is null
     or not exists (select 1 from editions where id = new.edition_id and etat <> 'cloturee') then
    raise exception 'edition invalide';
  end if;
  return new;
end $$;

drop trigger if exists t_insc_part_garde on public.inscriptions_partenaires;
create trigger t_insc_part_garde before insert on public.inscriptions_partenaires
  for each row execute function public.inscription_publique_garde();
drop trigger if exists t_insc_benv_garde on public.inscriptions_benevoles;
create trigger t_insc_benv_garde before insert on public.inscriptions_benevoles
  for each row execute function public.inscription_publique_garde();

-- 5. Intégration : une seule fois ; équipes demandées → note -----------------
create or replace function public.integrer_inscription_partenaire(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_partenaires%rowtype; v_org uuid; v_oe uuid;
begin
  if not (est_admin() or est_responsable('partenaires')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_partenaires where id = p_id for update;
  if not found then raise exception 'inscription introuvable'; end if;
  if ins.traitee then raise exception 'inscription deja integree'; end if;
  insert into organismes (nom, site, contact_nom, contact_email, contact_tel, notes)
  values (coalesce(ins.payload->>'nom', 'Sans nom'),
          -- seul un lien http(s) est conservé (pas de javascript:…)
          case when ins.payload->>'site' ~* '^https?://' then ins.payload->>'site' end,
          ins.payload->>'contact', ins.payload->>'email', ins.payload->>'tel', ins.payload->>'notes')
  returning id into v_org;
  insert into organisme_editions (organisme_id, edition_id, roles, statut,
    personnes_sam, personnes_dim, tables_souhaitees)
  values (v_org, ins.edition_id, array['partenaire']::text[], 'invite',
    coalesce((ins.payload->>'personnes_sam')::int, 0),
    coalesce((ins.payload->>'personnes_dim')::int, 0),
    coalesce((ins.payload->>'tables')::int, 0))
  returning id into v_oe;
  if coalesce(btrim(ins.payload->>'regime'), '') <> '' then
    insert into regimes (organisme_edition_id, texte) values (v_oe, btrim(ins.payload->>'regime'));
  end if;
  update inscriptions_partenaires set traitee = true where id = p_id;
  return v_oe;
end $$;

create or replace function public.integrer_inscription_benevole(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_benevoles%rowtype; v_b uuid; v_be uuid; v_note text;
begin
  if not (est_admin() or est_responsable('animateurs_benevoles')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_benevoles where id = p_id for update;
  if not found then raise exception 'inscription introuvable'; end if;
  if ins.traitee then raise exception 'inscription deja integree'; end if;
  insert into benevoles (nom, email, telephone, consentement_le)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'email', ins.payload->>'tel', now())
  returning id into v_b;
  -- Les équipes saisies sur le formulaire public ne sont PAS attribuées (certaines
  -- ouvrent des droits, ex. « accueil ») : elles sont versées en note, à valider.
  v_note := nullif(concat_ws(E'\n',
    case when coalesce(btrim(ins.payload->>'equipes'), '') <> ''
         then 'Équipes souhaitées : ' || btrim(ins.payload->>'equipes') end,
    nullif(btrim(ins.payload->>'notes'), '')), '');
  insert into benevoles_editions (benevole_id, edition_id, notes)
  values (v_b, ins.edition_id, v_note)
  returning id into v_be;
  if coalesce(btrim(ins.payload->>'regime'), '') <> '' then
    insert into regimes (benevole_edition_id, texte) values (v_be, btrim(ins.payload->>'regime'));
  end if;
  update inscriptions_benevoles set traitee = true where id = p_id;
  return v_be;
end $$;
