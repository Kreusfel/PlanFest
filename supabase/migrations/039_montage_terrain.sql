-- 039_montage_terrain.sql — PlanFest
-- Jour J : marquer une table « installée » puis « vérifiée » depuis le téléphone
-- (écran Sur le terrain → Plan). Rend juste l'indicateur « Tables non vérifiées ».
--   - peut_installer(p_edition) : admin, responsable d'un pôle, ou bénévole de l'édition
--     dans l'équipe Montage ou Logistique & sécurité ; compte actif obligatoire.
--   - maj_etat_terrain : mêmes droits (avant : admin et responsables seulement).
--   - terrain() : renvoie aussi l'état de chaque table et peut_installer.
-- Un changement d'état incrémente la version de la table : l'éditeur de plan ne peut
-- pas l'écraser avec une copie périmée (conflit détecté, rechargement).
-- Reprend les dernières définitions (009 pour maj_etat_terrain, 034 pour terrain).

create or replace function public.peut_installer(p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select est_actif() and (
    est_admin()
    or exists (select 1 from responsables_pole where profil_id = auth.uid())
    or a_equipe(p_edition, 'montage')
    or a_equipe(p_edition, 'logistique_securite'));
$$;
revoke all on function public.peut_installer(uuid) from public, anon;
grant execute on function public.peut_installer(uuid) to authenticated;

create or replace function public.maj_etat_terrain(p_element uuid, p_etat text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ed uuid;
begin
  if p_etat not in ('a_installer','installee','verifiee') then raise exception 'etat invalide'; end if;
  select edition_id into v_ed from elements where id = p_element and kind = 'table';
  if v_ed is null then raise exception 'table introuvable'; end if;
  if not peut_installer(v_ed) then raise exception 'acces refuse'; end if;
  update elements set etat_terrain = p_etat where id = p_element;
end $$;
revoke all on function public.maj_etat_terrain(uuid, text) from public, anon;
grant execute on function public.maj_etat_terrain(uuid, text) to authenticated;

create or replace function public.terrain(p_edition uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not est_actif() then raise exception 'acces refuse'; end if;

  select jsonb_build_object(
    'edition', (select jsonb_build_object('id', e.id, 'nom', e.nom, 'date_samedi', e.date_samedi,
                  'jours_actifs', e.jours_actifs)
                from editions e where e.id = p_edition),
    'peut_installer', peut_installer(p_edition),
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
        'sous', e.sous, 'label', e.label, 'nom', o.nom, 'couleur', oe.couleur,
        'etat_terrain', e.etat_terrain))
      from elements e
      left join organisme_editions oe on oe.id = e.organisme_edition_id
      left join organismes o on o.id = oe.organisme_id
      where e.edition_id = p_edition), '[]'))
  into res;
  return res;
end $$;

revoke all on function public.terrain(uuid) from public, anon;
grant execute on function public.terrain(uuid) to authenticated;
