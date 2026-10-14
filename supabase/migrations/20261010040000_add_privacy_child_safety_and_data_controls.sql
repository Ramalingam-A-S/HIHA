-- ================================================================
-- MIGRATION: 20261010040000_add_privacy_child_safety_and_data_controls.sql
-- Description:
--   Milestone 4.4 — Child Safety, Privacy & User Data Controls.
--   1. Extends public.profiles with granular privacy, discoverability,
--      follow permissions, interaction permissions, default post visibility,
--      notification preferences, privacy-preserving age-safety mode
--      ('standard' vs 'teen_13_17'), minimum-age attestation timestamp,
--      and account deactivation state.
--   2. Enforces protective defaults and non-relaxation invariants for
--      'teen_13_17' accounts across profiles, posts, and collaborative projects.
--   3. Enforces follow_permission ('everyone', 'approval_required', 'nobody'),
--      bidirectional block barriers, and automatic follow severing on block.
--   4. Enforces interaction_permission ('everyone', 'followers_only', 'nobody')
--      on post_likes and collaborative project invitations.
--   5. Enforces user notification preferences inside notify_follow_event().
--   6. Adds public.moderation_retention_ledger for privacy-safe, anonymized
--      safety audit retention upon account deletion/deactivation.
--   7. Adds self-service RPCs:
--      - public.export_own_personal_data()
--      - public.request_or_execute_account_deletion(p_mode, p_confirmation)
--      - public.reactivate_own_account(p_display_name)
-- ================================================================

-- ================================================================
-- 1. Extend public.profiles with Privacy, Interaction, Notification & Age-Safety Controls
-- ================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable_in_search BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS follow_permission TEXT NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS interaction_permission TEXT NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS default_post_visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS notify_on_follow_request BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_new_follower BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_follow_accepted BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS age_safety_mode TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS minimum_age_attested_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS age_assurance_status TEXT NOT NULL DEFAULT 'self_attested',
  ADD COLUMN IF NOT EXISTS privacy_policy_version TEXT NOT NULL DEFAULT 'v1.0-2026-10',
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_follow_permission_check CHECK (
    follow_permission IN ('everyone', 'approval_required', 'nobody')
  ),
  ADD CONSTRAINT profiles_interaction_permission_check CHECK (
    interaction_permission IN ('everyone', 'followers_only', 'nobody')
  ),
  ADD CONSTRAINT profiles_default_post_visibility_check CHECK (
    default_post_visibility IN ('public', 'followers', 'private')
  ),
  ADD CONSTRAINT profiles_age_safety_mode_check CHECK (
    age_safety_mode IN ('standard', 'teen_13_17')
  ),
  ADD CONSTRAINT profiles_age_assurance_status_check CHECK (
    age_assurance_status IN ('unverified', 'self_attested', 'provider_verified')
  ),
  ADD CONSTRAINT profiles_teen_safety_invariants_check CHECK (
    age_safety_mode <> 'teen_13_17'
    OR (
      is_private = true
      AND discoverable_in_search = false
      AND follow_permission IN ('approval_required', 'nobody')
      AND interaction_permission IN ('followers_only', 'nobody')
      AND default_post_visibility IN ('followers', 'private')
    )
  );

CREATE INDEX IF NOT EXISTS idx_profiles_discoverable_active
  ON public.profiles (created_at DESC)
  WHERE deactivated_at IS NULL AND is_private = false AND discoverable_in_search = true;

-- ================================================================
-- 2. Profile Privacy & Age-Safety Enforcement Trigger
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_profile_privacy_and_age_safety()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_trusted_age_verifier BOOLEAN;
  v_lifecycle_cleanup BOOLEAN;
