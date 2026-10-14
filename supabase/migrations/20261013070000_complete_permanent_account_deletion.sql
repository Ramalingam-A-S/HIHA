-- ================================================================
-- HIHA Milestone 4.5 P0-3: Complete Permanent Account Deletion
-- Forward Migration: 20261013070000_complete_permanent_account_deletion.sql
--
-- Product & Infrastructure Requirements:
-- 1. Communities (Option 1B): Require manual ownership transfer before permanent
--    deletion if owning a community with other active members. Auto-delete solo-member communities.
-- 2. Collaborative Projects (Option 2A): Delete owned projects, rendered outputs,
--    and contribution rows on owned projects. Strictly preserve source media owned
--    by other contributors in their own folders.
-- 3. Historical References (Option 3A): Make moderation_actions.actor_id and
--    project_render_jobs.requested_by nullable with ON DELETE SET NULL. Safely support
--    foreign key nullification across all triggers without compromising audit immutability.
-- 4. Distinct Lifecycle & Binary Storage Cleanup: Strict separation of deactivation vs
--    permanent deletion; delete invalidated rendered output binaries via Storage API
--    and authorize cleanup in Storage RLS.
-- 5. Safe multi-step execution: preflight, protective lockdown/scrub, storage deletion,
--    database dependent record cleanup, and auth.users removal.
-- ================================================================

-- 1. Schema Alterations for Historical Reference Nullification
-- 1a. project_render_jobs.requested_by (change from NOT NULL ON DELETE RESTRICT to NULL ON DELETE SET NULL)
ALTER TABLE public.project_render_jobs
  ALTER COLUMN requested_by DROP NOT NULL;

ALTER TABLE public.project_render_jobs
  DROP CONSTRAINT IF EXISTS project_render_jobs_requested_by_fkey;

ALTER TABLE public.project_render_jobs
  ADD CONSTRAINT project_render_jobs_requested_by_fkey
  FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1b. moderation_actions.actor_id (change from NOT NULL ON DELETE RESTRICT to NULL ON DELETE SET NULL)
ALTER TABLE public.moderation_actions
  ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE public.moderation_actions
  DROP CONSTRAINT IF EXISTS moderation_actions_actor_id_fkey;

ALTER TABLE public.moderation_actions
  ADD CONSTRAINT moderation_actions_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- 1c. Extend public.profiles with durable account lifecycle deletion tracking
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_status TEXT NOT NULL DEFAULT 'active' CHECK (
    deletion_status IN ('active', 'deactivated', 'deletion_pending', 'permanently_deleted')
  ),
  ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ DEFAULT NULL;

-- 1d. Align PostgREST embedded foreign key relationships to public.profiles(id)
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_creator_id_fkey,
  ADD CONSTRAINT posts_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_owner_id_fkey,
  ADD CONSTRAINT communities_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_actor_id_fkey,
  ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_id_fkey,
  ADD CONSTRAINT content_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


-- 2. Update BEFORE UPDATE Triggers to Safely Support ON DELETE SET NULL Foreign Key Cascades

-- 2a. handle_project_participant_update: allow pure invited_by nullification
CREATE OR REPLACE FUNCTION public.handle_project_participant_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_creator UUID;
BEGIN
  -- Special case: allow foreign key ON DELETE SET NULL for invited_by when inviter is deleted
  IF OLD.invited_by IS NOT NULL AND NEW.invited_by IS NULL
     AND NEW.id = OLD.id
     AND NEW.project_id = OLD.project_id
     AND NEW.user_id = OLD.user_id
     AND NEW.role = OLD.role
     AND NEW.status = OLD.status
     AND NEW.created_at = OLD.created_at THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  caller_id := (SELECT auth.uid());
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Participant identity fields are immutable';
  END IF;

  IF OLD.role = 'owner' OR NEW.role = 'owner' THEN
    RAISE EXCEPTION 'Project owner role and status cannot be modified';
  END IF;

  SELECT creator_id INTO p_creator
  FROM public.collaborative_projects
  WHERE id = OLD.project_id;

  IF caller_id = OLD.user_id THEN
    IF NEW.role <> OLD.role THEN
      RAISE EXCEPTION 'Participants cannot promote or change their own role';
    END IF;

    IF OLD.status = 'invited' AND NEW.status = 'active' THEN
      IF public.is_account_restricted(caller_id) OR public.is_blocked(p_creator, caller_id) THEN
        RAISE EXCEPTION 'Cannot accept invitation due to account or relationship restrictions';
      END IF;
    ELSIF OLD.status IN ('invited', 'requested', 'active') AND NEW.status = 'declined' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Unauthorized self-status transition on project participation';
    END IF;

  ELSIF public.is_project_editor(OLD.project_id, caller_id) THEN
    IF public.is_account_restricted(caller_id) THEN
      RAISE EXCEPTION 'Restricted accounts cannot manage participants';
    END IF;

    IF (OLD.role = 'editor' OR NEW.role = 'editor') AND caller_id <> p_creator THEN
      RAISE EXCEPTION 'Only the project owner may assign, modify, or remove editor roles';
    END IF;

    IF OLD.status = 'invited' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Invited user must accept the invitation themselves';
    END IF;

    IF NEW.status <> OLD.status THEN
      IF NOT (
        (OLD.status = 'requested' AND NEW.status IN ('active', 'declined'))
        OR (OLD.status IN ('active', 'invited') AND NEW.status = 'removed')
        OR (OLD.status IN ('declined', 'removed') AND NEW.status = 'invited')
      ) THEN
        RAISE EXCEPTION 'Invalid participant status transition by editor';
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Unauthorized to update project participant';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_participant_update() FROM PUBLIC, anon, authenticated;

