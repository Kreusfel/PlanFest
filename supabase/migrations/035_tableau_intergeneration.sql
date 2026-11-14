-- 035_tableau_intergeneration.sql — PlanFest
-- Tableau de bord, carte « Intergénérationnelle » : ses propres indicateurs
-- (écoles et établissements confirmés, personnes attendues le vendredi) au lieu
-- du nombre de bénévoles disponibles le vendredi (qui relève du pôle bénévoles).
-- Reprend la dernière définition (019) ; seul le bloc intergénérationnel change.

create or replace function public.tableau_de_bord(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb := '{}';
begin
  if not est_actif() then raise exception 'acces refuse'; end if;

  res := res || jsonb_build_object('partenaires', jsonb_build_object(
    'confirmes', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut = 'confirme'),
    'a_relancer', (select count(*) from organisme_editions where edition_id = p_edition and 'partenaire' = any (roles) and statut in ('invite','relance')),
    'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee')));

  res := res || jsonb_build_object('jeux_editeurs', jsonb_build_object(
    'editeurs_sans_reponse', (select count(*) from organisme_editions where edition_id = p_edition and 'editeur' = any (roles) and statut in ('invite','relance')),
    'jeux_demandes', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'demande'),
    'jeux_recus', (select count(*) from jeux_editions where edition_id = p_edition and statut = 'recu')));

  res := res || jsonb_build_object('sponsors', jsonb_build_object(
    'dossiers_attente', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose')),
    'echeances_30j', (select count(*) from subventions where edition_id = p_edition and statut in ('a_faire','depose') and echeance between current_date and current_date + 30)));

  res := res || jsonb_build_object('logistique_securite', jsonb_build_object(
    'tables_non_attribuees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and type_table = 'non_attribuee'),
    'tables_non_verifiees', (select count(*) from elements where edition_id = p_edition and kind = 'table' and etat_terrain <> 'verifiee')));

  res := res || jsonb_build_object('buvette_catering',
    coalesce((select jsonb_object_agg(j_code, nb_total) from repas_par_jour(p_edition, true)), '{}'::jsonb));

  res := res || jsonb_build_object('animateurs_benevoles', jsonb_build_object(
    'benevoles', (select count(*) from benevoles_editions where edition_id = p_edition and statut <> 'annule'),
    'confirmes', (select count(*) from benevoles_editions where edition_id = p_edition and statut = 'confirme'),
    'animateurs', (select count(*) from benevoles_editions where edition_id = p_edition and est_animateur and statut <> 'annule'),
    'alertes', (select count(*) from alertes_parties where edition_id = p_edition)));

  res := res || jsonb_build_object('communication', jsonb_build_object(
    'confirmes_sans_logo', (select count(*) from organisme_editions where edition_id = p_edition and statut = 'confirme' and (logo_url is null or logo_url = '')),
    'programme_publie', (select programme_publie from editions where id = p_edition)));

  res := res || jsonb_build_object('intergenerationnelle', jsonb_build_object(
    'ecoles_confirmees', (select count(*) from vendredi_participants vp join comm_contacts c on c.id = vp.contact_id
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu') and c.type = 'École'),
    'etablissements_confirmes', (select count(*) from vendredi_participants vp join comm_contacts c on c.id = vp.contact_id
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu') and coalesce(c.type, '') <> 'École'),
    'personnes_attendues', (select coalesce(sum(vp.effectif), 0) from vendredi_participants vp
      where vp.edition_id = p_edition and vp.statut in ('confirme','venu'))));

  return res;
end $$;