BEGIN
  v_trusted_age_verifier := COALESCE(current_setting('app.trusted_age_verifier', true), '') = 'true';
  v_lifecycle_cleanup := COALESCE(current_setting('app.account_lifecycle_cleanup', true), '') = 'true';

  -- Prevent client forgery of third-party provider age verification status
  IF TG_OP = 'INSERT' THEN
    IF NOT v_trusted_age_verifier AND NEW.age_assurance_status = 'provider_verified' THEN
      RAISE EXCEPTION 'Forbidden: provider_verified age assurance status cannot be set directly by client';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_trusted_age_verifier
       AND NEW.age_assurance_status = 'provider_verified'
       AND OLD.age_assurance_status <> 'provider_verified'
    THEN
      RAISE EXCEPTION 'Forbidden: provider_verified age assurance status cannot be forged by client session';
    END IF;

    -- Prevent clients from directly spoofing deactivated_at without the lifecycle RPC
    IF NOT v_lifecycle_cleanup AND (NEW.deactivated_at IS DISTINCT FROM OLD.deactivated_at) THEN
      RAISE EXCEPTION 'Account deactivation state must be managed through the account lifecycle workflow';
    END IF;
  END IF;

  -- If transitioning into teen_13_17 mode (on INSERT or from 'standard'), automatically apply protective defaults
  IF NEW.age_safety_mode = 'teen_13_17' AND (TG_OP = 'INSERT' OR OLD.age_safety_mode <> 'teen_13_17') THEN
    NEW.is_private := true;
    NEW.discoverable_in_search := false;
    IF NEW.follow_permission = 'everyone' THEN
      NEW.follow_permission := 'approval_required';
    END IF;
    IF NEW.interaction_permission = 'everyone' THEN
      NEW.interaction_permission := 'followers_only';
    END IF;
    IF NEW.default_post_visibility = 'public' THEN
      NEW.default_post_visibility := 'followers';
    END IF;
    NEW.minimum_age_attested_at := COALESCE(NEW.minimum_age_attested_at, now());
  ELSIF TG_OP = 'UPDATE' AND OLD.age_safety_mode = 'teen_13_17' AND NEW.age_safety_mode = 'teen_13_17' THEN
    -- Already in teen_13_17 mode: reject attempts to relax protective boundaries while teen mode remains active
    IF NEW.is_private = false
       OR NEW.discoverable_in_search = true
       OR NEW.follow_permission = 'everyone'
       OR NEW.interaction_permission = 'everyone'
       OR NEW.default_post_visibility = 'public'
    THEN
      RAISE EXCEPTION 'Cannot relax privacy, discoverability, follow, or interaction protections while Teen Protective Safety Mode (13–17) is active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_profile_privacy_and_age_safety() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_profile_privacy_and_age_safety
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_privacy_and_age_safety();

-- Update handle_new_user() so sign-up metadata can provision Teen Protective Safety Mode and minimum-age attestation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  raw_username TEXT;
  clean_username TEXT;
  raw_display_name TEXT;
  raw_age_mode TEXT;
  v_age_mode TEXT;
  v_attested_at TIMESTAMPTZ;