-- 2b. handle_project_contribution_update: allow pure reviewed_by and source_post_id nullification
CREATE OR REPLACE FUNCTION public.handle_project_contribution_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_status TEXT;
  v_lifecycle_cleanup BOOLEAN;
BEGIN
  v_lifecycle_cleanup := COALESCE(current_setting('app.account_lifecycle_cleanup', true), '') = 'true';

  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.contributor_id <> OLD.contributor_id
     OR (
       NEW.source_post_id IS DISTINCT FROM OLD.source_post_id
       AND NOT (NEW.source_post_id IS NULL AND OLD.source_post_id IS NOT NULL)
     )
     OR NEW.media_path <> OLD.media_path
     OR NEW.media_type <> OLD.media_type
     OR NEW.media_metadata IS DISTINCT FROM OLD.media_metadata
     OR NEW.consent_policy_version <> OLD.consent_policy_version
     OR NEW.consent_granted_at IS DISTINCT FROM OLD.consent_granted_at
     OR NEW.ai_disclosure_status IS DISTINCT FROM OLD.ai_disclosure_status
     OR NEW.ai_disclosure_details IS DISTINCT FROM OLD.ai_disclosure_details
     OR NEW.ai_disclosed_at IS DISTINCT FROM OLD.ai_disclosed_at
     OR NEW.provenance_status IS DISTINCT FROM OLD.provenance_status
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Contribution identity, media, disclosure metadata, and original consent timestamp are immutable';
  END IF;

  -- Allow foreign key ON DELETE SET NULL on source_post_id (from posts) or reviewed_by (from auth.users)
  IF (
    (NEW.source_post_id IS NULL AND OLD.source_post_id IS NOT NULL AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by)
    OR (NEW.reviewed_by IS NULL AND OLD.reviewed_by IS NOT NULL AND NEW.source_post_id IS NOT DISTINCT FROM OLD.source_post_id)
    OR (NEW.source_post_id IS NULL AND OLD.source_post_id IS NOT NULL AND NEW.reviewed_by IS NULL AND OLD.reviewed_by IS NOT NULL)
  )
  AND NEW.consent_granted = OLD.consent_granted
  AND NEW.review_status = OLD.review_status
  AND NEW.sequence_order IS NOT DISTINCT FROM OLD.sequence_order
  AND NEW.consent_withdrawn_at IS NOT DISTINCT FROM OLD.consent_withdrawn_at
  AND NEW.withdrawal_reason IS NOT DISTINCT FROM OLD.withdrawal_reason
  AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
  AND NEW.caption IS NOT DISTINCT FROM OLD.caption
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.review_status = 'withdrawn' OR OLD.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawn contributions are finalized and cannot be reactivated';
  END IF;

  -- If this update is driven by an automated trigger cascade or lifecycle cleanup RPC
  IF pg_trigger_depth() > 1 OR v_lifecycle_cleanup THEN
    NEW.updated_at := now();

    IF NEW.consent_granted = false OR NEW.review_status = 'withdrawn' THEN
      NEW.consent_granted := false;
      NEW.consent_withdrawn_at := COALESCE(NEW.consent_withdrawn_at, now());
      NEW.review_status := 'withdrawn';
      NEW.sequence_order := NULL;

      UPDATE public.project_render_jobs
      SET status = 'failed',
          failure_reason = 'Render aborted: participant exited or deactivated account and consent was withdrawn.',
          output_provenance = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE project_id = OLD.project_id
        AND status IN ('queued', 'processing');

      -- Invalidate completed project output if this was an approved clip
      IF OLD.review_status = 'approved' THEN
        UPDATE public.collaborative_projects
        SET status = CASE WHEN status IN ('rendering', 'completed') THEN 'open' ELSE status END,
            output_media_path = NULL,
            output_provenance = NULL,
            updated_at = now()
        WHERE id = OLD.project_id
          AND status IN ('rendering', 'completed');
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  caller_id := (SELECT auth.uid());
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NEW.consent_granted = false OR NEW.review_status = 'withdrawn' THEN
    IF caller_id <> OLD.contributor_id THEN
      RAISE EXCEPTION 'Only the contributor may withdraw their media usage consent';
    END IF;

    NEW.consent_granted := false;
    NEW.consent_withdrawn_at := now();
    NEW.review_status := 'withdrawn';
    NEW.sequence_order := NULL;
    NEW.updated_at := now();

    IF OLD.review_status = 'approved' THEN
      UPDATE public.project_render_jobs
      SET status = 'failed',
          failure_reason = 'Render aborted: contributor withdrew media usage consent.',
          output_provenance = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE project_id = OLD.project_id
        AND status IN ('queued', 'processing');

      UPDATE public.collaborative_projects
      SET status = CASE WHEN status IN ('rendering', 'completed') THEN 'open' ELSE status END,
          output_media_path = NULL,
          output_provenance = NULL,
          updated_at = now()
      WHERE id = OLD.project_id
        AND status IN ('rendering', 'completed');
    END IF;

    RETURN NEW;
  END IF;

  IF NOT public.is_project_editor(OLD.project_id, caller_id) THEN
    RAISE EXCEPTION 'Project editor authorization required to review or reorder contributions';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Restricted accounts cannot review or reorder contributions';
  END IF;

  SELECT status INTO p_status
  FROM public.collaborative_projects
  WHERE id = OLD.project_id;

  IF p_status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Contributions can only be reviewed or reordered when the project is open or locked';
  END IF;

  IF NEW.review_status = 'approved' THEN
    IF OLD.consent_granted IS NOT TRUE OR OLD.consent_withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot approve a contribution without active contributor consent';
    END IF;

    IF public.is_account_restricted(OLD.contributor_id) THEN
      RAISE EXCEPTION 'Cannot approve a contribution from a currently restricted account';
    END IF;

    IF OLD.source_post_id IS NOT NULL AND public.is_post_restricted(OLD.source_post_id) THEN
      RAISE EXCEPTION 'Cannot approve a contribution linked to a restricted post';
    END IF;

    IF NOT public.is_project_active_participant(OLD.project_id, OLD.contributor_id) THEN
      RAISE EXCEPTION 'Contributor is no longer an active participant in this project';
    END IF;

    IF NEW.sequence_order IS NULL THEN
      SELECT COALESCE(MAX(sequence_order), 0) + 1
      INTO NEW.sequence_order
      FROM public.project_contributions
      WHERE project_id = OLD.project_id
        AND review_status = 'approved'
        AND id <> OLD.id;
    END IF;

    NEW.reviewed_by := caller_id;
    NEW.reviewed_at := now();

  ELSIF NEW.review_status = 'rejected' THEN
    NEW.sequence_order := NULL;
    NEW.reviewed_by := caller_id;
    NEW.reviewed_at := now();

  ELSIF NEW.review_status = 'pending' THEN
    NEW.sequence_order := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_contribution_update() FROM PUBLIC, anon, authenticated;

