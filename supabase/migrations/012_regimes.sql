-- 012_regimes.sql — PlanFest. Saisie des régimes depuis les fiches + formulaires publics.
-- Écritures via RPC (security definer) pour permettre l'édition par le bon pôle sans
-- assouplir la RLS de `regimes`. Nécessite 001..011.

-- Régime d'un bénévole (un seul texte par bénévole-édition ; vide = efface)
create or replace function public.definir_regime_benevole(p_benevole_edition uuid, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare v_b uuid;
begin
  select benevole_id into v_b from benevoles_editions where id = p_benevole_edition;
  if v_b is null then raise exception 'inscription introuvable'; end if;
  if not (est_admin() or est_responsable('animateurs_benevoles') or v_b = benevole_courant()) then
    raise exception 'acces refuse';
  end if;
  delete from regimes where benevole_edition_id = p_benevole_edition;
  if coalesce(btrim(p_texte), '') <> '' then
    insert into regimes (benevole_edition_id, texte) values (p_benevole_edition, btrim(p_texte));
  end if;
end $$;

-- Régime d'un organisme (partenaire)
create or replace function public.definir_regime_organisme(p_organisme_edition uuid, p_texte text)
returns void language plpgsql security definer set search_path = public as $$
declare v_roles text[];
begin
  select roles into v_roles from organisme_editions where id = p_organisme_edition;
  if v_roles is null then raise exception 'introuvable'; end if;
  if not peut_ecrire_organisme(v_roles) then raise exception 'acces refuse'; end if;
  delete from regimes where organisme_edition_id = p_organisme_edition;
  if coalesce(btrim(p_texte), '') <> '' then
    insert into regimes (organisme_edition_id, texte) values (p_organisme_edition, btrim(p_texte));
  end if;
end $$;

-- Intégration des inscriptions : reprend aussi le régime saisi dans le formulaire.
create or replace function public.integrer_inscription_partenaire(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_partenaires%rowtype; v_org uuid; v_oe uuid;
begin
  if not (est_admin() or est_responsable('partenaires')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_partenaires where id = p_id;
  if not found then raise exception 'inscription introuvable'; end if;
  insert into organismes (nom, site, contact_nom, contact_email, contact_tel, notes)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'site',
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
declare ins inscriptions_benevoles%rowtype; v_b uuid; v_be uuid;
begin
  if not (est_admin() or est_responsable('animateurs_benevoles')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_benevoles where id = p_id;
  if not found then raise exception 'inscription introuvable'; end if;
  insert into benevoles (nom, email, telephone, consentement_le)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'email', ins.payload->>'tel', now())
  returning id into v_b;
  insert into benevoles_editions (benevole_id, edition_id, equipes)
  values (v_b, ins.edition_id,
    coalesce(string_to_array(nullif(ins.payload->>'equipes', ''), ','), '{}')::text[])
  returning id into v_be;
  if coalesce(btrim(ins.payload->>'regime'), '') <> '' then
    insert into regimes (benevole_edition_id, texte) values (v_be, btrim(ins.payload->>'regime'));
  end if;
  update inscriptions_benevoles set traitee = true where id = p_id;
  return v_be;
end $$;
