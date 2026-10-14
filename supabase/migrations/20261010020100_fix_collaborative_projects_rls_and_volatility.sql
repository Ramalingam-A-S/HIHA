-- ================================================================
-- MIGRATION: Fix Collaborative Projects Helper Volatility & Direct RLS Checks
-- Description:
--   1. Marks helper functions (is_project_active_participant, is_project_editor,
--      can_view_project, validate_render_job_manifest_integrity) as VOLATILE
--      so that INSERT ... RETURNING and multi-table trigger cascades always
--      observe the latest command-counter snapshot within a transaction.
--   2. Adds direct tuple owner checks to SELECT policies on collaborative_projects,
--      project_participants, and project_render_jobs.
-- ================================================================

CREATE OR REPLACE FUNCTION public.is_project_active_participant(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_participants
    WHERE project_id = p_id
      AND user_id = u_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_editor(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_participants
    WHERE project_id = p_id
      AND user_id = u_id
      AND status = 'active'
      AND role IN ('owner', 'editor')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_project(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  p_creator UUID;
  p_comm UUID;
  p_vis TEXT;
  p_status TEXT;
  c_vis TEXT;
  c_owner UUID;
BEGIN
  SELECT creator_id, community_id, visibility, status
  INTO p_creator, p_comm, p_vis, p_status
  FROM public.collaborative_projects
  WHERE id = p_id;

  IF p_creator IS NULL THEN
    RETURN false;
  END IF;

  IF u_id IS NOT NULL AND u_id = p_creator THEN
    RETURN true;
  END IF;

  IF u_id IS NOT NULL AND public.is_blocked(p_creator, u_id) THEN
    RETURN false;
  END IF;

  IF public.is_account_restricted(p_creator) THEN
    RETURN false;
  END IF;

  IF p_comm IS NOT NULL THEN
    SELECT visibility, owner_id INTO c_vis, c_owner
    FROM public.communities
    WHERE id = p_comm;

    IF c_vis IS NULL THEN
      RETURN false;
    END IF;

    IF u_id IS NOT NULL AND public.is_blocked(c_owner, u_id) THEN
      RETURN false;
    END IF;

    IF c_vis = 'private' THEN
      IF u_id IS NULL OR NOT (u_id = c_owner OR public.is_community_active_member(p_comm, u_id)) THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  IF p_vis = 'private' OR p_status = 'draft' THEN
    IF u_id IS NULL THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1 FROM public.project_participants pp
      WHERE pp.project_id = p_id
        AND pp.user_id = u_id
        AND pp.status IN ('active', 'invited')
    );
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_render_job_manifest_integrity(p_project_id UUID, p_manifest JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  expected_count INTEGER;
  valid_count INTEGER;
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'array' THEN
    RETURN false;
  END IF;

  expected_count := jsonb_array_length(p_manifest);
  IF expected_count <= 0 THEN
    RETURN false;
  END IF;

  SELECT COUNT(*)
  INTO valid_count
  FROM jsonb_array_elements(p_manifest) AS item
  JOIN public.project_contributions pc
    ON pc.id = (item->>'contribution_id')::uuid
  WHERE pc.project_id = p_project_id
    AND pc.review_status = 'approved'
    AND pc.consent_granted = true
    AND pc.consent_withdrawn_at IS NULL
    AND public.is_project_active_participant(p_project_id, pc.contributor_id)
    AND NOT public.is_account_restricted(pc.contributor_id)
    AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id));

  RETURN valid_count = expected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.is_project_active_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_active_participant(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_project_editor(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_editor(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.can_view_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_project(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.validate_render_job_manifest_integrity(UUID, JSONB) FROM PUBLIC, anon, authenticated;

ALTER POLICY "collaborative_projects_select_policy"
  ON public.collaborative_projects
  USING (
    creator_id = (select auth.uid())
    OR public.can_view_project(id, (select auth.uid()))
  );

ALTER POLICY "project_participants_select_policy"
  ON public.project_participants
  USING (
    user_id = (select auth.uid())
    OR invited_by = (select auth.uid())
    OR public.can_view_project(project_id, (select auth.uid()))
  );

ALTER POLICY "project_render_jobs_select_policy"
  ON public.project_render_jobs
  USING (
    requested_by = (select auth.uid())
    OR (
      public.can_view_project(project_id, (select auth.uid()))
      AND (
        public.is_project_active_participant(project_id, (select auth.uid()))
        OR status = 'completed'
      )
    )
  );