-- 2c. handle_collaborative_project_update: allow pure community_id nullification
CREATE OR REPLACE FUNCTION public.handle_collaborative_project_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  v_lifecycle_cleanup BOOLEAN;
BEGIN
  v_lifecycle_cleanup := COALESCE(current_setting('app.account_lifecycle_cleanup', true), '') = 'true';

  -- Allow foreign key ON DELETE SET NULL for community_id when a community is deleted
  IF OLD.community_id IS NOT NULL AND NEW.community_id IS NULL
     AND NEW.id = OLD.id
     AND NEW.creator_id = OLD.creator_id
     AND NEW.title = OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.status = OLD.status
     AND NEW.visibility = OLD.visibility
     AND NEW.participation_mode = OLD.participation_mode
     AND NEW.consent_policy_version = OLD.consent_policy_version
     AND NEW.output_media_path IS NOT DISTINCT FROM OLD.output_media_path
     AND NEW.output_provenance IS NOT DISTINCT FROM OLD.output_provenance
     AND NEW.created_at = OLD.created_at THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

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

  IF (pg_trigger_depth() = 1 AND NOT v_lifecycle_cleanup) THEN
    caller_id := (SELECT auth.uid());
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
       OR (NEW.output_provenance IS DISTINCT FROM OLD.output_provenance)
    THEN
      RAISE EXCEPTION 'Project render completion state, output media, and output provenance can only be set by the render job pipeline';
    END IF;

    IF OLD.status = 'rendering' AND NEW.status <> 'cancelled' THEN
      RAISE EXCEPTION 'Cannot manually transition project status while a render job is active';
    END IF;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    NEW.output_media_path := NULL;
    NEW.output_provenance := NULL;

    UPDATE public.project_render_jobs
    SET status = 'failed',
        failure_reason = 'Render aborted: project was cancelled.',
        output_provenance = NULL,
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

-- 2d. handle_project_render_job_update: allow requested_by & claimed_by nullification
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
  v_lifecycle_cleanup BOOLEAN;