BEGIN
  raw_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1),
    'user'
  );

  clean_username := lower(regexp_replace(raw_username, '[^a-zA-Z0-9_]', '_', 'g'));

  IF char_length(clean_username) < 3 THEN
    clean_username := clean_username || '_' || substr(replace(NEW.id::text, '-', ''), 1, 6);
  END IF;

  clean_username := substr(clean_username, 1, 23) || '_' || substr(replace(NEW.id::text, '-', ''), 1, 6);

  raw_display_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'display_name'), ''),
    clean_username
  );

  raw_age_mode := COALESCE(NEW.raw_user_meta_data->>'age_safety_mode', 'standard');
  IF raw_age_mode = 'teen_13_17' THEN
    v_age_mode := 'teen_13_17';
  ELSE
    v_age_mode := 'standard';
  END IF;

  IF COALESCE(NEW.raw_user_meta_data->>'age_eligibility_confirmed', 'true') = 'true' THEN
    v_attested_at := now();
  ELSE
    v_attested_at := NULL;
  END IF;

  INSERT INTO public.profiles (
    id,
    username,
    display_name,
    is_private,
    discoverable_in_search,
    follow_permission,
    interaction_permission,
    default_post_visibility,
    age_safety_mode,
    minimum_age_attested_at,
    age_assurance_status
  )
  VALUES (
    NEW.id,
    clean_username,
    substr(raw_display_name, 1, 60),
    CASE WHEN v_age_mode = 'teen_13_17' THEN true ELSE false END,
    CASE WHEN v_age_mode = 'teen_13_17' THEN false ELSE true END,
    CASE WHEN v_age_mode = 'teen_13_17' THEN 'approval_required' ELSE 'everyone' END,
    CASE WHEN v_age_mode = 'teen_13_17' THEN 'followers_only' ELSE 'everyone' END,
    CASE WHEN v_age_mode = 'teen_13_17' THEN 'followers' ELSE 'public' END,
    v_age_mode,
    v_attested_at,
    CASE WHEN v_attested_at IS NOT NULL THEN 'self_attested' ELSE 'unverified' END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 3. Tighten public.profiles SELECT RLS (Bidirectional Blocks & Deactivation)
-- ================================================================
ALTER POLICY "Profiles are viewable by owner or if public"
  ON public.profiles
  USING (
    (select auth.uid()) = id
    OR (
      deactivated_at IS NULL
      AND is_private = false
      AND (
        (select auth.uid()) IS NULL
        OR NOT public.is_blocked(profiles.id, (select auth.uid()))
      )
    )
  );

ALTER POLICY "Accepted followers can view private profiles"
  ON public.profiles
  USING (
    deactivated_at IS NULL
    AND is_private = true
    AND NOT public.is_blocked(profiles.id, (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = (select auth.uid())
        AND f.following_id = profiles.id
        AND f.status = 'accepted'
    )
  );

-- ================================================================
-- 4. Follow Privacy, Block Severing & Notification Preference Enforcement
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_follow_privacy_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_private BOOLEAN;
  v_follow_perm TEXT;
  v_age_mode TEXT;
  v_deactivated TIMESTAMPTZ;
  v_caller_deactivated TIMESTAMPTZ;
BEGIN
  SELECT deactivated_at INTO v_caller_deactivated
  FROM public.profiles
  WHERE id = NEW.follower_id;

  IF v_caller_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated accounts cannot follow other users';
  END IF;

  SELECT is_private, follow_permission, age_safety_mode, deactivated_at
  INTO v_is_private, v_follow_perm, v_age_mode, v_deactivated
  FROM public.profiles
  WHERE id = NEW.following_id;

  IF v_is_private IS NULL OR v_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Target account is unavailable or deactivated';
  END IF;

  IF public.is_blocked(NEW.follower_id, NEW.following_id) THEN
    RAISE EXCEPTION 'Cannot follow an account when a block relationship is active';
  END IF;

  IF v_follow_perm = 'nobody' THEN
    RAISE EXCEPTION 'This account has disabled new followers';
  END IF;

  IF (v_is_private = true OR v_follow_perm = 'approval_required' OR v_age_mode = 'teen_13_17')
     AND NEW.status = 'accepted'
  THEN
    RAISE EXCEPTION 'Following this account requires a pending follow request';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_follow_privacy_before_insert() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_follows_enforce_privacy
  BEFORE INSERT ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_follow_privacy_before_insert();

-- Enhance notify_follow_event() to respect recipient notification preferences and deactivation state
CREATE OR REPLACE FUNCTION public.notify_follow_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recipient_id UUID;
  v_actor_id     UUID;
  v_type         TEXT;
  v_notify_req   BOOLEAN;
  v_notify_new   BOOLEAN;
  v_notify_acc   BOOLEAN;
  v_deactivated  TIMESTAMPTZ;
  v_should_send  BOOLEAN := true;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      v_recipient_id := NEW.following_id;
      v_actor_id     := NEW.follower_id;
      v_type         := 'follow_request';
    ELSIF NEW.status = 'accepted' THEN
      v_recipient_id := NEW.following_id;
      v_actor_id     := NEW.follower_id;
      v_type         := 'new_follower';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      v_recipient_id := NEW.follower_id;
      v_actor_id     := NEW.following_id;
      v_type         := 'follow_accepted';
    END IF;
  END IF;

  IF v_recipient_id IS NOT NULL AND v_actor_id IS NOT NULL AND v_type IS NOT NULL THEN
    SELECT
      notify_on_follow_request,
      notify_on_new_follower,
      notify_on_follow_accepted,
      deactivated_at
    INTO
      v_notify_req,
      v_notify_new,
      v_notify_acc,
      v_deactivated
    FROM public.profiles
    WHERE id = v_recipient_id;

    IF v_deactivated IS NOT NULL THEN
      v_should_send := false;
    ELSIF v_type = 'follow_request' AND COALESCE(v_notify_req, true) = false THEN
      v_should_send := false;
    ELSIF v_type = 'new_follower' AND COALESCE(v_notify_new, true) = false THEN
      v_should_send := false;
    ELSIF v_type = 'follow_accepted' AND COALESCE(v_notify_acc, true) = false THEN
      v_should_send := false;
    END IF;

    IF v_should_send AND NOT public.is_blocked(v_recipient_id, v_actor_id) THEN
      INSERT INTO public.notifications (recipient_id, actor_id, type, follow_id)
      VALUES (v_recipient_id, v_actor_id, v_type, NEW.id)
      ON CONFLICT (recipient_id, actor_id, type, follow_id) WHERE follow_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_follow_event() FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 5. Content & Interaction Privacy + Teen Safety Boundaries on
--    posts, post_likes, collaborative_projects, and project_participants
-- ================================================================

-- 5a. Posts: enforce Teen Safety Mode non-public visibility & deactivation checks
CREATE OR REPLACE FUNCTION public.handle_post_privacy_and_age_safety()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_age_mode TEXT;
  v_deactivated TIMESTAMPTZ;
BEGIN
  SELECT age_safety_mode, deactivated_at
  INTO v_age_mode, v_deactivated
  FROM public.profiles
  WHERE id = NEW.creator_id;

  IF v_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated accounts cannot create or modify posts';
  END IF;

  IF v_age_mode = 'teen_13_17' AND NEW.visibility = 'public' THEN
    RAISE EXCEPTION 'Accounts in Teen Protective Safety Mode (13–17) cannot publish public-visibility posts; choose followers-only or private visibility';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_post_privacy_and_age_safety() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_post_privacy_and_age_safety
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_privacy_and_age_safety();

-- Ensure posts visibility policy uses bidirectional is_blocked()
ALTER POLICY "Posts visibility policy"
  ON public.posts
  USING (
    (select auth.uid()) = creator_id
    OR (
      status = 'published'
      AND NOT public.is_post_restricted(posts.id)
      AND (
        (select auth.uid()) IS NULL
        OR NOT public.is_blocked(posts.creator_id, (select auth.uid()))
      )
      AND (
        visibility = 'public'
        OR (
          visibility = 'followers'
          AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = (select auth.uid())
              AND f.following_id = posts.creator_id
              AND f.status = 'accepted'
          )
        )
      )
    )
  );

-- 5b. Post Likes: enforce creator interaction_permission ('everyone', 'followers_only', 'nobody')
CREATE OR REPLACE FUNCTION public.handle_post_like_privacy_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_creator_id UUID;
  v_interaction_perm TEXT;
  v_creator_deactivated TIMESTAMPTZ;
  v_liker_deactivated TIMESTAMPTZ;
BEGIN
  SELECT deactivated_at INTO v_liker_deactivated
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF v_liker_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated accounts cannot interact with posts';
  END IF;

  SELECT creator_id INTO v_creator_id
  FROM public.posts
  WHERE id = NEW.post_id;

  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'Target post not found';
  END IF;

  -- Creators can always like their own posts; check interaction_permission for other users
  IF v_creator_id <> NEW.user_id THEN
    SELECT interaction_permission, deactivated_at
    INTO v_interaction_perm, v_creator_deactivated
    FROM public.profiles
    WHERE id = v_creator_id;

    IF v_creator_deactivated IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot interact with content from a deactivated account';
    END IF;

    IF v_interaction_perm = 'nobody' THEN
      RAISE EXCEPTION 'The creator has disabled interactions on their content';
    END IF;

    IF v_interaction_perm = 'followers_only' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = NEW.user_id
          AND f.following_id = v_creator_id
          AND f.status = 'accepted'
      ) THEN
        RAISE EXCEPTION 'Only accepted followers can interact with this creator''s content';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_post_like_privacy_check() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_post_like_privacy_check
  BEFORE INSERT ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_like_privacy_check();

