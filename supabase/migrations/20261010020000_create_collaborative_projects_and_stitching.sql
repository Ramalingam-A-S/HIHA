-- Migration: 20261010020000_create_collaborative_projects_and_stitching.sql
-- Description: Collaborative content creation projects, participant roles, explicit consent contributions, durable video stitching render jobs, and storage RLS integration.
-- Depends on: 20261010010000_create_moderation_enforcement_and_appeals.sql

-- ================================================================
-- 1. collaborative_projects table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.collaborative_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  community_id UUID REFERENCES public.communities(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (
    char_length(trim(title)) >= 2 AND char_length(title) <= 150
  ),
  description TEXT DEFAULT NULL CHECK (
    description IS NULL OR char_length(description) <= 2000
  ),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('draft', 'open', 'locked', 'rendering', 'completed', 'cancelled')
  ),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (
    visibility IN ('public', 'private')
  ),
  participation_mode TEXT NOT NULL DEFAULT 'open' CHECK (
    participation_mode IN ('open', 'invite_only')
  ),
  consent_policy_version TEXT NOT NULL DEFAULT 'v1.0-collaborative-2026' CHECK (
    char_length(trim(consent_policy_version)) >= 3 AND char_length(consent_policy_version) <= 64
  ),
  output_media_path TEXT DEFAULT NULL CHECK (
    output_media_path IS NULL OR output_media_path ~ '^[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+$'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT collaborative_projects_private_participation_check CHECK (
    visibility = 'public' OR participation_mode = 'invite_only'
  ),

  CONSTRAINT collaborative_projects_completed_output_check CHECK (
    status <> 'completed' OR output_media_path IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_collaborative_projects_creator
  ON public.collaborative_projects (creator_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collaborative_projects_community
  ON public.collaborative_projects (community_id, created_at DESC)
  WHERE community_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collaborative_projects_status_vis
  ON public.collaborative_projects (visibility, status, created_at DESC);

-- ================================================================
-- 2. project_participants table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.project_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.collaborative_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (
    role IN ('owner', 'editor', 'contributor')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('invited', 'requested', 'active', 'declined', 'removed')
  ),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_participants_unique UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_participants_project
  ON public.project_participants (project_id, status, role);

CREATE INDEX IF NOT EXISTS idx_project_participants_user
  ON public.project_participants (user_id, status);

-- ================================================================
-- 3. project_contributions table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.project_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.collaborative_projects(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_post_id UUID REFERENCES public.posts(id) ON DELETE SET NULL,
  media_path TEXT NOT NULL CHECK (
    media_path ~ '^[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+$'
  ),
  media_type TEXT NOT NULL DEFAULT 'short_video' CHECK (
    media_type IN ('short_video', 'long_video')
  ),
  media_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  caption TEXT DEFAULT NULL CHECK (
    caption IS NULL OR char_length(caption) <= 500
  ),
  consent_granted BOOLEAN NOT NULL DEFAULT false,
  consent_granted_at TIMESTAMPTZ DEFAULT NULL,
  consent_policy_version TEXT NOT NULL CHECK (
    char_length(trim(consent_policy_version)) >= 3 AND char_length(consent_policy_version) <= 64
  ),
  consent_withdrawn_at TIMESTAMPTZ DEFAULT NULL,
  withdrawal_reason TEXT DEFAULT NULL CHECK (
    withdrawal_reason IS NULL OR char_length(withdrawal_reason) <= 500
  ),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    review_status IN ('pending', 'approved', 'rejected', 'withdrawn')
  ),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  review_note TEXT DEFAULT NULL CHECK (
    review_note IS NULL OR char_length(review_note) <= 500
  ),
  sequence_order INTEGER DEFAULT NULL CHECK (
    sequence_order IS NULL OR (sequence_order >= 1 AND sequence_order <= 1000)
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_contributions_consent_state_check CHECK (
    (
      consent_granted = true
      AND consent_granted_at IS NOT NULL
      AND consent_withdrawn_at IS NULL
      AND review_status IN ('pending', 'approved', 'rejected')
    )
    OR
    (
      consent_granted = false
      AND consent_withdrawn_at IS NOT NULL
      AND review_status = 'withdrawn'
      AND sequence_order IS NULL
    )
  ),

  CONSTRAINT project_contributions_approved_sequence_check CHECK (
    review_status <> 'approved'
    OR (
      consent_granted = true
      AND consent_withdrawn_at IS NULL
      AND sequence_order IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_project_contributions_project_order
  ON public.project_contributions (project_id, review_status, sequence_order ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_project_contributions_contributor
  ON public.project_contributions (contributor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_contributions_media_path
  ON public.project_contributions (media_path);

-- ================================================================
-- 4. project_render_jobs table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.project_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.collaborative_projects(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (
    char_length(trim(idempotency_key)) >= 4 AND char_length(idempotency_key) <= 128
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'completed', 'failed')
  ),
  input_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_media_path TEXT DEFAULT NULL CHECK (
    output_media_path IS NULL OR output_media_path ~ '^[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+$'
  ),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (
    attempt_count >= 1 AND attempt_count <= max_attempts
  ),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (
    max_attempts >= 1 AND max_attempts <= 5
  ),
  timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK (
    timeout_seconds >= 30 AND timeout_seconds <= 1800
  ),
  failure_reason TEXT DEFAULT NULL CHECK (
    failure_reason IS NULL OR char_length(failure_reason) <= 500
  ),
  started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT project_render_jobs_idempotency_unique UNIQUE (project_id, idempotency_key),
  CONSTRAINT project_render_jobs_completed_output_check CHECK (
    status <> 'completed' OR output_media_path IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_render_jobs_one_active
  ON public.project_render_jobs (project_id)
  WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_project_render_jobs_project_created
  ON public.project_render_jobs (project_id, created_at DESC);

-- ================================================================
-- 5. SECURITY DEFINER Authorization & Visibility Helper Functions
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_project_active_participant(p_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
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
STABLE
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
STABLE
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

REVOKE ALL ON FUNCTION public.is_project_active_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_active_participant(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_project_editor(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_editor(UUID, UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.can_view_project(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_project(UUID, UUID) TO anon, authenticated;

-- ================================================================
-- 6. Triggers on collaborative_projects
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_collaborative_project_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  c_vis TEXT;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR NEW.creator_id <> caller_id THEN
    RAISE EXCEPTION 'Creator identity must match authenticated session';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Account is currently restricted from creating projects';
  END IF;

  IF NEW.status NOT IN ('draft', 'open') OR NEW.output_media_path IS NOT NULL THEN
    RAISE EXCEPTION 'New projects must start in draft or open state without rendered output';
  END IF;

  IF NEW.community_id IS NOT NULL THEN
    SELECT visibility INTO c_vis
    FROM public.communities
    WHERE id = NEW.community_id;

    IF c_vis IS NULL THEN
      RAISE EXCEPTION 'Associated community does not exist';
    END IF;

    IF NOT public.is_community_active_member(NEW.community_id, caller_id) THEN
      RAISE EXCEPTION 'Must be an active member of the community to create a project in it';
    END IF;

    IF c_vis = 'private' AND NEW.visibility <> 'private' THEN
      RAISE EXCEPTION 'Projects in private communities must have private visibility';
    END IF;
  END IF;

  IF NEW.visibility = 'private' THEN
    NEW.participation_mode := 'invite_only';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_collaborative_project_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_collaborative_project_insert
  BEFORE INSERT ON public.collaborative_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collaborative_project_insert();

CREATE OR REPLACE FUNCTION public.handle_collaborative_project_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.project_participants (project_id, user_id, role, status)
  VALUES (NEW.id, NEW.creator_id, 'owner', 'active')
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET role = 'owner', status = 'active';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_collaborative_project_created() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_collaborative_project_created
  AFTER INSERT ON public.collaborative_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collaborative_project_created();

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

  IF NEW.visibility = 'private' THEN
    NEW.participation_mode := 'invite_only';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_collaborative_project_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_collaborative_project_update
  BEFORE UPDATE ON public.collaborative_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collaborative_project_update();

-- ================================================================
-- 7. Triggers on project_participants
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_project_participant_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_creator UUID;
  p_comm UUID;
  p_vis TEXT;
  p_mode TEXT;
  p_status TEXT;
  c_vis TEXT;
BEGIN
  IF pg_trigger_depth() > 1 AND NEW.role = 'owner' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.is_account_restricted(caller_id) OR public.is_account_restricted(NEW.user_id) THEN
    RAISE EXCEPTION 'Account restriction prevents project participation';
  END IF;

  SELECT creator_id, community_id, visibility, participation_mode, status
  INTO p_creator, p_comm, p_vis, p_mode, p_status
  FROM public.collaborative_projects
  WHERE id = NEW.project_id;

  IF p_creator IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF p_status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Project is no longer accepting participants';
  END IF;

  IF public.is_blocked(p_creator, NEW.user_id) OR public.is_blocked(caller_id, NEW.user_id) THEN
    RAISE EXCEPTION 'Participation blocked by relationship restrictions';
  END IF;

  IF p_comm IS NOT NULL THEN
    SELECT visibility INTO c_vis FROM public.communities WHERE id = p_comm;
    IF c_vis = 'private' AND NOT public.is_community_active_member(p_comm, NEW.user_id) THEN
      RAISE EXCEPTION 'Target user must be an active member of the private community';
    END IF;
  END IF;

  IF NEW.role = 'owner' THEN
    RAISE EXCEPTION 'Cannot assign owner role directly';
  END IF;

  IF NEW.user_id = caller_id THEN
    IF NEW.role <> 'contributor' THEN
      RAISE EXCEPTION 'Users cannot self-assign editor or owner roles';
    END IF;

    NEW.invited_by := NULL;

    IF p_vis = 'private' OR p_status = 'draft' THEN
      RAISE EXCEPTION 'Private or draft projects require an invitation to join';
    END IF;

    IF p_mode = 'open' AND p_status = 'open' THEN
      IF NEW.status <> 'active' THEN
        RAISE EXCEPTION 'Joining an open project must use active status';
      END IF;
    ELSIF p_mode = 'invite_only' AND p_status = 'open' THEN
      IF NEW.status <> 'requested' THEN
        RAISE EXCEPTION 'Joining an invite-only project requires a pending request';
      END IF;
    ELSE
      RAISE EXCEPTION 'Project is not currently open to new join requests';
    END IF;

  ELSE
    IF NOT public.is_project_editor(NEW.project_id, caller_id) THEN
      RAISE EXCEPTION 'Only project editors or owners may invite participants';
    END IF;

    IF NEW.role = 'editor' AND caller_id <> p_creator THEN
      RAISE EXCEPTION 'Only the project owner may invite a user as an editor';
    END IF;

    IF NEW.status <> 'invited' THEN
      RAISE EXCEPTION 'Editors cannot enroll users without their acceptance; status must be invited';
    END IF;

    NEW.invited_by := caller_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_participant_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_project_participant_insert
  BEFORE INSERT ON public.project_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_participant_insert();

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
  caller_id := auth.uid();
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

CREATE TRIGGER on_project_participant_update
  BEFORE UPDATE ON public.project_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_participant_update();

CREATE OR REPLACE FUNCTION public.handle_project_participant_inactive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD.status = 'active')
     OR (TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active')
  THEN
    UPDATE public.project_contributions
    SET consent_granted = false,
        consent_withdrawn_at = now(),
        review_status = 'withdrawn',
        sequence_order = NULL,
        withdrawal_reason = 'Participant left or was removed from the project',
        updated_at = now()
    WHERE project_id = OLD.project_id
      AND contributor_id = OLD.user_id
      AND review_status <> 'withdrawn';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_participant_inactive() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_project_participant_inactive
  AFTER UPDATE OR DELETE ON public.project_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_participant_inactive();

-- ================================================================
-- 8. Triggers on project_contributions
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_project_contribution_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_status TEXT;
  p_consent_ver TEXT;
  p_creator UUID;
  post_owner UUID;
  post_media TEXT;
  post_type TEXT;
  post_status TEXT;
  file_ext TEXT;
  mime_type TEXT;
  size_bytes BIGINT;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR NEW.contributor_id <> caller_id THEN
    RAISE EXCEPTION 'Contributor identity must match authenticated session';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Account is currently restricted from submitting contributions';
  END IF;

  SELECT status, consent_policy_version, creator_id
  INTO p_status, p_consent_ver, p_creator
  FROM public.collaborative_projects
  WHERE id = NEW.project_id;

  IF p_status IS NULL THEN
    RAISE EXCEPTION 'Target project does not exist';
  END IF;

  IF p_status <> 'open' THEN
    RAISE EXCEPTION 'Project is not currently open for contributions';
  END IF;

  IF public.is_blocked(p_creator, caller_id) THEN
    RAISE EXCEPTION 'Cannot contribute to this project due to relationship restrictions';
  END IF;

  IF NOT public.is_project_active_participant(NEW.project_id, caller_id) THEN
    RAISE EXCEPTION 'Only active project participants may submit media contributions';
  END IF;

  IF split_part(NEW.media_path, '/', 1) <> caller_id::text THEN
    RAISE EXCEPTION 'Security violation: Media path must belong to the authenticated contributor';
  END IF;

  file_ext := lower(regexp_replace(NEW.media_path, '^.*\.', ''));
  mime_type := NEW.media_metadata->>'mimeType';
  size_bytes := COALESCE((NEW.media_metadata->>'sizeBytes')::bigint, 0);

  IF NEW.media_type = 'short_video' THEN
    IF file_ext NOT IN ('mp4', 'webm', 'mov')
       OR mime_type NOT IN ('video/mp4', 'video/webm', 'video/quicktime')
       OR size_bytes <= 0
       OR size_bytes > 104857600
    THEN
      RAISE EXCEPTION 'Invalid media format or size for short_video contribution';
    END IF;
  ELSIF NEW.media_type = 'long_video' THEN
    IF file_ext NOT IN ('mp4', 'webm')
       OR mime_type NOT IN ('video/mp4', 'video/webm')
       OR size_bytes <= 0
       OR size_bytes > 524288000
    THEN
      RAISE EXCEPTION 'Invalid media format or size for long_video contribution';
    END IF;
  END IF;

  IF NEW.source_post_id IS NOT NULL THEN
    SELECT creator_id, media_path, content_type, status
    INTO post_owner, post_media, post_type, post_status
    FROM public.posts
    WHERE id = NEW.source_post_id;

    IF post_owner IS NULL OR post_owner <> caller_id THEN
      RAISE EXCEPTION 'Source post not found or not owned by contributor';
    END IF;

    IF post_status <> 'published' OR public.is_post_restricted(NEW.source_post_id) THEN
      RAISE EXCEPTION 'Source post must be published and unrestricted';
    END IF;

    IF post_media IS DISTINCT FROM NEW.media_path OR post_type IS DISTINCT FROM NEW.media_type THEN
      RAISE EXCEPTION 'Contribution media must match the source post media';
    END IF;
  END IF;

  IF NEW.consent_granted IS NOT TRUE THEN
    RAISE EXCEPTION 'Explicit usage consent is required to submit a contribution';
  END IF;

  IF NEW.consent_policy_version <> p_consent_ver THEN
    RAISE EXCEPTION 'Consent policy version must match the project consent policy version';
  END IF;

  NEW.consent_granted_at := now();
  NEW.consent_withdrawn_at := NULL;
  NEW.withdrawal_reason := NULL;
  NEW.review_status := 'pending';
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  NEW.review_note := NULL;
  NEW.sequence_order := NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_contribution_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_project_contribution_insert
  BEFORE INSERT ON public.project_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_contribution_insert();

CREATE OR REPLACE FUNCTION public.handle_project_contribution_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_status TEXT;
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.project_id <> OLD.project_id
     OR NEW.contributor_id <> OLD.contributor_id
     OR NEW.source_post_id IS DISTINCT FROM OLD.source_post_id
     OR NEW.media_path <> OLD.media_path
     OR NEW.media_type <> OLD.media_type
     OR NEW.media_metadata IS DISTINCT FROM OLD.media_metadata
     OR NEW.consent_policy_version <> OLD.consent_policy_version
     OR NEW.consent_granted_at IS DISTINCT FROM OLD.consent_granted_at
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Contribution identity, media, and original consent timestamp are immutable';
  END IF;

  IF OLD.review_status = 'withdrawn' OR OLD.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawn contributions are finalized and cannot be reactivated';
  END IF;

  IF pg_trigger_depth() > 1 AND NEW.review_status = 'withdrawn' THEN
    NEW.consent_granted := false;
    NEW.consent_withdrawn_at := COALESCE(NEW.consent_withdrawn_at, now());
    NEW.sequence_order := NULL;
    NEW.updated_at := now();

    IF OLD.review_status = 'approved' THEN
      UPDATE public.project_render_jobs
      SET status = 'failed',
          failure_reason = 'Render aborted: participant exited and consent was withdrawn.',
          completed_at = now(),
          updated_at = now()
      WHERE project_id = OLD.project_id
        AND status IN ('queued', 'processing');

      UPDATE public.collaborative_projects
      SET status = CASE WHEN status IN ('rendering', 'completed') THEN 'open' ELSE status END,
          output_media_path = NULL,
          updated_at = now()
      WHERE id = OLD.project_id
        AND status IN ('rendering', 'completed');
    END IF;

    RETURN NEW;
  END IF;

  caller_id := auth.uid();
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
          completed_at = now(),
          updated_at = now()
      WHERE project_id = OLD.project_id
        AND status IN ('queued', 'processing');

      UPDATE public.collaborative_projects
      SET status = CASE WHEN status IN ('rendering', 'completed') THEN 'open' ELSE status END,
          output_media_path = NULL,
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

CREATE TRIGGER on_project_contribution_update
  BEFORE UPDATE ON public.project_contributions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_contribution_update();

-- ================================================================
-- 9. Triggers on project_render_jobs
-- ================================================================
CREATE OR REPLACE FUNCTION public.validate_render_job_manifest_integrity(p_project_id UUID, p_manifest JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
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

REVOKE ALL ON FUNCTION public.validate_render_job_manifest_integrity(UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_project_render_job_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_status TEXT;
  manifest JSONB;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR NEW.requested_by <> caller_id THEN
    RAISE EXCEPTION 'Requester identity must match authenticated session';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Restricted accounts cannot initiate render jobs';
  END IF;

  IF NOT public.is_project_editor(NEW.project_id, caller_id) THEN
    RAISE EXCEPTION 'Only project editors or owners may request a final render';
  END IF;

  SELECT status INTO p_status
  FROM public.collaborative_projects
  WHERE id = NEW.project_id;

  IF p_status IS NULL THEN
    RAISE EXCEPTION 'Target project does not exist';
  END IF;

  IF p_status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Project must be in open or locked state to request a render';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'contribution_id', pc.id,
        'contributor_id', pc.contributor_id,
        'media_path', pc.media_path,
        'media_type', pc.media_type,
        'sequence_order', pc.sequence_order,
        'consent_granted_at', pc.consent_granted_at,
        'consent_policy_version', pc.consent_policy_version
      )
      ORDER BY pc.sequence_order ASC, pc.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO manifest
  FROM public.project_contributions pc
  WHERE pc.project_id = NEW.project_id
    AND pc.review_status = 'approved'
    AND pc.consent_granted = true
    AND pc.consent_withdrawn_at IS NULL
    AND public.is_project_active_participant(NEW.project_id, pc.contributor_id)
    AND NOT public.is_account_restricted(pc.contributor_id)
    AND (pc.source_post_id IS NULL OR NOT public.is_post_restricted(pc.source_post_id));

  IF jsonb_array_length(manifest) = 0 THEN
    RAISE EXCEPTION 'Cannot start render: project has no approved and consented contributions from eligible participants';
  END IF;

  NEW.input_manifest := manifest;
  NEW.status := 'queued';
  NEW.attempt_count := 1;
  NEW.output_media_path := NULL;
  NEW.failure_reason := NULL;
  NEW.started_at := NULL;
  NEW.completed_at := NULL;

  UPDATE public.collaborative_projects
  SET status = 'rendering',
      updated_at = now()
  WHERE id = NEW.project_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_render_job_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_project_render_job_insert
  BEFORE INSERT ON public.project_render_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_render_job_insert();

CREATE OR REPLACE FUNCTION public.handle_project_render_job_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  p_creator UUID;
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

  SELECT creator_id INTO p_creator
  FROM public.collaborative_projects
  WHERE id = OLD.project_id;

  IF OLD.status = 'failed' AND NEW.status = 'queued' THEN
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
    IF NOT public.validate_render_job_manifest_integrity(OLD.project_id, OLD.input_manifest) THEN
      RAISE EXCEPTION 'Cannot process render job: one or more contributions in the manifest lost consent or eligibility';
    END IF;

    NEW.started_at := now();
    NEW.completed_at := NULL;
    NEW.failure_reason := NULL;

  ELSIF OLD.status IN ('queued', 'processing') AND NEW.status = 'completed' THEN
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

CREATE TRIGGER on_project_render_job_update
  BEFORE UPDATE ON public.project_render_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_render_job_update();

-- ================================================================
-- 10. Grants & Row Level Security Policies
-- ================================================================
REVOKE ALL ON public.collaborative_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.collaborative_projects TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.collaborative_projects TO authenticated;

REVOKE ALL ON public.project_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_participants TO authenticated;

REVOKE ALL ON public.project_contributions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_contributions TO authenticated;

REVOKE ALL ON public.project_render_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_render_jobs TO authenticated;

ALTER TABLE public.collaborative_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collaborative_projects_select_policy"
  ON public.collaborative_projects
  FOR SELECT
  USING (
    public.can_view_project(id, (select auth.uid()))
  );

CREATE POLICY "collaborative_projects_insert_policy"
  ON public.collaborative_projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    creator_id = (select auth.uid())
    AND NOT public.is_account_restricted((select auth.uid()))
  );

CREATE POLICY "collaborative_projects_update_policy"
  ON public.collaborative_projects
  FOR UPDATE
  TO authenticated
  USING (
    public.is_project_editor(id, (select auth.uid()))
    AND NOT public.is_account_restricted((select auth.uid()))
  )
  WITH CHECK (
    public.is_project_editor(id, (select auth.uid()))
    AND NOT public.is_account_restricted((select auth.uid()))
  );

CREATE POLICY "collaborative_projects_delete_policy"
  ON public.collaborative_projects
  FOR DELETE
  TO authenticated
  USING (
    creator_id = (select auth.uid())
  );

CREATE POLICY "project_participants_select_policy"
  ON public.project_participants
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_project(project_id, (select auth.uid()))
  );

CREATE POLICY "project_participants_insert_policy"
  ON public.project_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    NOT public.is_account_restricted((select auth.uid()))
    AND (
      user_id = (select auth.uid())
      OR public.is_project_editor(project_id, (select auth.uid()))
    )
  );

CREATE POLICY "project_participants_update_policy"
  ON public.project_participants
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR public.is_project_editor(project_id, (select auth.uid()))
  )
  WITH CHECK (
    user_id = (select auth.uid())
    OR public.is_project_editor(project_id, (select auth.uid()))
  );

CREATE POLICY "project_participants_delete_policy"
  ON public.project_participants
  FOR DELETE
  TO authenticated
  USING (
    role <> 'owner'
    AND (
      user_id = (select auth.uid())
      OR public.is_project_editor(project_id, (select auth.uid()))
    )
  );

CREATE POLICY "project_contributions_select_policy"
  ON public.project_contributions
  FOR SELECT
  TO authenticated
  USING (
    contributor_id = (select auth.uid())
    OR (
      public.can_view_project(project_id, (select auth.uid()))
      AND NOT public.is_blocked(contributor_id, (select auth.uid()))
      AND NOT public.is_account_restricted(contributor_id)
      AND (source_post_id IS NULL OR NOT public.is_post_restricted(source_post_id))
      AND (
        (
          public.is_project_active_participant(project_id, (select auth.uid()))
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
  );

CREATE POLICY "project_contributions_insert_policy"
  ON public.project_contributions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    contributor_id = (select auth.uid())
    AND consent_granted = true
    AND NOT public.is_account_restricted((select auth.uid()))
    AND public.is_project_active_participant(project_id, (select auth.uid()))
  );

CREATE POLICY "project_contributions_update_policy"
  ON public.project_contributions
  FOR UPDATE
  TO authenticated
  USING (
    contributor_id = (select auth.uid())
    OR public.is_project_editor(project_id, (select auth.uid()))
  )
  WITH CHECK (
    contributor_id = (select auth.uid())
    OR public.is_project_editor(project_id, (select auth.uid()))
  );

CREATE POLICY "project_render_jobs_select_policy"
  ON public.project_render_jobs
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_project(project_id, (select auth.uid()))
    AND (
      public.is_project_active_participant(project_id, (select auth.uid()))
      OR status = 'completed'
    )
  );

CREATE POLICY "project_render_jobs_insert_policy"
  ON public.project_render_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = (select auth.uid())
    AND NOT public.is_account_restricted((select auth.uid()))
    AND public.is_project_editor(project_id, (select auth.uid()))
  );

CREATE POLICY "project_render_jobs_update_policy"
  ON public.project_render_jobs
  FOR UPDATE
  TO authenticated
  USING (
    public.is_project_editor(project_id, (select auth.uid()))
    AND NOT public.is_account_restricted((select auth.uid()))
  )
  WITH CHECK (
    public.is_project_editor(project_id, (select auth.uid()))
    AND NOT public.is_account_restricted((select auth.uid()))
  );

-- ================================================================
-- 11. Storage Media Read Policy Integration
-- ================================================================
ALTER POLICY "Users can read media objects"
  ON storage.objects
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.posts p
        WHERE p.media_path = storage.objects.name
      )
      OR EXISTS (
        SELECT 1 FROM public.project_contributions pc
        WHERE pc.media_path = storage.objects.name
          AND pc.consent_granted = true
          AND pc.consent_withdrawn_at IS NULL
          AND pc.review_status <> 'withdrawn'
      )
      OR EXISTS (
        SELECT 1 FROM public.collaborative_projects cp
        WHERE cp.output_media_path = storage.objects.name
          AND cp.status = 'completed'
      )
    )
  );
