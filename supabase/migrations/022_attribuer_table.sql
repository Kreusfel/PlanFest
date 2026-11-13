-- 022_attribuer_table.sql — PlanFest
-- Répartition : le pôle Partenaires attribue un partenaire à une table partenaire.
-- La logistique pose les tables (structure) ; les partenaires les répartissent.
-- RPC dédié (security definer) pour ouvrir cette seule action sans donner les
-- droits d'édition du plan (qui restent logistique/admin). Nécessite 001..003.

create or replace function public.attribuer_table_partenaire(
  p_element uuid, p_organisme_edition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_edition uuid;
begin
  if not (est_admin() or est_responsable('partenaires') or est_responsable('logistique_securite')) then
    raise exception 'acces refuse';
  end if;
  select edition_id into v_edition from elements
   where id = p_element and kind = 'table' and type_table = 'partenaire';
  if v_edition is null then
    raise exception 'Table partenaire introuvable';
  end if;
  if p_organisme_edition is not null and not exists (
      select 1 from organisme_editions
       where id = p_organisme_edition and edition_id = v_edition) then
    raise exception 'Partenaire hors edition';
  end if;
  -- Le trigger touch_version incrémente version/maj_le automatiquement.
  update elements set organisme_edition_id = p_organisme_edition where id = p_element;
end $$;

grant execute on function public.attribuer_table_partenaire(uuid, uuid) to authenticated;
