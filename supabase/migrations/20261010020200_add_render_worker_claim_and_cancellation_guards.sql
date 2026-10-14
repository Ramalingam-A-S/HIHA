-- ================================================================
-- MIGRATION: Add Render Worker Atomic Job Claim & Cancellation Guards
-- Description:
--   1. Adds public.claim_project_render_job(p_job_id UUID) using
--      FOR UPDATE SKIP LOCKED so concurrent workers cannot claim the
--      same queued render job simultaneously.
--   2. Enhances validate_render_job_manifest_integrity to verify media_path,
--      consent_policy_version, relationship block barriers, and project state.
--   3. Enhances handle_collaborative_project_update so cancelling a project
--      automatically aborts any queued/processing render jobs and clears output.
--   4. Enhances handle_project_render_job_update to reject processing, retry,
--      or completion when the parent project is cancelled or no longer rendering.
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
  p_creator UUID;
  p_status TEXT;
  p_policy_ver TEXT;
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'array' THEN
    RETURN false;
  END IF;

  expected_count := jsonb_array_length(p_manifest);
  IF expected_count <= 0 THEN
    RETURN false;
  END IF;

  SELECT creator_id, status, consent_policy_version
  INTO p_creator, p_status, p_policy_ver
  FROM public.collaborative_projects
  WHERE id = p_project_id;

  IF p_creator IS NULL OR p_status = 'cancelled' OR public.is_account_restricted(p_creator) THEN
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
    AND pc.media_path = (item->>'media_path')
    AND pc.consent_policy_version = p_policy_ver
    AND public.is_project_active_participant(p_project_id, pc.contributor_id)
    AND NOT public.is_account_restricted(pc.contributor_id)
    AND NOT public.is_blocked(p_creator, pc.contributor_id)
    AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id));

  RETURN valid_count = expected_count;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_render_job_manifest_integrity(UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_collaborative_project_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.creator_id <> OLD.creator_id
     OR NEW.community_id IS DISTINCT FROM OLD.community_id
     OR NEW.consent_policy_version <> OLD.consent_policy_version
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Core project identity and consent policy fields are immutable';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled projects cannot be reopened';
  END IF;

  IF pg_trigger_depth() = 1 THEN
    caller_id := auth.uid();
    IF caller_id IS NULL OR NOT public.is_project_editor(OLD.id, caller_id) THEN
      RAISE EXCEPTION 'Project editor authorization required';
    END IF;

    IF public.is_account_restricted(caller_id) THEN
      RAISE EXCEPTION 'Restricted accounts cannot modify projects';
    END IF;

    IF (NEW.visibility <> OLD.visibility OR NEW.participation_mode <> OLD.participation_mode OR NEW.status = 'cancelled')
       AND caller_id <> OLD.creator_id
    THEN
      RAISE EXCEPTION 'Only the project owner may change visibility, participation mode, or cancel the project';
    END IF;

    IF (NEW.status IN ('rendering', 'completed') AND NEW.status <> OLD.status)
       OR (NEW.output_media_path IS DISTINCT FROM OLD.output_media_path)
    THEN
      RAISE EXCEPTION 'Project render completion state and output media can only be set by the render job pipeline';
    END IF;

    IF OLD.status = 'rendering' AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Cannot manually transition project status while a render job is active';
    END IF;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.output_media_path := NULL;

    UPDATE public.project_render_jobs
    SET status = 'failed',
        failure_reason = 'Render aborted: project was cancelled.',
        completed_at = now(),
        updated_at = now()
    WHERE project_id = OLD.id
      AND status IN ('queued', 'processing');
  END IF;

  IF NEW.visibility = 'private' THEN
    NEW.participation_mode := 'invite_only';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_collaborative_project_update() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_project_render_job_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_creator UUID;
  p_status TEXT;
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

  IF pg_trigger_depth() > 1 AND NEW.status = 'failed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.output_media_path := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  caller_id := auth.uid();
  IF caller_id IS NULL OR NOT public.is_project_editor(OLD.project_id, caller_id) THEN
    RAISE EXCEPTION 'Project editor authorization required to update render job';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Restricted accounts cannot update render jobs';
  END IF;

  SELECT creator_id, status INTO p_creator, p_status
  FROM public.collaborative_projects
  WHERE id = OLD.project_id;

  IF p_creator IS NULL THEN
    RAISE EXCEPTION 'Target project does not exist';
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'queued' THEN
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
    NEW.failure_reason := NULL;
    NEW.started_at := NULL;
    NEW.completed_at := NULL;
    NEW.output_media_path := NULL;

    UPDATE public.collaborative_projects
    SET status = 'rendering',
        updated_at = now()
    WHERE id = OLD.project_id;

  ELSIF OLD.status = 'queued' AND NEW.status = 'processing' THEN
    IF p_status <> 'rendering' THEN
      RAISE EXCEPTION 'Cannot process render job: project is no longer in rendering state';
    END IF;

    IF NOT public.validate_render_job_manifest_integrity(OLD.project_id, OLD.input_manifest) THEN
      RAISE EXCEPTION 'Cannot process render job: one or more contributions in the manifest lost consent or eligibility';
    END IF;

    NEW.started_at := now();
    NEW.completed_at := NULL;
    NEW.failure_reason := NULL;

  ELSIF OLD.status IN ('queued', 'processing') AND NEW.status = 'completed' THEN
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

    IF split_part(NEW.output_media_path, '/', 1) NOT IN (p_creator::text, caller_id::text) THEN
      RAISE EXCEPTION 'Output media path must belong to the project owner or authorized editor scope';
    END IF;

    NEW.started_at := COALESCE(OLD.started_at, now());
    NEW.completed_at := now();
    NEW.failure_reason := NULL;

    UPDATE public.collaborative_projects
    SET status = 'completed',
        output_media_path = NEW.output_media_path,
        updated_at = now()
    WHERE id = OLD.project_id;

  ELSIF OLD.status IN ('queued', 'processing') AND NEW.status = 'failed' THEN
    NEW.completed_at := now();
    NEW.output_media_path := NULL;
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

-- Atomic job claiming RPC using FOR UPDATE SKIP LOCKED (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.claim_project_render_job(p_job_id UUID DEFAULT NULL)
RETURNS SETOF public.project_render_jobs
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_target_id UUID;
BEGIN
  SELECT rj.id
  INTO v_target_id
  FROM public.project_render_jobs rj
  JOIN public.collaborative_projects cp ON cp.id = rj.project_id
  WHERE rj.status = 'queued'
    AND cp.status = 'rendering'
    AND (p_job_id IS NULL OR rj.id = p_job_id)
    AND public.is_project_editor(rj.project_id, (select auth.uid()))
    AND NOT public.is_account_restricted((select auth.uid()))
  ORDER BY rj.created_at ASC
  FOR UPDATE OF rj SKIP LOCKED
  LIMIT 1;

  IF v_target_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.project_render_jobs rj
  SET status = 'processing',
      started_at = now(),
      updated_at = now()
  WHERE rj.id = v_target_id
    AND rj.status = 'queued'
  RETURNING rj.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_project_render_job(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_project_render_job(UUID) TO authenticated;