-- 5c. Collaborative Projects: enforce Teen Safety Mode private project boundary
CREATE OR REPLACE FUNCTION public.handle_collaborative_project_age_safety()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_age_mode TEXT;
  v_deactivated TIMESTAMPTZ;
  v_lifecycle_cleanup BOOLEAN;
BEGIN
  v_lifecycle_cleanup := COALESCE(current_setting('app.account_lifecycle_cleanup', true), '') = 'true';
  IF v_lifecycle_cleanup THEN
    RETURN NEW;
  END IF;

  SELECT age_safety_mode, deactivated_at
  INTO v_age_mode, v_deactivated
  FROM public.profiles
  WHERE id = NEW.creator_id;

  IF pg_trigger_depth() = 1 AND v_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated accounts cannot create or modify collaborative projects';
  END IF;

  IF v_age_mode = 'teen_13_17' AND NEW.visibility = 'public' THEN
    RAISE EXCEPTION 'Accounts in Teen Protective Safety Mode (13–17) can only create private, invite-only collaborative projects';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_collaborative_project_age_safety() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_collaborative_project_age_safety
  BEFORE INSERT OR UPDATE ON public.collaborative_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_collaborative_project_age_safety();

-- 5d. Project Participants: enforce target user's interaction_permission on invitations
CREATE OR REPLACE FUNCTION public.handle_project_participant_privacy_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID;
  v_interaction_perm TEXT;
  v_age_mode TEXT;
  v_deactivated TIMESTAMPTZ;
