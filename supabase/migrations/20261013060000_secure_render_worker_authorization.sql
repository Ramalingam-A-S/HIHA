-- ================================================================
-- MIGRATION: 20261013060000_secure_render_worker_authorization.sql
-- Description:
--   Milestone 4.5 (P0-2) — Least-Privilege Multi-User Render Worker Authorization
--   & Explicit Storage Media Audience Enforcement.
--   1. Creates public.render_workers to register dedicated background media
--      worker identities without granting platform_staff moderation privileges
--      or general user impersonation.
--   2. Adds claimed_by UUID to public.project_render_jobs to bind an active
--      'processing' job to the specific worker instance that claimed it.
--   3. Hardens all worker and project helper functions so authenticated clients
--      cannot enumerate other users' worker status or probe private projects,
--      contributions, or storage paths via RPC calls.
--   4. Restricts claim_project_render_job() and 'queued' -> 'processing' /
--      'processing' -> 'completed' transitions to active, unrestricted render
--      workers, blocking ordinary users/clients from invoking worker-only
--      claim or completion operations.
--   5. Grants narrow, job-scoped read access on collaborative_projects,
--      project_contributions, project_render_jobs, and storage.objects ONLY
--      for the specific project and manifest-verified clips of a job currently
--      in 'processing' state and claimed by that worker, while excluding
--      dedicated render workers from general user content and media reads.
--   6. Replaces permissive storage.objects read subqueries with explicit
--      audience-verified predicates for posts, collaborative contributions,
--      and completed project outputs (enforcing published status, followers-only
--      accepted relationships, private project visibility, active consent,
--      blocks, account/post restrictions, and deactivation rules).
-- ================================================================

