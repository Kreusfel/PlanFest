-- ========================================================================
-- 034 — Vues mobiles « Sur le terrain » (lecture seule). Nécessite 001..033.
-- terrain(p_edition) : tout ce qu'il faut pour consulter le jour J sur téléphone,
-- en un seul appel (gardé sur l'appareil pour la consultation hors ligne).
-- Tout compte actif : programme, permanences et plan, avec le NOM des animateurs
-- et des bénévoles de permanence — jamais leurs coordonnées.
-- ========================================================================
create or replace function public.terrain(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not est_actif() then raise exception 'acces refuse'; end if;

  select jsonb_build_object(
    'edition', (select jsonb_build_object('id', e.id, 'nom', e.nom, 'date_samedi', e.date_samedi,
                  'jours_actifs', e.jours_actifs)
                from editions e where e.id = p_edition),
    'moi', (select be.id from benevoles_editions be
             where be.edition_id = p_edition and be.benevole_id = benevole_courant()
               and be.statut <> 'annule'),
    'parties', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'jour', p.jour, 'debut', p.debut, 'fin', p.fin, 'places', p.places,
        'titre', p.titre, 'jeu', j.titre, 'element_id', p.element_id,
        'benevole_edition_id', p.benevole_edition_id, 'animateur', b.nom,
        'inscrits', coalesce((select sum(pi.nb) from partie_inscriptions pi where pi.partie_id = p.id), 0))
        order by p.jour, p.debut)
      from parties p
      left join jeux_editions je on je.id = p.jeu_edition_id
      left join jeux j on j.id = je.jeu_id
      left join benevoles_editions be on be.id = p.benevole_edition_id
      left join benevoles b on b.id = be.benevole_id
      where p.edition_id = p_edition), '[]'),
    'permanences', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pm.id, 'jour', pm.jour, 'debut', pm.debut, 'fin', pm.fin, 'poste', pm.poste,
        'element_id', pm.element_id, 'benevole_edition_id', pm.benevole_edition_id, 'benevole', b.nom)
        order by pm.jour, pm.debut)
      from permanences pm
      left join benevoles_editions be on be.id = pm.benevole_edition_id
      left join benevoles b on b.id = be.benevole_id
      where pm.edition_id = p_edition), '[]'),
    'salles', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nom', s.nom, 'cols', s.cols, 'rows', s.rows, 'ici_x', s.ici_x, 'ici_y', s.ici_y)
        order by s.cree_le)
      from salles s where s.edition_id = p_edition), '[]'),
    'elements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'salle_id', e.salle_id, 'kind', e.kind, 'x', e.x, 'y', e.y, 'w', e.w, 'h', e.h,
        'numero', e.numero, 'type_table', e.type_table, 'mode', e.mode,
        'sous', e.sous, 'label', e.label, 'nom', o.nom, 'couleur', oe.couleur))
      from elements e
      left join organisme_editions oe on oe.id = e.organisme_edition_id
      left join organismes o on o.id = oe.organisme_id
      where e.edition_id = p_edition), '[]'))
  into res;
  return res;
end $$;

revoke all on function public.terrain(uuid) from public, anon;
grant execute on function public.terrain(uuid) to authenticated;