BEGIN
  IF pg_trigger_depth() > 1 AND NEW.role = 'owner' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  v_caller := auth.uid();

  SELECT interaction_permission, age_safety_mode, deactivated_at
  INTO v_interaction_perm, v_age_mode, v_deactivated
  FROM public.profiles
  WHERE id = NEW.user_id;

  IF v_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Target account is unavailable or deactivated';
  END IF;

  -- When inviting another user, respect their interaction_permission and teen safety boundaries
  IF v_caller IS NOT NULL AND NEW.user_id <> v_caller THEN
    IF v_interaction_perm = 'nobody' THEN
      RAISE EXCEPTION 'Target user has disabled collaborative project invitations';
    END IF;

    IF v_interaction_perm = 'followers_only' OR v_age_mode = 'teen_13_17' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = v_caller
          AND f.following_id = NEW.user_id
          AND f.status = 'accepted'
      ) THEN
        RAISE EXCEPTION 'Target user only accepts collaborative project invitations from their accepted followers';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_project_participant_privacy_check() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_project_participant_privacy_check
  BEFORE INSERT ON public.project_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_project_participant_privacy_check();

-- 5e. Update handle_project_contribution_update
--     to allow ON DELETE SET NULL of source_post_id when a creator deletes their post
--     and to allow account_lifecycle_cleanup consent revocation even if account is restricted.
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

  -- If this update is purely a foreign key ON DELETE SET NULL on source_post_id when a post is deleted
  IF NEW.source_post_id IS NULL
     AND OLD.source_post_id IS NOT NULL
     AND NEW.consent_granted = OLD.consent_granted
     AND NEW.review_status = OLD.review_status
     AND NEW.sequence_order IS NOT DISTINCT FROM OLD.sequence_order
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF OLD.review_status = 'withdrawn' OR OLD.consent_withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawn contributions are finalized and cannot be reactivated';
  END IF;

  IF (pg_trigger_depth() > 1 OR v_lifecycle_cleanup) AND NEW.review_status = 'withdrawn' THEN
    NEW.consent_granted := false;
    NEW.consent_withdrawn_at := COALESCE(NEW.consent_withdrawn_at, now());
    NEW.sequence_order := NULL;
    NEW.updated_at := now();

    IF OLD.review_status = 'approved' THEN
      UPDATE public.project_render_jobs
      SET status = 'failed',
          failure_reason = 'Render aborted: participant exited or deactivated account and consent was withdrawn.',
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