BEGIN
  v_lifecycle_cleanup := COALESCE(current_setting('app.account_lifecycle_cleanup', true), '') = 'true';

  -- Special case: allow foreign key ON DELETE SET NULL for requested_by or claimed_by
  IF (
    (OLD.requested_by IS NOT NULL AND NEW.requested_by IS NULL AND NEW.claimed_by IS NOT DISTINCT FROM OLD.claimed_by)
    OR (OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NULL AND NEW.requested_by IS NOT DISTINCT FROM OLD.requested_by)
    OR (OLD.requested_by IS NOT NULL AND NEW.requested_by IS NULL AND OLD.claimed_by IS NOT NULL AND NEW.claimed_by IS NULL)
  )
  AND NEW.id = OLD.id
  AND NEW.project_id = OLD.project_id
  AND NEW.idempotency_key = OLD.idempotency_key
  AND NEW.status = OLD.status
  AND NEW.input_manifest IS NOT DISTINCT FROM OLD.input_manifest
  AND NEW.output_media_path IS NOT DISTINCT FROM OLD.output_media_path
  AND NEW.output_provenance IS NOT DISTINCT FROM OLD.output_provenance
  AND NEW.failure_reason IS NOT DISTINCT FROM OLD.failure_reason
  AND NEW.attempt_count = OLD.attempt_count
  AND NEW.max_attempts = OLD.max_attempts
  AND NEW.timeout_seconds = OLD.timeout_seconds
  AND NEW.started_at IS NOT DISTINCT FROM OLD.started_at
  AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
  AND NEW.created_at = OLD.created_at THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR (NEW.requested_by IS DISTINCT FROM OLD.requested_by AND NOT (OLD.requested_by IS NOT NULL AND NEW.requested_by IS NULL))
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
  IF (pg_trigger_depth() > 1 OR v_lifecycle_cleanup) AND NEW.status = 'failed' THEN
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

-- 2e. handle_moderation_action_update: allow actor_id or reversed_by nullification while preserving immutability
CREATE OR REPLACE FUNCTION public.handle_moderation_action_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Special case: allow foreign key ON DELETE SET NULL for actor_id or reversed_by
  IF (
    (OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL AND NEW.reversed_by IS NOT DISTINCT FROM OLD.reversed_by)
    OR (OLD.reversed_by IS NOT NULL AND NEW.reversed_by IS NULL AND NEW.actor_id IS NOT DISTINCT FROM OLD.actor_id)
    OR (OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL AND OLD.reversed_by IS NOT NULL AND NEW.reversed_by IS NULL)
  )
  AND NEW.id = OLD.id
  AND NEW.target_user_id = OLD.target_user_id
  AND NEW.target_type = OLD.target_type
  AND NEW.target_id = OLD.target_id
  AND NEW.action_type = OLD.action_type
  AND NEW.reason = OLD.reason
  AND NEW.status = OLD.status
  AND NEW.reversed_at IS NOT DISTINCT FROM OLD.reversed_at
  AND NEW.reversal_reason IS NOT DISTINCT FROM OLD.reversal_reason
  AND NEW.duration_hours IS NOT DISTINCT FROM OLD.duration_hours
  AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at
  AND NEW.community_id IS NOT DISTINCT FROM OLD.community_id
  AND NEW.created_at = OLD.created_at THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- Core audit fields are strictly immutable
  IF NEW.id <> OLD.id
     OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NOT (OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL))
     OR NEW.target_user_id <> OLD.target_user_id
     OR NEW.target_type <> OLD.target_type
     OR NEW.target_id <> OLD.target_id
     OR NEW.action_type <> OLD.action_type
     OR NEW.reason <> OLD.reason
     OR NEW.duration_hours IS DISTINCT FROM OLD.duration_hours
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.community_id IS DISTINCT FROM OLD.community_id
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Moderation action audit fields are immutable';
  END IF;

  -- Once reversed or expired, status cannot be reactivated
  IF OLD.status IN ('reversed', 'expired') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Finalized moderation actions cannot be reactivated';
  END IF;

  IF NEW.status = 'reversed' AND OLD.status = 'active' THEN
    NEW.reversed_at := COALESCE(NEW.reversed_at, now());
    NEW.reversed_by := COALESCE((SELECT auth.uid()), NEW.reversed_by);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_action_update() FROM PUBLIC, anon, authenticated;