-- ================================================================
-- 1. Dedicated Render Worker Registry (Decoupled from platform_staff)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.render_workers (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL CHECK (
    char_length(trim(worker_name)) >= 3 AND char_length(trim(worker_name)) <= 100
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  allow_user_uploads BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_render_workers_active
  ON public.render_workers (user_id)
  WHERE is_active = true;

REVOKE ALL ON public.render_workers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.render_workers TO authenticated;

ALTER TABLE public.render_workers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'render_workers'
      AND policyname = 'render_workers_select_own'
  ) THEN
    CREATE POLICY "render_workers_select_own"
      ON public.render_workers
      FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  ELSE
    ALTER POLICY "render_workers_select_own"
      ON public.render_workers
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END
$$;

-- Bind active 'processing' jobs to the specific claiming worker identity
ALTER TABLE public.project_render_jobs
  ADD COLUMN IF NOT EXISTS claimed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_render_jobs_claimed_processing
  ON public.project_render_jobs (claimed_by, project_id)
  WHERE status = 'processing';

-- ================================================================
-- 2. Narrowly Scoped & Caller-Bound Authorization Helper Functions
-- ================================================================

-- Returns true only if u_id matches the authenticated caller AND is an active,
-- non-deactivated, unrestricted render worker. Prevents cross-user enumeration.
CREATE OR REPLACE FUNCTION public.is_authorized_render_worker(u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT u_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND u_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.render_workers rw
      JOIN public.profiles p ON p.id = rw.user_id
      WHERE rw.user_id = (SELECT auth.uid())
        AND rw.is_active = true
        AND p.deactivated_at IS NULL
        AND NOT public.is_account_restricted(rw.user_id)
    );
$$;

REVOKE ALL ON FUNCTION public.is_authorized_render_worker(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_authorized_render_worker(UUID) TO authenticated;

-- Returns true only if u_id matches the authenticated caller AND the caller is a dedicated
-- worker account (allow_user_uploads = false) that must never browse or upload general user media.
CREATE OR REPLACE FUNCTION public.is_dedicated_render_worker_only(u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT u_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND u_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.render_workers rw
      WHERE rw.user_id = (SELECT auth.uid())
        AND rw.allow_user_uploads = false
    );
$$;

REVOKE ALL ON FUNCTION public.is_dedicated_render_worker_only(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_dedicated_render_worker_only(UUID) TO authenticated;

-- Harden project helper functions to enforce caller identity and exclude dedicated render workers
CREATE OR REPLACE FUNCTION public.is_project_editor(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND u_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND u_id = (SELECT auth.uid())
    AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_participants pp
      JOIN public.profiles prof ON prof.id = pp.user_id
      WHERE pp.project_id = p_id
        AND pp.user_id = (SELECT auth.uid())
        AND pp.status = 'active'
        AND pp.role IN ('owner', 'editor')
        AND prof.deactivated_at IS NULL
        AND NOT public.is_account_restricted(pp.user_id)
    );
$$;

REVOKE ALL ON FUNCTION public.is_project_editor(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_editor(UUID, UUID) TO authenticated;

-- Trusted internal-only participant check (not callable by anon or authenticated clients via RPC).
-- Used by SECURITY DEFINER manifest/media validators and triggers to verify contributor eligibility
-- even when the session caller (auth.uid()) is a dedicated non-participant render worker.
CREATE OR REPLACE FUNCTION public.is_active_project_participant_internal(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND u_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_participants pp
      JOIN public.profiles prof ON prof.id = pp.user_id
      WHERE pp.project_id = p_id
        AND pp.user_id = u_id
        AND pp.status = 'active'
        AND prof.deactivated_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_project_participant_internal(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Client- and RLS-callable participant helper: enforces caller identity so ordinary authenticated
-- clients can only check their own participation (or project editors can check their project),
-- and excludes dedicated render workers.
CREATE OR REPLACE FUNCTION public.is_project_active_participant(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_id IS NOT NULL
    AND u_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
    AND (
      u_id = (SELECT auth.uid())
      OR public.is_project_editor(p_id, (SELECT auth.uid()))
    )
    AND public.is_active_project_participant_internal(p_id, u_id);
$$;

REVOKE ALL ON FUNCTION public.is_project_active_participant(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_project_active_participant(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_view_project(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_caller UUID;
  p_creator UUID;
  p_comm UUID;
  p_vis TEXT;
  p_status TEXT;
  p_creator_deactivated TIMESTAMPTZ;
  v_viewer_deactivated TIMESTAMPTZ;
  c_vis TEXT;
  c_owner UUID;
BEGIN
  IF p_id IS NULL THEN
    RETURN false;
  END IF;

  v_caller := (SELECT auth.uid());

  -- Caller identity must match u_id; prevents authenticated clients from probing other users' access
  IF u_id IS DISTINCT FROM v_caller THEN
    RETURN false;
  END IF;

  -- Dedicated render workers cannot use general project view policies
  IF v_caller IS NOT NULL AND public.is_dedicated_render_worker_only(v_caller) THEN
    RETURN false;
  END IF;

  IF v_caller IS NOT NULL THEN
    SELECT deactivated_at INTO v_viewer_deactivated
    FROM public.profiles
    WHERE id = v_caller;

    IF v_viewer_deactivated IS NOT NULL OR public.is_account_restricted(v_caller) THEN
      RETURN false;
    END IF;
  END IF;

  SELECT cp.creator_id, cp.community_id, cp.visibility, cp.status, prof.deactivated_at
  INTO p_creator, p_comm, p_vis, p_status, p_creator_deactivated
  FROM public.collaborative_projects cp
  JOIN public.profiles prof ON prof.id = cp.creator_id
  WHERE cp.id = p_id;

  IF p_creator IS NULL OR p_creator_deactivated IS NOT NULL THEN
    RETURN false;
  END IF;

  IF v_caller IS NOT NULL AND v_caller = p_creator THEN
    RETURN true;
  END IF;

  IF v_caller IS NOT NULL AND public.is_blocked(p_creator, v_caller) THEN
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

    IF v_caller IS NOT NULL AND public.is_blocked(c_owner, v_caller) THEN
      RETURN false;
    END IF;

    IF c_vis = 'private' THEN
      IF v_caller IS NULL OR NOT (v_caller = c_owner OR public.is_community_active_member(p_comm, v_caller)) THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  IF p_vis = 'private' OR p_status = 'draft' THEN
    IF v_caller IS NULL THEN
      RETURN false;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.project_participants pp
      WHERE pp.project_id = p_id
        AND pp.user_id = v_caller
        AND pp.status IN ('active', 'invited')
    );
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.can_view_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_project(UUID, UUID) TO anon, authenticated;

-- ================================================================
-- 3. Enhance validate_render_job_manifest_integrity with Source Path Ownership
--    & Trusted Internal Participant Validation
-- ================================================================
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
  distinct_contrib_count INTEGER;
  distinct_seq_count INTEGER;
  p_creator UUID;
  p_status TEXT;
  p_policy_ver TEXT;
  p_deactivated TIMESTAMPTZ;
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'array' THEN
    RETURN false;
  END IF;

  expected_count := jsonb_array_length(p_manifest);
  IF expected_count <= 0 THEN
    RETURN false;
  END IF;

  SELECT cp.creator_id, cp.status, cp.consent_policy_version, prof.deactivated_at
  INTO p_creator, p_status, p_policy_ver, p_deactivated
  FROM public.collaborative_projects cp
  JOIN public.profiles prof ON prof.id = cp.creator_id
  WHERE cp.id = p_project_id;

  IF p_creator IS NULL
     OR p_status = 'cancelled'
     OR p_deactivated IS NOT NULL
     OR public.is_account_restricted(p_creator)
  THEN
    RETURN false;
  END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT pc.id),
    COUNT(DISTINCT pc.sequence_order)
  INTO
    valid_count,
    distinct_contrib_count,
    distinct_seq_count
  FROM jsonb_array_elements(p_manifest) AS item
  JOIN public.project_contributions pc
    ON pc.id = (item->>'contribution_id')::uuid
  WHERE pc.project_id = p_project_id
    AND pc.contributor_id = (item->>'contributor_id')::uuid
    AND pc.review_status = 'approved'
    AND pc.consent_granted = true
    AND pc.consent_withdrawn_at IS NULL
    AND pc.sequence_order IS NOT NULL
    AND (item->>'sequence_order') ~ '^[0-9]+$'
    AND pc.sequence_order = (item->>'sequence_order')::integer
    AND pc.media_path = (item->>'media_path')
    AND split_part(pc.media_path, '/', 1) = pc.contributor_id::text
    AND pc.consent_policy_version = p_policy_ver
    AND pc.ai_disclosure_status = COALESCE(item->>'ai_disclosure_status', pc.ai_disclosure_status)
    AND public.is_active_project_participant_internal(p_project_id, pc.contributor_id)
    AND NOT public.is_account_restricted(pc.contributor_id)
    AND NOT public.is_blocked(p_creator, pc.contributor_id)
    AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id));

  RETURN valid_count = expected_count
     AND distinct_contrib_count = expected_count
     AND distinct_seq_count = expected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_render_job_manifest_integrity(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- Returns true only while the authenticated caller p_worker_id holds an active 'processing'
-- claim on a valid manifest job for p_project_id. Caller identity is strictly enforced.
CREATE OR REPLACE FUNCTION public.is_worker_processing_project(p_project_id UUID, p_worker_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_worker_id = (SELECT auth.uid())
    AND public.is_authorized_render_worker((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      WHERE rj.project_id = p_project_id
        AND rj.status = 'processing'
        AND rj.claimed_by = (SELECT auth.uid())
        AND cp.status = 'rendering'
        AND public.validate_render_job_manifest_integrity(rj.project_id, rj.input_manifest)
    );
$$;

REVOKE ALL ON FUNCTION public.is_worker_processing_project(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_worker_processing_project(UUID, UUID) TO authenticated;

-- Returns true only if p_contribution_id is part of the authoritative, valid input_manifest
-- of a job currently in 'processing' state and claimed by the authenticated caller p_worker_id.
CREATE OR REPLACE FUNCTION public.is_contribution_in_active_worker_manifest(
  p_project_id UUID,
  p_contribution_id UUID,
  p_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_project_id IS NOT NULL
    AND p_contribution_id IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_worker_id = (SELECT auth.uid())
    AND public.is_authorized_render_worker((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      CROSS JOIN LATERAL jsonb_array_elements(rj.input_manifest) AS item
      WHERE rj.project_id = p_project_id
        AND rj.status = 'processing'
        AND rj.claimed_by = (SELECT auth.uid())
        AND cp.status = 'rendering'
        AND (item->>'contribution_id')::uuid = p_contribution_id
        AND public.validate_render_job_manifest_integrity(rj.project_id, rj.input_manifest)
    );
$$;

REVOKE ALL ON FUNCTION public.is_contribution_in_active_worker_manifest(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_contribution_in_active_worker_manifest(UUID, UUID, UUID) TO authenticated;

-- Returns true only if p_media_path is an approved, actively consented, non-blocked,
-- contributor-owned clip listed in the valid input_manifest of a job currently claimed
-- by the authenticated caller p_worker_id.
CREATE OR REPLACE FUNCTION public.is_media_in_active_worker_manifest(
  p_media_path TEXT,
  p_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_media_path IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_worker_id = (SELECT auth.uid())
    AND public.is_authorized_render_worker((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      JOIN public.profiles proj_prof ON proj_prof.id = cp.creator_id
      CROSS JOIN LATERAL jsonb_array_elements(rj.input_manifest) AS item
      JOIN public.project_contributions pc
        ON pc.id = (item->>'contribution_id')::uuid
      WHERE rj.status = 'processing'
        AND rj.claimed_by = (SELECT auth.uid())
        AND cp.status = 'rendering'
        AND proj_prof.deactivated_at IS NULL
        AND NOT public.is_account_restricted(cp.creator_id)
        AND (item->>'media_path') = p_media_path
        AND pc.project_id = rj.project_id
        AND pc.media_path = p_media_path
        AND split_part(pc.media_path, '/', 1) = pc.contributor_id::text
        AND pc.review_status = 'approved'
        AND pc.consent_granted = true
        AND pc.consent_withdrawn_at IS NULL
        AND pc.consent_policy_version = cp.consent_policy_version
        AND public.is_active_project_participant_internal(rj.project_id, pc.contributor_id)
        AND NOT public.is_account_restricted(pc.contributor_id)
        AND NOT public.is_blocked(cp.creator_id, pc.contributor_id)
        AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id))
        AND public.validate_render_job_manifest_integrity(rj.project_id, rj.input_manifest)
    );
$$;

REVOKE ALL ON FUNCTION public.is_media_in_active_worker_manifest(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_media_in_active_worker_manifest(TEXT, UUID) TO authenticated;

-- Internal-only helper validating canonical output path format:
-- '{projectCreatorId}/stitched-{projectId}-{jobId}-{8hex}.mp4'
CREATE OR REPLACE FUNCTION public.is_canonical_render_output_path(
  p_object_name TEXT,
  p_project_creator_id UUID,
  p_project_id UUID,
  p_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_object_name IS NOT NULL
    AND p_project_creator_id IS NOT NULL
    AND p_project_id IS NOT NULL
    AND p_job_id IS NOT NULL
    AND p_object_name ~ (
      '^' || p_project_creator_id::text ||
      '/stitched-' || p_project_id::text ||
      '-' || p_job_id::text ||
      '-[a-f0-9]{8}\.mp4$'
    );
$$;

REVOKE ALL ON FUNCTION public.is_canonical_render_output_path(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Returns true only if the authenticated caller p_worker_id holds the active 'processing' claim
-- for the job encoded in p_object_name AND the project's render manifest remains valid.
CREATE OR REPLACE FUNCTION public.can_upload_render_output_object(
  p_object_name TEXT,
  p_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_object_name IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_worker_id = (SELECT auth.uid())
    AND public.is_authorized_render_worker((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      WHERE rj.status = 'processing'
        AND rj.claimed_by = (SELECT auth.uid())
        AND cp.status = 'rendering'
        AND public.is_canonical_render_output_path(p_object_name, cp.creator_id, cp.id, rj.id)
        AND public.validate_render_job_manifest_integrity(rj.project_id, rj.input_manifest)
    );
$$;

REVOKE ALL ON FUNCTION public.can_upload_render_output_object(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_render_output_object(TEXT, UUID) TO authenticated;

-- Allows the claiming worker to delete a staged canonical output object during rollback if commit is rejected
CREATE OR REPLACE FUNCTION public.can_cleanup_render_output_object(
  p_object_name TEXT,
  p_worker_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
  SELECT p_object_name IS NOT NULL
    AND p_worker_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_worker_id = (SELECT auth.uid())
    AND public.is_authorized_render_worker((SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      WHERE rj.claimed_by = (SELECT auth.uid())
        AND rj.status IN ('processing', 'failed')
        AND public.is_canonical_render_output_path(p_object_name, cp.creator_id, cp.id, rj.id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_cleanup_render_output_object(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_cleanup_render_output_object(TEXT, UUID) TO authenticated;

-- ================================================================
-- 4. Update handle_project_render_job_update Trigger & claim_project_render_job RPC
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_project_render_job_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  v_is_worker BOOLEAN;
  v_is_editor BOOLEAN;
  v_trusted_claim BOOLEAN;
  p_creator UUID;
  p_status TEXT;
  v_provenance JSONB;
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.requested_by <> OLD.requested_by
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.max_attempts <> OLD.max_attempts
     OR NEW.timeout_seconds <> OLD.timeout_seconds
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Render job definition and input manifest are immutable';
  END IF;

  IF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
    RAISE EXCEPTION 'Completed render jobs cannot be modified';
  END IF;

  -- Cascade abort from consent withdrawal, participant exit, deactivation, or project cancellation trigger
  IF pg_trigger_depth() > 1 AND NEW.status = 'failed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.output_media_path := NULL;
    NEW.output_provenance := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  caller_id := (SELECT auth.uid());
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to update render job';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Restricted accounts cannot update render jobs';
  END IF;

  v_is_worker := public.is_authorized_render_worker(caller_id);
  v_is_editor := public.is_project_editor(OLD.project_id, caller_id);
  v_trusted_claim := COALESCE(current_setting('app.trusted_render_worker_claim', true), '') = 'true';

  SELECT creator_id, status INTO p_creator, p_status
  FROM public.collaborative_projects
  WHERE id = OLD.project_id;

  IF p_creator IS NULL THEN
    RAISE EXCEPTION 'Target project does not exist';
  END IF;

  -- Transition 1: Retry failed job (failed -> queued) — restricted to project editors/owners
  IF OLD.status = 'failed' AND NEW.status = 'queued' THEN
    IF NOT v_is_editor THEN
      RAISE EXCEPTION 'Project editor authorization required to retry a failed render job';
    END IF;

    IF p_status = 'cancelled' THEN
      RAISE EXCEPTION 'Cannot retry render job for a cancelled project';
    END IF;

    IF OLD.attempt_count >= OLD.max_attempts THEN
      RAISE EXCEPTION 'Maximum retry attempts exceeded for this render job';
    END IF;

    IF NOT public.validate_render_job_manifest_integrity(OLD.project_id, OLD.input_manifest) THEN
      RAISE EXCEPTION 'Cannot retry render job: one or more contributions in the manifest lost consent or eligibility';
    END IF;

    NEW.attempt_count := OLD.attempt_count + 1;
    NEW.claimed_by := NULL;
    NEW.failure_reason := NULL;
    NEW.started_at := NULL;
    NEW.completed_at := NULL;
    NEW.output_media_path := NULL;
    NEW.output_provenance := NULL;

    UPDATE public.collaborative_projects
    SET status = 'rendering',
        updated_at = now()
    WHERE id = OLD.project_id;

  -- Transition 2: Claim queued job (queued -> processing) — restricted to authorized render workers via claim_project_render_job
  ELSIF OLD.status = 'queued' AND NEW.status = 'processing' THEN
    IF NOT v_is_worker OR NOT v_trusted_claim THEN
      RAISE EXCEPTION 'Authorized render worker claim RPC required to transition job to processing';
    END IF;

    IF p_status <> 'rendering' THEN
      RAISE EXCEPTION 'Cannot process render job: project is no longer in rendering state';
    END IF;

    IF NOT public.validate_render_job_manifest_integrity(OLD.project_id, OLD.input_manifest) THEN
      RAISE EXCEPTION 'Cannot process render job: one or more contributions in the manifest lost consent or eligibility';
    END IF;

    NEW.claimed_by := caller_id;
    NEW.started_at := now();
    NEW.completed_at := NULL;
    NEW.failure_reason := NULL;
    NEW.output_provenance := NULL;

  -- Transition 3: Complete job (processing -> completed) — restricted to the claiming render worker
  ELSIF OLD.status = 'processing' AND NEW.status = 'completed' THEN
    IF NOT v_is_worker OR OLD.claimed_by IS DISTINCT FROM caller_id THEN
      RAISE EXCEPTION 'Only the claiming authorized render worker may complete a processing render job';
    END IF;

    IF p_status <> 'rendering' THEN
      RAISE EXCEPTION 'Render completion rejected: project is no longer in rendering state';
    END IF;

    IF OLD.started_at IS NOT NULL AND extract(epoch from (now() - OLD.started_at)) > OLD.timeout_seconds THEN
      RAISE EXCEPTION 'Render job exceeded timeout limit';
    END IF;

    IF NOT public.validate_render_job_manifest_integrity(OLD.project_id, OLD.input_manifest) THEN
      RAISE EXCEPTION 'Render completion rejected: contributor consent or eligibility changed during rendering';
    END IF;

    IF NEW.output_media_path IS NULL THEN
      RAISE EXCEPTION 'Completed render job requires a valid output_media_path';
    END IF;

    IF NOT public.is_canonical_render_output_path(NEW.output_media_path, p_creator, OLD.project_id, OLD.id) THEN
      RAISE EXCEPTION 'Output media path must match the canonical project render output path';
    END IF;

    v_provenance := public.build_collaborative_output_provenance(OLD.id, OLD.input_manifest);

    NEW.claimed_by := OLD.claimed_by;
    NEW.started_at := COALESCE(OLD.started_at, now());
    NEW.completed_at := now();
    NEW.failure_reason := NULL;
    NEW.output_provenance := v_provenance;

    UPDATE public.collaborative_projects
    SET status = 'completed',
        output_media_path = NEW.output_media_path,
        output_provenance = v_provenance,
        updated_at = now()
    WHERE id = OLD.project_id;

  -- Transition 4: Fail job (queued/processing -> failed) — restricted to claiming render worker or queued worker failure
  ELSIF OLD.status IN ('queued', 'processing') AND NEW.status = 'failed' THEN
    IF NOT v_is_worker THEN
      RAISE EXCEPTION 'Authorized render worker required to mark render job failed';
    END IF;

    IF OLD.status = 'processing' AND OLD.claimed_by IS DISTINCT FROM caller_id THEN
      RAISE EXCEPTION 'Only the claiming render worker may fail an in-progress render job';
    END IF;

    NEW.claimed_by := OLD.claimed_by;
    NEW.completed_at := now();
    NEW.output_media_path := NULL;
    NEW.output_provenance := NULL;
    NEW.failure_reason := COALESCE(NEW.failure_reason, 'Render job failed');

    UPDATE public.collaborative_projects
    SET status = 'open',
        updated_at = now()
    WHERE id = OLD.project_id
      AND status = 'rendering';

  ELSE
    RAISE EXCEPTION 'Invalid render job state transition from % to %', OLD.status, NEW.status;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_render_job_update() FROM PUBLIC, anon, authenticated;

-- Atomic multi-tenant job claiming RPC (SECURITY DEFINER, restricted strictly to authorized render workers)
CREATE OR REPLACE FUNCTION public.claim_project_render_job(p_job_id UUID DEFAULT NULL)
RETURNS SETOF public.project_render_jobs
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_caller UUID;
  v_target_id UUID;
BEGIN
  v_caller := (SELECT auth.uid());
  IF v_caller IS NULL OR NOT public.is_authorized_render_worker(v_caller) THEN
    RAISE EXCEPTION 'Authorized render worker identity required to claim render jobs';
  END IF;

  SELECT rj.id
  INTO v_target_id
  FROM public.project_render_jobs rj
  JOIN public.collaborative_projects cp ON cp.id = rj.project_id
  WHERE rj.status = 'queued'
    AND cp.status = 'rendering'
    AND (p_job_id IS NULL OR rj.id = p_job_id)
  ORDER BY rj.created_at ASC
  FOR UPDATE OF rj SKIP LOCKED
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.trusted_render_worker_claim', 'true', true);

  RETURN QUERY
  UPDATE public.project_render_jobs rj
  SET status = 'processing',
      claimed_by = v_caller,
      started_at = now(),
      updated_at = now()
  WHERE rj.id = v_target_id
    AND rj.status = 'queued'
  RETURNING rj.*;

  PERFORM set_config('app.trusted_render_worker_claim', 'false', true);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.trusted_render_worker_claim', 'false', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_project_render_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_project_render_job(UUID) TO authenticated;

-- Worker helper to fail a queued job whose manifest became invalid prior to claiming
CREATE OR REPLACE FUNCTION public.fail_invalid_queued_render_job(
  p_job_id UUID,
  p_failure_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_caller UUID;
  v_updated_id UUID;
BEGIN
  v_caller := (SELECT auth.uid());
  IF v_caller IS NULL OR NOT public.is_authorized_render_worker(v_caller) THEN
    RAISE EXCEPTION 'Authorized render worker identity required';
  END IF;

  UPDATE public.project_render_jobs rj
  SET status = 'failed',
      failure_reason = COALESCE(NULLIF(trim(p_failure_reason), ''), 'Render job failed manifest validation'),
      completed_at = now(),
      updated_at = now()
  WHERE rj.id = p_job_id
    AND rj.status = 'queued'
    AND NOT public.validate_render_job_manifest_integrity(rj.project_id, rj.input_manifest)
  RETURNING rj.id INTO v_updated_id;

  RETURN v_updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_invalid_queued_render_job(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fail_invalid_queued_render_job(UUID, TEXT) TO authenticated;

-- ================================================================
-- 5. Job-Scoped RLS Policies for Multi-User Render Worker Execution
-- ================================================================

-- Exclude dedicated render workers from reading general user posts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'posts'
      AND policyname = 'posts_exclude_dedicated_render_worker'
  ) THEN
    CREATE POLICY "posts_exclude_dedicated_render_worker"
      ON public.posts
      AS RESTRICTIVE
      FOR SELECT
      TO authenticated
      USING (
        NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
      );
  ELSE
    ALTER POLICY "posts_exclude_dedicated_render_worker"
      ON public.posts
      TO authenticated
      USING (
        NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
      );
  END IF;
END
$$;

-- Strengthen posts visibility policy to enforce creator account restrictions and deactivation
ALTER POLICY "Posts visibility policy"
  ON public.posts
  USING (
    (SELECT auth.uid()) = creator_id
    OR (
      status = 'published'
      AND NOT public.is_post_restricted(posts.id)
      AND NOT public.is_account_restricted(posts.creator_id)
      AND EXISTS (
        SELECT 1
        FROM public.profiles creator_prof
        WHERE creator_prof.id = posts.creator_id
          AND creator_prof.deactivated_at IS NULL
      )
      AND (
        (SELECT auth.uid()) IS NULL
        OR (
          NOT public.is_blocked(posts.creator_id, (SELECT auth.uid()))
          AND NOT public.is_account_restricted((SELECT auth.uid()))
          AND EXISTS (
            SELECT 1
            FROM public.profiles viewer_prof
            WHERE viewer_prof.id = (SELECT auth.uid())
              AND viewer_prof.deactivated_at IS NULL
          )
        )
      )
      AND (
        visibility = 'public'
        OR (
          visibility = 'followers'
          AND EXISTS (
            SELECT 1
            FROM public.follows f
            WHERE f.follower_id = (SELECT auth.uid())
              AND f.following_id = posts.creator_id
              AND f.status = 'accepted'
          )
        )
      )
    )
  );

-- Keep general collaborative_projects policy for anon/authenticated via can_view_project
-- (which is granted to anon, authenticated and excludes dedicated workers internally),
-- and place authenticated tuple-owner and active-worker checks in a TO authenticated policy.
ALTER POLICY "collaborative_projects_select_policy"
  ON public.collaborative_projects
  USING (
    public.can_view_project(id, (SELECT auth.uid()))
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'collaborative_projects'
      AND policyname = 'collaborative_projects_worker_select_policy'
  ) THEN
    CREATE POLICY "collaborative_projects_worker_select_policy"
      ON public.collaborative_projects
      FOR SELECT
      TO authenticated
      USING (
        (
          creator_id = (SELECT auth.uid())
          AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
        )
        OR public.is_worker_processing_project(id, (SELECT auth.uid()))
      );
  ELSE
    ALTER POLICY "collaborative_projects_worker_select_policy"
      ON public.collaborative_projects
      TO authenticated
      USING (
        (
          creator_id = (SELECT auth.uid())
          AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
        )
        OR public.is_worker_processing_project(id, (SELECT auth.uid()))
      );
  END IF;
END
$$;

ALTER POLICY "collaborative_projects_insert_policy"
  ON public.collaborative_projects
  WITH CHECK (
    creator_id = (SELECT auth.uid())
    AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
    AND NOT public.is_account_restricted((SELECT auth.uid()))
  );

-- Allow claiming worker to read ONLY the contributions listed in its active 'processing' job manifest
ALTER POLICY "project_contributions_select_policy"
  ON public.project_contributions
  USING (
    (
      contributor_id = (SELECT auth.uid())
      AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
    )
    OR (
      NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
      AND public.can_view_project(project_id, (SELECT auth.uid()))
      AND NOT public.is_blocked(contributor_id, (SELECT auth.uid()))
      AND NOT public.is_account_restricted(contributor_id)
      AND (source_post_id IS NULL OR NOT public.is_post_restricted(source_post_id))
      AND (
        (
          public.is_project_active_participant(project_id, (SELECT auth.uid()))
          AND review_status <> 'withdrawn'
          AND consent_granted = true
          AND consent_withdrawn_at IS NULL
        )
        OR
        (
          review_status = 'approved'
          AND consent_granted = true
          AND consent_withdrawn_at IS NULL
        )
      )
    )
    OR (
      public.is_contribution_in_active_worker_manifest(project_id, id, (SELECT auth.uid()))
      AND review_status = 'approved'
      AND consent_granted = true
      AND consent_withdrawn_at IS NULL
      AND NOT public.is_account_restricted(contributor_id)
      AND (source_post_id IS NULL OR NOT public.is_post_restricted(source_post_id))
    )
  );

-- Allow claiming worker to read and update ONLY its actively claimed render job
ALTER POLICY "project_render_jobs_select_policy"
  ON public.project_render_jobs
  USING (
    (
      requested_by = (SELECT auth.uid())
      AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
    )
    OR (
      NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
      AND public.can_view_project(project_id, (SELECT auth.uid()))
      AND (
        public.is_project_active_participant(project_id, (SELECT auth.uid()))
        OR status = 'completed'
      )
    )
    OR (
      claimed_by = (SELECT auth.uid())
      AND public.is_authorized_render_worker((SELECT auth.uid()))
    )
  );

ALTER POLICY "project_render_jobs_update_policy"
  ON public.project_render_jobs
  USING (
    NOT public.is_account_restricted((SELECT auth.uid()))
    AND (
      public.is_project_editor(project_id, (SELECT auth.uid()))
      OR (
        claimed_by = (SELECT auth.uid())
        AND public.is_authorized_render_worker((SELECT auth.uid()))
      )
    )
  )
  WITH CHECK (
    NOT public.is_account_restricted((SELECT auth.uid()))
    AND (
      public.is_project_editor(project_id, (SELECT auth.uid()))
      OR (
        claimed_by = (SELECT auth.uid())
        AND public.is_authorized_render_worker((SELECT auth.uid()))
      )
    )
  );

-- ================================================================
-- 6. Storage RLS Policies for Scoped Source Read & Canonical Output Upload
-- ================================================================

-- 6a. Upload policy:
--     - Normal users can upload non-stitched files to their own '{auth.uid()}/' directory.
--     - Dedicated-only worker accounts (allow_user_uploads = false) cannot upload arbitrary user files.
--     - Any 'stitched-*' output file can ONLY be uploaded by the claiming render worker
--       to the canonical '{projectCreatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4' path
--       while the job is in 'processing' state and manifest integrity is valid.
ALTER POLICY "Users can upload media to their own directory"
  ON storage.objects
  WITH CHECK (
    bucket_id = 'media'
    AND (
      (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND split_part(name, '/', 2) NOT LIKE 'stitched-%'
        AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
        AND NOT public.is_account_restricted((SELECT auth.uid()))
      )
      OR public.can_upload_render_output_object(name, (SELECT auth.uid()))
    )
  );

-- 6b. Delete policy:
--     - Normal users can delete files in their own directory.
--     - Claiming render workers can delete staged canonical output files during rollback.
ALTER POLICY "Users can delete their own media"
  ON storage.objects
  USING (
    bucket_id = 'media'
    AND (
      (
        (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
      )
      OR public.can_cleanup_render_output_object(name, (SELECT auth.uid()))
    )
  );

-- 6c. Read policy (Explicit Audience & Worker Manifest Authorization):
--     1. Claiming render worker may read ONLY manifest-verified source clips for its active 'processing' job
--        and its own staged canonical output object during rollback cleanup.
--     2. Dedicated render workers are excluded from all general user media branches.
--     3. General user media reads require a non-restricted, non-deactivated viewer AND:
--        - Owner reading their own non-stitched file, OR
--        - Media attached to a published, non-restricted post whose creator is active/unrestricted/non-blocked
--          and whose audience visibility ('public' or accepted 'followers') permits the viewer, OR
--        - Media attached to an actively consented, non-withdrawn contribution in a project the viewer
--          is authorized to view (via public.can_view_project) with active participant check for pending clips, OR
--        - Completed collaborative render output for a project the viewer is authorized to view
--          (via public.can_view_project).
ALTER POLICY "Users can read media objects"
  ON storage.objects
  USING (
    bucket_id = 'media'
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      public.is_media_in_active_worker_manifest(storage.objects.name, (SELECT auth.uid()))
      OR public.can_cleanup_render_output_object(storage.objects.name, (SELECT auth.uid()))
      OR (
        NOT public.is_dedicated_render_worker_only((SELECT auth.uid()))
        AND NOT public.is_account_restricted((SELECT auth.uid()))
        AND EXISTS (
          SELECT 1
          FROM public.profiles viewer_prof
          WHERE viewer_prof.id = (SELECT auth.uid())
            AND viewer_prof.deactivated_at IS NULL
        )
        AND (
          (
            (storage.foldername(name))[1] = (SELECT auth.uid())::text
            AND split_part(name, '/', 2) NOT LIKE 'stitched-%'
          )
          OR EXISTS (
            SELECT 1
            FROM public.posts p
            JOIN public.profiles creator_prof ON creator_prof.id = p.creator_id
            WHERE p.media_path = storage.objects.name
              AND creator_prof.deactivated_at IS NULL
              AND NOT public.is_account_restricted(p.creator_id)
              AND (
                p.creator_id = (SELECT auth.uid())
                OR (
                  p.status = 'published'
                  AND NOT public.is_post_restricted(p.id)
                  AND NOT public.is_blocked(p.creator_id, (SELECT auth.uid()))
                  AND (
                    p.visibility = 'public'
                    OR (
                      p.visibility = 'followers'
                      AND EXISTS (
                        SELECT 1
                        FROM public.follows f
                        WHERE f.follower_id = (SELECT auth.uid())
                          AND f.following_id = p.creator_id
                          AND f.status = 'accepted'
                      )
                    )
                  )
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.project_contributions pc
            JOIN public.collaborative_projects cp ON cp.id = pc.project_id
            JOIN public.profiles contrib_prof ON contrib_prof.id = pc.contributor_id
            JOIN public.profiles proj_creator_prof ON proj_creator_prof.id = cp.creator_id
            WHERE pc.media_path = storage.objects.name
              AND pc.consent_granted = true
              AND pc.consent_withdrawn_at IS NULL
              AND pc.review_status <> 'withdrawn'
              AND contrib_prof.deactivated_at IS NULL
              AND proj_creator_prof.deactivated_at IS NULL
              AND NOT public.is_account_restricted(pc.contributor_id)
              AND NOT public.is_account_restricted(cp.creator_id)
              AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id))
              AND NOT public.is_blocked(pc.contributor_id, (SELECT auth.uid()))
              AND NOT public.is_blocked(cp.creator_id, (SELECT auth.uid()))
              AND public.can_view_project(pc.project_id, (SELECT auth.uid()))
              AND (
                pc.contributor_id = (SELECT auth.uid())
                OR pc.review_status = 'approved'
                OR (
                  pc.review_status IN ('pending', 'approved')
                  AND public.is_project_active_participant(pc.project_id, (SELECT auth.uid()))
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.collaborative_projects cp
            JOIN public.profiles proj_creator_prof ON proj_creator_prof.id = cp.creator_id
            WHERE cp.output_media_path = storage.objects.name
              AND cp.status = 'completed'
              AND proj_creator_prof.deactivated_at IS NULL
              AND NOT public.is_account_restricted(cp.creator_id)
              AND NOT public.is_blocked(cp.creator_id, (SELECT auth.uid()))
              AND public.can_view_project(cp.id, (SELECT auth.uid()))
          )
        )
      )
    )
  );