-- ================================================================
-- 6. Tamper-Resistant Anonymized Moderation Retention Ledger
--    Preserves safety/enforcement audit history when an account is
--    deactivated or deleted without retaining raw profile PII.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.moderation_retention_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_action_id UUID NOT NULL UNIQUE,
  subject_user_hash TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('warning', 'content_restriction', 'account_restriction')
  ),
  target_type TEXT NOT NULL CHECK (
    target_type IN ('post', 'community_post', 'profile')
  ),
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_hours INTEGER DEFAULT NULL,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  original_created_at TIMESTAMPTZ NOT NULL,
  retained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_reason TEXT NOT NULL DEFAULT 'trust_and_safety_audit_retention_exception'
);

CREATE INDEX IF NOT EXISTS idx_moderation_retention_ledger_hash
  ON public.moderation_retention_ledger (subject_user_hash, original_created_at DESC);

REVOKE ALL ON public.moderation_retention_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.moderation_retention_ledger TO authenticated;

ALTER TABLE public.moderation_retention_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform staff can view moderation retention ledger"
  ON public.moderation_retention_ledger
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_staff((select auth.uid()))
  );

-- ================================================================
-- 7. Self-Service Personal Data Export RPC
--    Strictly returns only the authenticated caller's own eligible
--    account data and strips internal moderator identities.
-- ================================================================
CREATE OR REPLACE FUNCTION public.export_own_personal_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_uid UUID;
  v_profile JSONB;
  v_interests JSONB;
  v_following JSONB;
  v_followers JSONB;
  v_blocks JSONB;
  v_mutes JSONB;
  v_posts JSONB;
  v_likes JSONB;
  v_community_memberships JSONB;
  v_community_posts JSONB;
  v_owned_projects JSONB;
  v_project_participations JSONB;
  v_contributions JSONB;
  v_reports JSONB;
  v_moderation_actions JSONB;
  v_appeals JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to export personal data';
  END IF;

  SELECT to_jsonb(p.*)
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'interest_id', ui.interest_id,
        'slug', i.slug,
        'name', i.name,
        'category', i.category,
        'priority', ui.priority,
        'created_at', ui.created_at
      )
      ORDER BY ui.priority DESC, i.name ASC
    ),
    '[]'::jsonb
  )
  INTO v_interests
  FROM public.user_interests ui
  JOIN public.interests i ON i.id = ui.interest_id
  WHERE ui.user_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'following_id', f.following_id,
        'status', f.status,
        'created_at', f.created_at
      )
      ORDER BY f.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_following
  FROM public.follows f
  WHERE f.follower_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'follower_id', f.follower_id,
        'status', f.status,
        'created_at', f.created_at
      )
      ORDER BY f.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_followers
  FROM public.follows f
  WHERE f.following_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'blocked_id', b.blocked_id,
        'created_at', b.created_at
      )
      ORDER BY b.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_blocks
  FROM public.blocks b
  WHERE b.blocker_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'muted_id', m.muted_id,
        'created_at', m.created_at
      )
      ORDER BY m.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_mutes
  FROM public.mutes m
  WHERE m.muter_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'content_type', p.content_type,
        'caption', p.caption,
        'status', p.status,
        'visibility', p.visibility,
        'category', p.category,
        'ai_disclosure_status', p.ai_disclosure_status,
        'ai_disclosure_details', p.ai_disclosure_details,
        'ai_disclosed_at', p.ai_disclosed_at,
        'provenance_status', p.provenance_status,
        'published_at', p.published_at,
        'created_at', p.created_at,
        'updated_at', p.updated_at
      )
      ORDER BY p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_posts
  FROM public.posts p
  WHERE p.creator_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pl.id,
        'post_id', pl.post_id,
        'created_at', pl.created_at
      )
      ORDER BY pl.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_likes
  FROM public.post_likes pl
  WHERE pl.user_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'community_id', cm.community_id,
        'role', cm.role,
        'status', cm.status,
        'created_at', cm.created_at
      )
      ORDER BY cm.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_community_memberships
  FROM public.community_members cm
  WHERE cm.user_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cp.id,
        'community_id', cp.community_id,
        'post_id', cp.post_id,
        'pinned_at', cp.pinned_at,
        'removed_at', cp.removed_at,
        'removal_reason', cp.removal_reason,
        'created_at', cp.created_at
      )
      ORDER BY cp.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_community_posts
  FROM public.community_posts cp
  WHERE cp.poster_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', prj.id,
        'title', prj.title,
        'description', prj.description,
        'status', prj.status,
        'visibility', prj.visibility,
        'participation_mode', prj.participation_mode,
        'consent_policy_version', prj.consent_policy_version,
        'output_provenance', prj.output_provenance,
        'created_at', prj.created_at
      )
      ORDER BY prj.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_owned_projects
  FROM public.collaborative_projects prj
  WHERE prj.creator_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'project_id', pp.project_id,
        'role', pp.role,
        'status', pp.status,
        'created_at', pp.created_at
      )
      ORDER BY pp.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_project_participations
  FROM public.project_participants pp
  WHERE pp.user_id = v_uid;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pc.id,
        'project_id', pc.project_id,
        'media_type', pc.media_type,
        'caption', pc.caption,
        'consent_granted', pc.consent_granted,
        'consent_granted_at', pc.consent_granted_at,
        'consent_policy_version', pc.consent_policy_version,
        'consent_withdrawn_at', pc.consent_withdrawn_at,
        'withdrawal_reason', pc.withdrawal_reason,
        'review_status', pc.review_status,
        'ai_disclosure_status', pc.ai_disclosure_status,
        'ai_disclosure_details', pc.ai_disclosure_details,
        'provenance_status', pc.provenance_status,
        'created_at', pc.created_at
      )
      ORDER BY pc.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_contributions
  FROM public.project_contributions pc
  WHERE pc.contributor_id = v_uid;

  -- Strictly strip reviewer_id and internal resolution_note from user's submitted reports
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cr.id,
        'target_type', cr.target_type,
        'target_id', cr.target_id,
        'reason', cr.reason,
        'details', cr.details,
        'status', cr.status,
        'reviewed_at', cr.reviewed_at,
        'created_at', cr.created_at
      )
      ORDER BY cr.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_reports
  FROM public.content_reports cr
  WHERE cr.reporter_id = v_uid;

  -- Strictly strip actor_id and reversed_by from moderation actions targeting the user
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ma.id,
        'target_type', ma.target_type,
        'target_id', ma.target_id,
        'action_type', ma.action_type,
        'reason', ma.reason,
        'duration_hours', ma.duration_hours,
        'expires_at', ma.expires_at,
        'status', ma.status,
        'reversed_at', ma.reversed_at,
        'reversal_reason', ma.reversal_reason,
        'created_at', ma.created_at
      )
      ORDER BY ma.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_moderation_actions
  FROM public.moderation_actions ma
  WHERE ma.target_user_id = v_uid;

  -- Strictly strip reviewer_id from appeals submitted by the user
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', ap.id,
        'moderation_action_id', ap.moderation_action_id,
        'reason', ap.reason,
        'status', ap.status,
        'resolution_note', ap.resolution_note,
        'reviewed_at', ap.reviewed_at,
        'created_at', ap.created_at
      )
      ORDER BY ap.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_appeals
  FROM public.moderation_appeals ap
  WHERE ap.appellant_id = v_uid;

  RETURN jsonb_build_object(
    'schema_version', '1.0-hiha-user-data-export',
    'exported_at', now(),
    'account_id', v_uid,
    'retention_and_privacy_notice', jsonb_build_object(
      'scope', 'Contains only data owned by or directly associated with the authenticated account.',
      'redactions', 'Internal moderation reviewer identities, private third-party profile data, and raw storage signing secrets are excluded for security and privacy.',
      'moderation_retention_policy', 'If an account is deactivated or deleted, anonymized moderation enforcement audit records (hashed subject identifier, action type, reason, and timestamps) are retained in the safety ledger to prevent abuse evasion.'
    ),
    'profile', v_profile,
    'topic_preferences', v_interests,
    'relationships', jsonb_build_object(
      'following', v_following,
      'followers', v_followers,
      'blocked_accounts', v_blocks,
      'muted_accounts', v_mutes
    ),
    'posts', v_posts,
    'post_likes', v_likes,
    'communities', jsonb_build_object(
      'memberships', v_community_memberships,
      'shared_posts', v_community_posts
    ),
    'collaborative_video', jsonb_build_object(
      'owned_projects', v_owned_projects,
      'participations', v_project_participations,
      'contributions_and_consents', v_contributions
    ),
    'safety_and_moderation', jsonb_build_object(
      'submitted_reports', v_reports,
      'moderation_actions_received', v_moderation_actions,
      'appeals_submitted', v_appeals
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.export_own_personal_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_own_personal_data() TO authenticated;

-- ================================================================
-- 8. Self-Service Account Deactivation / Deletion & Consent Revocation RPCs
-- ================================================================
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
BEGIN
  v_uid := auth.uid();
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

  PERFORM set_config('app.account_lifecycle_cleanup', 'true', true);

  -- 1. Snapshot anonymized moderation enforcement history into moderation_retention_ledger
  v_subject_hash := md5('hiha-audit-salt-v1:' || v_uid::text);

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
  WHERE mrl.subject_user_hash = v_subject_hash;

  -- 2. Withdraw all active collaborative video consents for this user.
  --    Because this UPDATE fires handle_project_contribution_update(), any
  --    collaborative project that stitched an approved clip from this user
  --    automatically has its active render jobs aborted and its
  --    output_media_path and output_provenance invalidated!
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

  -- Mark non-owner project participations as declined/exited
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
        updated_at = now()
    WHERE creator_id = v_uid
      AND status <> 'cancelled'
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_cancelled_projects_count FROM cancelled_prj;

  -- 4. Unpublish and make private all posts owned by this user so they are immediately removed from feeds, communities, and storage access
  WITH scrubbed_posts AS (
    UPDATE public.posts
    SET status = 'draft',
        visibility = 'private',
        caption = '[Content removed by account owner]',
        ai_disclosure_details = NULL,
        updated_at = now()
    WHERE creator_id = v_uid
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_unpublished_posts_count FROM scrubbed_posts;

  -- Mark any community cross-posts as removed
  UPDATE public.community_posts
  SET removed_at = COALESCE(removed_at, now()),
      removal_reason = 'Removed upon account deactivation/deletion'
  WHERE poster_id = v_uid
    AND removed_at IS NULL;

  -- 5. Scrub profile PII and lock down account visibility and interactions
  UPDATE public.profiles
  SET display_name = 'Deactivated Account',
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
    'retained_moderation_audit_records', v_retained_audit_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_or_execute_account_deletion(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_or_execute_account_deletion(TEXT, TEXT) TO authenticated;

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
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reactivate account';
  END IF;

  PERFORM set_config('app.account_lifecycle_cleanup', 'true', true);

  v_clean_name := NULLIF(trim(COALESCE(p_display_name, '')), '');

  UPDATE public.profiles
  SET deactivated_at = NULL,
      display_name = COALESCE(substr(v_clean_name, 1, 60), username),
      follow_permission = 'approval_required',
      interaction_permission = 'followers_only',
      updated_at = now()
  WHERE id = v_uid
  RETURNING * INTO v_updated;

  PERFORM set_config('app.account_lifecycle_cleanup', 'false', true);

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'Account profile not found';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.reactivate_own_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reactivate_own_account(TEXT) TO authenticated;