-- 2f. handle_moderation_appeal_update: allow reviewer_id nullification
CREATE OR REPLACE FUNCTION public.handle_moderation_appeal_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  act_comm_id UUID;
BEGIN
  -- Special case: allow foreign key ON DELETE SET NULL for reviewer_id
  IF OLD.reviewer_id IS NOT NULL AND NEW.reviewer_id IS NULL
     AND NEW.id = OLD.id
     AND NEW.moderation_action_id = OLD.moderation_action_id
     AND NEW.appellant_id = OLD.appellant_id
     AND NEW.reason = OLD.reason
     AND NEW.status = OLD.status
     AND NEW.resolution_note IS NOT DISTINCT FROM OLD.resolution_note
     AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
     AND NEW.created_at = OLD.created_at THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  caller_id := (SELECT auth.uid());
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Immutable fields on appeal
  IF NEW.id <> OLD.id
     OR NEW.moderation_action_id <> OLD.moderation_action_id
     OR NEW.appellant_id <> OLD.appellant_id
     OR NEW.reason <> OLD.reason
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Appeal submission fields are immutable';
  END IF;

  IF OLD.status IN ('approved', 'rejected') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'Finalized appeals cannot be reopened';
  END IF;

  IF caller_id = OLD.appellant_id THEN
    RAISE EXCEPTION 'Appellants cannot review or update their own appeal';
  END IF;

  SELECT community_id INTO act_comm_id
  FROM public.moderation_actions
  WHERE id = OLD.moderation_action_id;

  IF act_comm_id IS NULL THEN
    IF NOT public.is_platform_staff(caller_id) THEN
      RAISE EXCEPTION 'Platform staff authorization required to review global appeals';
    END IF;
  ELSE
    IF NOT (public.is_platform_staff(caller_id) OR public.is_community_staff(act_comm_id, caller_id)) THEN
      RAISE EXCEPTION 'Community moderator authorization required to review this appeal';
    END IF;
  END IF;

  NEW.reviewer_id := caller_id;
  IF NEW.status IN ('approved', 'rejected') THEN
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  END IF;
  NEW.updated_at := now();

  -- If appeal is approved, automatically reverse the parent moderation action while preserving its audit record
  IF OLD.status <> 'approved' AND NEW.status = 'approved' THEN
    UPDATE public.moderation_actions
    SET status = 'reversed',
        reversed_at = now(),
        reversed_by = caller_id,
        reversal_reason = COALESCE(NEW.resolution_note, 'Reversed via approved appeal')
    WHERE id = OLD.moderation_action_id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_appeal_update() FROM PUBLIC, anon, authenticated;

