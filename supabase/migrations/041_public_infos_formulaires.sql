-- 041_public_infos_formulaires.sql — PlanFest
-- 1) Lieu / adresse du festival (editions.lieu), modifiable par Communication.
-- 2) edition_public : dates (jours actifs), horaires d'ouverture et lieu, pour le
--    bandeau « infos pratiques » des pages publiques.
-- 3) Intégration des formulaires publics enrichis :
--    - bénévole : disponibilités (grille), repas samedi / dimanche, accord pour être
--      recontacté l'an prochain ;
--    - partenaire : chaises, grilles, électricité, lien du logo.
--    Les nombres saisis de travers sont ignorés (plus d'erreur bloquante à l'intégration).
-- Reprend les dernières définitions : 017 (edition_public), 024 (maj_contenu_public),
-- 031 (integrer_inscription_*).

alter table public.editions add column if not exists lieu text;

-- Nombre entier « sûr » depuis un texte saisi par un visiteur (sinon 0).
create or replace function public.entier_saisi(p text)
returns int language sql immutable set search_path = public as $$
  select case when btrim(coalesce(p, '')) ~ '^\d{1,4}$' then btrim(p)::int else 0 end;
$$;

create or replace function public.edition_public(p_edition uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'nom', e.nom, 'date_samedi', e.date_samedi,
    'presentation', e.presentation, 'lieu', e.lieu, 'jours_actifs', e.jours_actifs,
    'horaires', coalesce((select jsonb_agg(jsonb_build_object('jour', h.jour,
        'debut', to_char(h.debut, 'HH24:MI'), 'fin', to_char(h.fin, 'HH24:MI')))
      from horaires_ouverture h where h.edition_id = e.id and h.debut is not null and h.fin is not null), '[]'))
  from editions e where e.id = p_edition and e.programme_publie;
$$;
grant execute on function public.edition_public(uuid) to anon, authenticated;

drop function if exists public.maj_contenu_public(uuid, text);
create or replace function public.maj_contenu_public(p_edition uuid, p_presentation text, p_lieu text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (est_admin() or est_responsable('communication')) then raise exception 'acces refuse'; end if;
  update editions set presentation = p_presentation, lieu = nullif(btrim(p_lieu), '') where id = p_edition;
end $$;
revoke all on function public.maj_contenu_public(uuid, text, text) from public, anon;
grant execute on function public.maj_contenu_public(uuid, text, text) to authenticated;

create or replace function public.integrer_inscription_benevole(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare ins inscriptions_benevoles%rowtype; v_b uuid; v_be uuid; v_note text;
begin
  if not (est_admin() or est_responsable('animateurs_benevoles')) then raise exception 'acces refuse'; end if;
  select * into ins from inscriptions_benevoles where id = p_id for update;
  if not found then raise exception 'inscription introuvable'; end if;
  if ins.traitee then raise exception 'inscription deja integree'; end if;
  insert into benevoles (nom, email, telephone, consentement_le, recontacter)
  values (coalesce(ins.payload->>'nom', 'Sans nom'), ins.payload->>'email', ins.payload->>'tel', now(),
          coalesce(ins.payload->>'recontacter', '') = 'oui')
  returning id into v_b;
  -- Les équipes saisies sur le formulaire public ne sont PAS attribuées (certaines
  -- ouvrent des droits, ex. « accueil ») : elles sont versées en note, à valider.
  v_note := nullif(concat_ws(E'\n',
    case when coalesce(btrim(ins.payload->>'equipes'), '') <> ''
         then 'Équipes souhaitées : ' || btrim(ins.payload->>'equipes') end,
    nullif(btrim(ins.payload->>'notes'), '')), '');
  insert into benevoles_editions (benevole_id, edition_id, notes, repas_sam, repas_dim)
  values (v_b, ins.edition_id, v_note,
          coalesce(ins.payload->>'repas_sam', '') = 'oui', coalesce(ins.payload->>'repas_dim', '') = 'oui')
  returning id into v_be;
  -- Disponibilités : liste « jour|demi-journée », seules les valeurs connues sont gardées.
  if jsonb_typeof(ins.payload->'dispos') = 'array' then
    insert into disponibilites (benevole_edition_id, jour, demi_journee, disponible)
    select distinct v_be, split_part(x, '|', 1), split_part(x, '|', 2), true
    from jsonb_array_elements_text(ins.payload->'dispos') x
    where x in ('ven|matin','ven|aprem','sam|matin','sam|aprem','dim|matin','dim|aprem','dim|soir');
  end if;
  if coalesce(btrim(ins.payload->>'regime'), '') <> '' then
    insert into regimes (benevole_edition_id, texte) values (v_be, btrim(ins.payload->>'regime'));
  end if;
  update inscriptions_benevoles set traitee = true where id = p_id;
  return v_be;
end $$;

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
    personnes_sam, personnes_dim, tables_souhaitees, chaises_souhaitees, grilles_souhaitees,
    electricite, logo_url)
  values (v_org, ins.edition_id, array['partenaire']::text[], 'invite',
    entier_saisi(ins.payload->>'personnes_sam'), entier_saisi(ins.payload->>'personnes_dim'),
    entier_saisi(ins.payload->>'tables'), entier_saisi(ins.payload->>'chaises'),
    entier_saisi(ins.payload->>'grilles'),
    coalesce(ins.payload->>'electricite', '') = 'oui',
    case when ins.payload->>'logo' ~* '^https?://' then ins.payload->>'logo' end)
  returning id into v_oe;
  if coalesce(btrim(ins.payload->>'regime'), '') <> '' then
    insert into regimes (organisme_edition_id, texte) values (v_oe, btrim(ins.payload->>'regime'));
  end if;
  update inscriptions_partenaires set traitee = true where id = p_id;
  return v_oe;
end $$;