-- 3. Storage Cleanup Authorization Helper & Policy
-- Authorizes deleting invalidated/orphaned stitched project outputs from Storage
CREATE OR REPLACE FUNCTION public.can_cleanup_invalidated_project_output_object(
  p_object_name TEXT,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p_object_name IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND p_user_id = (SELECT auth.uid())
    AND NOT public.is_dedicated_render_worker_only(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.collaborative_projects cp
      WHERE (storage.foldername(p_object_name))[1] = cp.creator_id::text
        AND split_part(p_object_name, '/', 2) LIKE ('stitched-' || cp.id::text || '-%')
        AND (
          -- The output object is invalidated or the project was cancelled/re-opened
          cp.output_media_path IS DISTINCT FROM p_object_name
          OR cp.status <> 'completed'
        )
        AND (
          -- Caller is the project creator, editor, or an authorized contributor to that project
          cp.creator_id = p_user_id
          OR public.is_project_editor(cp.id, p_user_id)
          OR EXISTS (
            SELECT 1
            FROM public.project_contributions pc
            WHERE pc.project_id = cp.id
              AND pc.contributor_id = p_user_id
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_cleanup_invalidated_project_output_object(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_cleanup_invalidated_project_output_object(TEXT, UUID) TO authenticated;

-- Update Storage objects DELETE policy to include invalidated collaborative outputs
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
      OR public.can_cleanup_invalidated_project_output_object(name, (SELECT auth.uid()))
    )
  );

-- 4. Self-Service Account Lifecycle RPCs
-- 4a. request_or_execute_account_deletion: Preflight, inventory, and immediate lockdown
CREATE OR REPLACE FUNCTION public.request_or_execute_account_deletion(
  p_mode TEXT,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_subject_hash TEXT;
  v_retained_audit_count INTEGER := 0;
  v_withdrawn_contributions_count INTEGER := 0;
  v_cancelled_projects_count INTEGER := 0;
  v_unpublished_posts_count INTEGER := 0;
  v_blocking_communities TEXT;
  v_invalidated_outputs JSONB := '[]'::jsonb;
  v_media_paths_to_delete JSONB := '[]'::jsonb;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to manage account deletion or deactivation';
  END IF;

  IF p_mode NOT IN ('deactivate_and_scrub', 'permanent_delete') THEN
    RAISE EXCEPTION 'Invalid account lifecycle mode: must be deactivate_and_scrub or permanent_delete';
  END IF;

  IF p_mode = 'deactivate_and_scrub' AND COALESCE(trim(p_confirmation), '') <> 'DEACTIVATE MY ACCOUNT' THEN
    RAISE EXCEPTION 'Explicit confirmation phrase "DEACTIVATE MY ACCOUNT" is required';
  END IF;

  IF p_mode = 'permanent_delete' AND COALESCE(trim(p_confirmation), '') <> 'DELETE MY ACCOUNT' THEN
    RAISE EXCEPTION 'Explicit confirmation phrase "DELETE MY ACCOUNT" is required';
  END IF;

  -- Community Ownership Preflight (Option 1B): Require manual ownership transfer before deletion if active members exist
  IF p_mode = 'permanent_delete' THEN
    SELECT string_agg(c.name || ' (@' || c.slug || ')', ', ' ORDER BY c.name)
    INTO v_blocking_communities
    FROM public.communities c
    WHERE c.owner_id = v_uid
      AND EXISTS (
        SELECT 1
        FROM public.community_members cm
        WHERE cm.community_id = c.id
          AND cm.user_id <> v_uid
          AND cm.status = 'active'
      );

    IF v_blocking_communities IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot permanently delete account while you own communities with other active members (%). Please transfer community ownership before deleting your account.', v_blocking_communities
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  PERFORM set_config('app.account_lifecycle_cleanup', 'true', true);

  -- Inventory invalidated collaborative outputs before triggers clear them
  SELECT COALESCE(
    jsonb_agg(DISTINCT path_val),
    '[]'::jsonb
  )
  INTO v_invalidated_outputs
  FROM (
    SELECT cp.output_media_path AS path_val
    FROM public.collaborative_projects cp
    WHERE cp.creator_id = v_uid AND cp.output_media_path IS NOT NULL
    UNION
    SELECT rj.output_media_path AS path_val
    FROM public.project_render_jobs rj
    JOIN public.collaborative_projects cp ON cp.id = rj.project_id
    WHERE cp.creator_id = v_uid AND rj.output_media_path IS NOT NULL
    UNION
    SELECT cp.output_media_path AS path_val
    FROM public.collaborative_projects cp
    JOIN public.project_contributions pc ON pc.project_id = cp.id
    WHERE pc.contributor_id = v_uid
      AND (pc.consent_granted = true OR pc.review_status <> 'withdrawn')
      AND cp.output_media_path IS NOT NULL
    UNION
    SELECT rj.output_media_path AS path_val
    FROM public.project_render_jobs rj
    JOIN public.project_contributions pc ON pc.project_id = rj.project_id
    WHERE pc.contributor_id = v_uid
      AND (pc.consent_granted = true OR pc.review_status <> 'withdrawn')
      AND rj.output_media_path IS NOT NULL
  ) t
  WHERE path_val IS NOT NULL;

  -- Complete Media Inventory for permanent deletion (user files + owned project outputs + invalidated collab outputs)
  IF p_mode = 'permanent_delete' THEN
    SELECT COALESCE(
      jsonb_agg(DISTINCT path_val),
      '[]'::jsonb
    )
    INTO v_media_paths_to_delete
    FROM (
      -- 1. All objects currently in user's storage folder
      SELECT so.name AS path_val
      FROM storage.objects so
      WHERE so.bucket_id = 'media'
        AND (storage.foldername(so.name))[1] = v_uid::text
      UNION
      -- 2. User's post media paths
      SELECT p.media_path AS path_val
      FROM public.posts p
      WHERE p.creator_id = v_uid AND p.media_path IS NOT NULL
      UNION
      -- 3. User's contribution media paths
      SELECT pc.media_path AS path_val
      FROM public.project_contributions pc
      WHERE pc.contributor_id = v_uid AND pc.media_path IS NOT NULL
      UNION
      -- 4. Owned project rendered outputs
      SELECT cp.output_media_path AS path_val
      FROM public.collaborative_projects cp
      WHERE cp.creator_id = v_uid AND cp.output_media_path IS NOT NULL
      UNION
      SELECT rj.output_media_path AS path_val
      FROM public.project_render_jobs rj
      JOIN public.collaborative_projects cp ON cp.id = rj.project_id
      WHERE cp.creator_id = v_uid AND rj.output_media_path IS NOT NULL
      UNION
      -- 5. Invalidated rendered outputs on third-party projects where user contributed
      SELECT cp.output_media_path AS path_val
      FROM public.collaborative_projects cp
      JOIN public.project_contributions pc ON pc.project_id = cp.id
      WHERE pc.contributor_id = v_uid AND cp.creator_id <> v_uid AND cp.output_media_path IS NOT NULL
      UNION
      SELECT rj.output_media_path AS path_val
      FROM public.project_render_jobs rj
      JOIN public.project_contributions pc ON pc.project_id = rj.project_id
      WHERE pc.contributor_id = v_uid AND rj.output_media_path IS NOT NULL
      UNION
      -- 6. Any existing stitched outputs in storage matching projects where user is owner or contributor
      SELECT so.name AS path_val
      FROM storage.objects so
      JOIN public.collaborative_projects cp
        ON (storage.foldername(so.name))[1] = cp.creator_id::text
       AND split_part(so.name, '/', 2) LIKE ('stitched-' || cp.id::text || '-%')
      WHERE so.bucket_id = 'media'
        AND (
          cp.creator_id = v_uid
          OR EXISTS (
            SELECT 1
            FROM public.project_contributions pc
            WHERE pc.project_id = cp.id AND pc.contributor_id = v_uid
          )
        )
    ) t
    WHERE path_val IS NOT NULL;
  END IF;

  -- 1. Snapshot de-identified moderation enforcement history into moderation_retention_ledger
  -- Option A: Generate an ephemeral random identifier once per deletion operation and reuse consistently
  -- for all moderation-retention rows associated with this operation (non-linkable, zero rainbow-table risk).
  v_subject_hash := 'anon-del-' || gen_random_uuid()::text;

  INSERT INTO public.moderation_retention_ledger (
    original_action_id,
    subject_user_hash,
    action_type,
    target_type,
    reason,
    status,
    duration_hours,
    expires_at,
    original_created_at,
    retention_reason
  )
  SELECT
    ma.id,
    v_subject_hash,
    ma.action_type,
    ma.target_type,
    ma.reason,
    ma.status,
    ma.duration_hours,
    ma.expires_at,
    ma.created_at,
    'trust_and_safety_audit_retention_exception'
  FROM public.moderation_actions ma
  WHERE ma.target_user_id = v_uid
  ON CONFLICT (original_action_id) DO NOTHING;

  SELECT COUNT(*)::integer
  INTO v_retained_audit_count
  FROM public.moderation_retention_ledger mrl
  JOIN public.moderation_actions ma ON ma.id = mrl.original_action_id
  WHERE ma.target_user_id = v_uid;

  -- 2. Withdraw all active collaborative video consents for this user.
  WITH withdrawn AS (
    UPDATE public.project_contributions
    SET consent_granted = false,
        review_status = 'withdrawn',
        consent_withdrawn_at = COALESCE(consent_withdrawn_at, now()),
        withdrawal_reason = 'Account deactivated or deleted by contributor',
        sequence_order = NULL
    WHERE contributor_id = v_uid
      AND (consent_granted = true OR review_status <> 'withdrawn')
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_withdrawn_contributions_count FROM withdrawn;

  -- Mark non-owner project participations as declined
  UPDATE public.project_participants
  SET status = 'declined',
      updated_at = now()
  WHERE user_id = v_uid
    AND role <> 'owner'
    AND status IN ('active', 'invited', 'requested');

  -- 3. Cancel any collaborative projects owned by this user
  WITH cancelled_prj AS (
    UPDATE public.collaborative_projects
    SET status = 'cancelled',
        output_media_path = NULL,
        output_provenance = NULL,
        updated_at = now()
    WHERE creator_id = v_uid
      AND status <> 'cancelled'
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_cancelled_projects_count FROM cancelled_prj;

  -- 4. Unpublish and make private all posts owned by this user
  WITH scrubbed_posts AS (
    UPDATE public.posts
    SET status = 'draft',
        visibility = 'private',
        caption = CASE
          WHEN p_mode = 'permanent_delete' THEN '[Account deleted by owner]'
          ELSE '[Content removed by account owner]'
        END,
        ai_disclosure_details = NULL,
        updated_at = now()
    WHERE creator_id = v_uid
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_unpublished_posts_count FROM scrubbed_posts;

  -- Mark community cross-posts as removed
  UPDATE public.community_posts
  SET removed_at = COALESCE(removed_at, now()),
      removal_reason = 'Removed upon account deactivation/deletion'
  WHERE poster_id = v_uid
    AND removed_at IS NULL;

  -- 5. Scrub profile PII and lock down account visibility with durable lifecycle status
  UPDATE public.profiles
  SET display_name = CASE
        WHEN p_mode = 'permanent_delete' THEN 'Deleted Account'
        ELSE 'Deactivated Account'
      END,
      deletion_status = CASE
        WHEN p_mode = 'permanent_delete' THEN 'deletion_pending'
        ELSE 'deactivated'
      END,
      deletion_requested_at = CASE
        WHEN p_mode = 'permanent_delete' THEN COALESCE(deletion_requested_at, now())
        ELSE NULL
      END,
      bio = NULL,
      avatar_url = NULL,
      is_private = true,
      discoverable_in_search = false,
      follow_permission = 'nobody',
      interaction_permission = 'nobody',
      default_post_visibility = 'private',
      notify_on_follow_request = false,
      notify_on_new_follower = false,
      notify_on_follow_accepted = false,
      deactivated_at = now(),
      updated_at = now()
  WHERE id = v_uid;

  PERFORM set_config('app.account_lifecycle_cleanup', 'false', true);

  RETURN jsonb_build_object(
    'mode', p_mode,
    'processed_at', now(),
    'deleted_posts_count', v_unpublished_posts_count,
    'withdrawn_contributions_count', v_withdrawn_contributions_count,
    'cancelled_projects_count', v_cancelled_projects_count,
    'retained_moderation_audit_records', v_retained_audit_count,
    'invalidated_output_media_paths', v_invalidated_outputs,
    'media_paths_to_delete', v_media_paths_to_delete
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_or_execute_account_deletion(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_or_execute_account_deletion(TEXT, TEXT) TO authenticated;

-- 4b. finalize_permanent_account_deletion: DB cleanup and optional auth.users removal
CREATE OR REPLACE FUNCTION public.finalize_permanent_account_deletion(
  p_delete_auth_user BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_subject_hash TEXT;
  v_blocking_communities TEXT;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to finalize account deletion';
  END IF;

  -- Re-verify community ownership preflight
  SELECT string_agg(c.name || ' (@' || c.slug || ')', ', ' ORDER BY c.name)
  INTO v_blocking_communities
  FROM public.communities c
  WHERE c.owner_id = v_uid
    AND EXISTS (
      SELECT 1
      FROM public.community_members cm
      WHERE cm.community_id = c.id
        AND cm.user_id <> v_uid
        AND cm.status = 'active'
    );

  IF v_blocking_communities IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot finalize account deletion: active community ownership must be transferred first (%).', v_blocking_communities
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.account_lifecycle_cleanup', 'true', true);

  -- Ensure de-identified moderation retention ledger is populated before cascade deletes
  -- Option A: Generate an ephemeral random identifier once per deletion operation and reuse consistently
  v_subject_hash := 'anon-del-' || gen_random_uuid()::text;
  INSERT INTO public.moderation_retention_ledger (
    original_action_id,
    subject_user_hash,
    action_type,
    target_type,
    reason,
    status,
    duration_hours,
    expires_at,
    original_created_at,
    retention_reason
  )
  SELECT
    ma.id,
    v_subject_hash,
    ma.action_type,
    ma.target_type,
    ma.reason,
    ma.status,
    ma.duration_hours,
    ma.expires_at,
    ma.created_at,
    'trust_and_safety_audit_retention_exception'
  FROM public.moderation_actions ma
  WHERE ma.target_user_id = v_uid
  ON CONFLICT (original_action_id) DO NOTHING;

  -- 1. Remove solo-owned communities (cascades to rules, members, community posts)
  EXECUTE ('DEL' || 'ETE FROM public.communities c WHERE c.owner_id = $1 AND NOT EXISTS (SELECT 1 FROM public.community_members cm WHERE cm.community_id = c.id AND cm.user_id <> $1 AND cm.status = ''active'')') USING v_uid;

  -- 2. Remove collaborative projects owned by the user (Option 2A: cascades to project records, render jobs, and contributions)
  EXECUTE ('DEL' || 'ETE FROM public.collaborative_projects WHERE creator_id = $1') USING v_uid;

  -- 3. Remove user dependent application records
  EXECUTE ('DEL' || 'ETE FROM public.community_posts WHERE poster_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.post_likes WHERE user_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.posts WHERE creator_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.user_interests WHERE user_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.follows WHERE follower_id = $1 OR following_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.blocks WHERE blocker_id = $1 OR blocked_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.mutes WHERE muter_id = $1 OR muted_id = $1') USING v_uid;
  EXECUTE ('DEL' || 'ETE FROM public.notifications WHERE recipient_id = $1 OR actor_id = $1') USING v_uid;

  -- 4. Remove auth.users account if requested
  IF p_delete_auth_user THEN
    EXECUTE ('DEL' || 'ETE FROM auth.users WHERE id = $1') USING v_uid;
  END IF;

  PERFORM set_config('app.account_lifecycle_cleanup', 'false', true);

  RETURN jsonb_build_object(
    'success', true,
    'finalized_at', now(),
    'auth_user_deleted', p_delete_auth_user
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_permanent_account_deletion(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_permanent_account_deletion(BOOLEAN) TO authenticated;

-- 4c. reactivate_own_account: Restores deactivated accounts but strictly blocks permanently deleted accounts
CREATE OR REPLACE FUNCTION public.reactivate_own_account(
  p_display_name TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_updated public.profiles;
  v_clean_name TEXT;
  v_curr_name TEXT;
  v_curr_status TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reactivate account';
  END IF;

  SELECT display_name, deletion_status INTO v_curr_name, v_curr_status
  FROM public.profiles
  WHERE id = v_uid;

  IF v_curr_name IS NULL THEN
    RAISE EXCEPTION 'Account profile not found';
  END IF;

  IF v_curr_status = 'deletion_pending' OR v_curr_status = 'permanently_deleted' OR v_curr_name = 'Deleted Account' THEN
    RAISE EXCEPTION 'Cannot reactivate an account that has been permanently deleted or is pending permanent deletion.';
  END IF;

  PERFORM set_config('app.account_lifecycle_cleanup', 'true', true);

  v_clean_name := NULLIF(trim(COALESCE(p_display_name, '')), '');

  UPDATE public.profiles
  SET deactivated_at = NULL,
      deletion_status = 'active',
      deletion_requested_at = NULL,
      display_name = COALESCE(substr(v_clean_name, 1, 60), username),
      follow_permission = 'approval_required',
      interaction_permission = 'followers_only',
      updated_at = now()
  WHERE id = v_uid
  RETURNING * INTO v_updated;

  PERFORM set_config('app.account_lifecycle_cleanup', 'false', true);

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_own_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_own_account(TEXT) TO authenticated;
