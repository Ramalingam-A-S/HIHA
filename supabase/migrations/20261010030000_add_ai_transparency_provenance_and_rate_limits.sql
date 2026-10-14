-- ================================================================
-- MIGRATION: 20261010030000_add_ai_transparency_provenance_and_rate_limits.sql
-- Description:
--   Milestone 4.3 — AI Content Transparency, Collaborative Provenance &
--   Manipulated-Engagement Safeguards.
--   1. Adds AI/material alteration disclosure and provenance metadata to
--      public.posts and public.project_contributions.
--   2. Distinguishes 'not_declared' from 'no_ai_declared' and 'machine_verified',
--      blocks client forgery of verification status, and automatically
--      invalidates machine_verified status when post content or disclosure changes.
--   3. Preserves privacy-safe collaborative video provenance summaries across
--      public.project_render_jobs and public.collaborative_projects while
--      clearing provenance if consent is withdrawn or the project is cancelled.
--   4. Adds public.rate_limit_events and database-enforced rate limits for
--      rapid like/unlike toggling, mass-liking bursts, duplicate/burst post
--      spam, and community cross-post flooding.
-- ================================================================

-- ================================================================
-- 1. Extend public.posts with AI Disclosure & Provenance Columns
-- ================================================================
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS ai_disclosure_status TEXT NOT NULL DEFAULT 'not_declared',
  ADD COLUMN IF NOT EXISTS ai_disclosure_details TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_disclosed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS provenance_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS provenance_verified_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_ai_disclosure_status_check CHECK (
    ai_disclosure_status IN (
      'not_declared',
      'no_ai_declared',
      'ai_generated',
      'ai_assisted',
      'material_alteration'
    )
  ),
  ADD CONSTRAINT posts_ai_disclosure_details_check CHECK (
    ai_disclosure_details IS NULL
    OR (
      char_length(trim(ai_disclosure_details)) >= 1
      AND char_length(ai_disclosure_details) <= 500
    )
  ),
  ADD CONSTRAINT posts_provenance_status_check CHECK (
    provenance_status IN ('unverified', 'creator_declared', 'machine_verified')
  ),
  ADD CONSTRAINT posts_ai_disclosure_consistency_check CHECK (
    (
      ai_disclosure_status = 'not_declared'
      AND ai_disclosure_details IS NULL
      AND ai_disclosed_at IS NULL
      AND provenance_status = 'unverified'
      AND provenance_verified_at IS NULL
    )
    OR (
      ai_disclosure_status <> 'not_declared'
      AND ai_disclosed_at IS NOT NULL
      AND provenance_status IN ('creator_declared', 'machine_verified')
      AND (
        (provenance_status = 'machine_verified' AND provenance_verified_at IS NOT NULL)
        OR (provenance_status = 'creator_declared' AND provenance_verified_at IS NULL)
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_posts_ai_disclosure_status
  ON public.posts (ai_disclosure_status)
  WHERE ai_disclosure_status <> 'not_declared';

-- ================================================================
-- 2. Extend public.project_contributions with AI Disclosure & Provenance
-- ================================================================
ALTER TABLE public.project_contributions
  ADD COLUMN IF NOT EXISTS ai_disclosure_status TEXT NOT NULL DEFAULT 'not_declared',
  ADD COLUMN IF NOT EXISTS ai_disclosure_details TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_disclosed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS provenance_status TEXT NOT NULL DEFAULT 'unverified';

ALTER TABLE public.project_contributions
  ADD CONSTRAINT project_contributions_ai_disclosure_status_check CHECK (
    ai_disclosure_status IN (
      'not_declared',
      'no_ai_declared',
      'ai_generated',
      'ai_assisted',
      'material_alteration'
    )
  ),
  ADD CONSTRAINT project_contributions_ai_disclosure_details_check CHECK (
    ai_disclosure_details IS NULL
    OR (
      char_length(trim(ai_disclosure_details)) >= 1
      AND char_length(ai_disclosure_details) <= 500
    )
  ),
  ADD CONSTRAINT project_contributions_provenance_status_check CHECK (
    provenance_status IN ('unverified', 'creator_declared', 'machine_verified')
  ),
  ADD CONSTRAINT project_contributions_ai_disclosure_consistency_check CHECK (
    (
      ai_disclosure_status = 'not_declared'
      AND ai_disclosure_details IS NULL
      AND ai_disclosed_at IS NULL
      AND provenance_status = 'unverified'
    )
    OR (
      ai_disclosure_status <> 'not_declared'
      AND ai_disclosed_at IS NOT NULL
      AND provenance_status IN ('creator_declared', 'machine_verified')
    )
  );

-- ================================================================
-- 3. Extend public.project_render_jobs and public.collaborative_projects
--    with Privacy-Safe Output Provenance Summary
-- ================================================================
ALTER TABLE public.project_render_jobs
  ADD COLUMN IF NOT EXISTS output_provenance JSONB DEFAULT NULL;

ALTER TABLE public.collaborative_projects
  ADD COLUMN IF NOT EXISTS output_provenance JSONB DEFAULT NULL;

-- Helper function to build privacy-safe output provenance JSONB from an input manifest
CREATE OR REPLACE FUNCTION public.build_collaborative_output_provenance(
  p_render_job_id UUID,
  p_manifest JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_total INTEGER := 0;
  v_not_declared INTEGER := 0;
  v_no_ai_declared INTEGER := 0;
  v_ai_generated INTEGER := 0;
  v_ai_assisted INTEGER := 0;
  v_material_alteration INTEGER := 0;
  v_sequences JSONB := '[]'::jsonb;
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'array' THEN
    RETURN NULL;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE COALESCE(item->>'ai_disclosure_status', 'not_declared') = 'not_declared')::integer,
    COUNT(*) FILTER (WHERE item->>'ai_disclosure_status' = 'no_ai_declared')::integer,
    COUNT(*) FILTER (WHERE item->>'ai_disclosure_status' = 'ai_generated')::integer,
    COUNT(*) FILTER (WHERE item->>'ai_disclosure_status' = 'ai_assisted')::integer,
    COUNT(*) FILTER (WHERE item->>'ai_disclosure_status' = 'material_alteration')::integer,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'sequence_order', COALESCE((item->>'sequence_order')::integer, 1),
          'ai_disclosure_status', COALESCE(item->>'ai_disclosure_status', 'not_declared')
        )
        ORDER BY COALESCE((item->>'sequence_order')::integer, 1) ASC
      ),
      '[]'::jsonb
    )
  INTO
    v_total,
    v_not_declared,
    v_no_ai_declared,
    v_ai_generated,
    v_ai_assisted,
    v_material_alteration,
    v_sequences
  FROM jsonb_array_elements(p_manifest) AS item;

  RETURN jsonb_build_object(
    'schema_version', '1.0',
    'render_job_id', p_render_job_id,
    'rendered_at', now(),
    'total_included_clips', v_total,
    'has_declared_ai_or_alteration', (v_ai_generated + v_ai_assisted + v_material_alteration) > 0,
    'has_undeclared_clips', v_not_declared > 0,
    'provenance_status', CASE
      WHEN v_not_declared = v_total THEN 'unverified'
      ELSE 'creator_declared'
    END,
    'disclosure_breakdown', jsonb_build_object(
      'not_declared', v_not_declared,
      'no_ai_declared', v_no_ai_declared,
      'ai_generated', v_ai_generated,
      'ai_assisted', v_ai_assisted,
      'material_alteration', v_material_alteration
    ),
    'included_sequences', v_sequences
  );
END;
$$;

REVOKE ALL ON FUNCTION public.build_collaborative_output_provenance(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ================================================================
-- 4. Rate Limit & Anti-Manipulation Event Log Table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (
    action_type IN ('like_post', 'create_post', 'share_community_post')
  ),
  target_key TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user_action_created
  ON public.rate_limit_events (user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user_target_created
  ON public.rate_limit_events (user_id, action_type, target_key, created_at DESC)
  WHERE target_key IS NOT NULL;

REVOKE ALL ON public.rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.rate_limit_events TO authenticated;

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rate limit events"
  ON public.rate_limit_events
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

-- ================================================================
-- 5. Posts Authenticity, Provenance & Anti-Spam Trigger
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_post_authenticity_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  v_trusted_verifier BOOLEAN;
  v_content_or_disclosure_changed BOOLEAN;
  v_burst_count INTEGER;
  v_dup_count INTEGER;
  v_caption_hash TEXT;
BEGIN
  caller_id := auth.uid();
  v_trusted_verifier := COALESCE(current_setting('app.trusted_provenance_verifier', true), '') = 'true';

  -- Enforce account moderation restriction on both INSERT and UPDATE
  IF caller_id IS NOT NULL AND public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Account is currently restricted from creating or modifying posts';
  END IF;

  IF NEW.ai_disclosure_details IS NOT NULL THEN
    NEW.ai_disclosure_details := NULLIF(trim(NEW.ai_disclosure_details), '');
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF caller_id IS NOT NULL AND NEW.creator_id <> caller_id THEN
      RAISE EXCEPTION 'Creator identity must match authenticated session';
    END IF;

    IF NOT v_trusted_verifier AND (
      NEW.provenance_status = 'machine_verified'
      OR NEW.provenance_verified_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Forbidden: verification status cannot be forged by client session';
    END IF;

    IF NEW.ai_disclosure_status = 'not_declared' THEN
      IF NEW.ai_disclosure_details IS NOT NULL THEN
        RAISE EXCEPTION 'Disclosure details require selecting a disclosure status other than not_declared';
      END IF;
      NEW.ai_disclosed_at := NULL;
      NEW.provenance_status := 'unverified';
      NEW.provenance_verified_at := NULL;
    ELSE
      NEW.ai_disclosed_at := COALESCE(NEW.ai_disclosed_at, now());
      IF v_trusted_verifier AND NEW.provenance_status = 'machine_verified' THEN
        NEW.provenance_verified_at := COALESCE(NEW.provenance_verified_at, now());
      ELSE
        NEW.provenance_status := 'creator_declared';
        NEW.provenance_verified_at := NULL;
      END IF;
    END IF;

    -- Anti-spam rate limits on post creation
    SELECT COUNT(*)
    INTO v_burst_count
    FROM public.rate_limit_events rle
    WHERE rle.user_id = NEW.creator_id
      AND rle.action_type = 'create_post'
      AND rle.created_at >= (now() - interval '10 seconds');

    IF v_burst_count >= 12 THEN
      RAISE EXCEPTION 'Rate limit exceeded: too many posts submitted in a short period.';
    END IF;

    IF NEW.caption IS NOT NULL AND char_length(trim(NEW.caption)) >= 1 THEN
      v_caption_hash := md5(lower(trim(NEW.caption)));

      SELECT COUNT(*)
      INTO v_dup_count
      FROM public.rate_limit_events rle
      WHERE rle.user_id = NEW.creator_id
        AND rle.action_type = 'create_post'
        AND rle.target_key = v_caption_hash
        AND rle.created_at >= (now() - interval '60 seconds');

      IF v_dup_count >= 3 THEN
        RAISE EXCEPTION 'Automated submission safeguard: duplicate post content submitted too rapidly.';
      END IF;
    ELSE
      v_caption_hash := NULL;
    END IF;

    INSERT INTO public.rate_limit_events (user_id, action_type, target_key)
    VALUES (NEW.creator_id, 'create_post', v_caption_hash);

    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.id <> OLD.id
     OR NEW.creator_id <> OLD.creator_id
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Post identity fields are immutable';
  END IF;

  IF public.is_post_restricted(OLD.id) THEN
    RAISE EXCEPTION 'Restricted posts cannot be modified while under active moderation enforcement';
  END IF;

  IF OLD.status = 'published' AND (
    NEW.content_type <> OLD.content_type
    OR NEW.media_path IS DISTINCT FROM OLD.media_path
  ) THEN
    RAISE EXCEPTION 'Cannot replace media or content type of an already-published post';
  END IF;

  v_content_or_disclosure_changed := (
    NEW.caption IS DISTINCT FROM OLD.caption
    OR NEW.media_path IS DISTINCT FROM OLD.media_path
    OR NEW.media_metadata IS DISTINCT FROM OLD.media_metadata
    OR NEW.ai_disclosure_status IS DISTINCT FROM OLD.ai_disclosure_status
    OR NEW.ai_disclosure_details IS DISTINCT FROM OLD.ai_disclosure_details
  );

  IF v_trusted_verifier AND NEW.provenance_status = 'machine_verified' THEN
    IF NEW.ai_disclosure_status = 'not_declared' THEN
      RAISE EXCEPTION 'Cannot machine-verify provenance when disclosure status is not_declared';
    END IF;
    NEW.provenance_verified_at := COALESCE(NEW.provenance_verified_at, now());
    NEW.ai_disclosed_at := COALESCE(OLD.ai_disclosed_at, now());
    RETURN NEW;
  END IF;

  IF OLD.provenance_status = 'machine_verified' THEN
    IF v_content_or_disclosure_changed THEN
      -- Editing caption, media, or disclosure invalidates prior machine verification
      NEW.provenance_status := CASE
        WHEN NEW.ai_disclosure_status = 'not_declared' THEN 'unverified'
        ELSE 'creator_declared'
      END;
      NEW.provenance_verified_at := NULL;
    ELSE
      NEW.provenance_status := 'machine_verified';
      NEW.provenance_verified_at := OLD.provenance_verified_at;
    END IF;
  ELSE
    IF NEW.provenance_status = 'machine_verified' OR NEW.provenance_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'Forbidden: verification status cannot be forged by client session';
    END IF;

    NEW.provenance_status := CASE
      WHEN NEW.ai_disclosure_status = 'not_declared' THEN 'unverified'
      ELSE 'creator_declared'
    END;
    NEW.provenance_verified_at := NULL;
  END IF;

  IF NEW.ai_disclosure_status = 'not_declared' THEN
    IF NEW.ai_disclosure_details IS NOT NULL THEN
      RAISE EXCEPTION 'Disclosure details require selecting a disclosure status other than not_declared';
    END IF;
    NEW.ai_disclosed_at := NULL;
  ELSIF NEW.ai_disclosure_status IS DISTINCT FROM OLD.ai_disclosure_status
     OR NEW.ai_disclosure_details IS DISTINCT FROM OLD.ai_disclosure_details
     OR OLD.ai_disclosed_at IS NULL
  THEN
    NEW.ai_disclosed_at := now();
  ELSE
    NEW.ai_disclosed_at := OLD.ai_disclosed_at;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_post_authenticity_before_write() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_post_authenticity_before_write
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_authenticity_before_write();

-- Tighten UPDATE RLS policy on public.posts so restricted posts cannot be updated
ALTER POLICY "Users can update their own posts"
  ON public.posts
  USING (
    (select auth.uid()) = creator_id
    AND NOT public.is_account_restricted((select auth.uid()))
    AND NOT public.is_post_restricted(posts.id)
  )
  WITH CHECK (
    (select auth.uid()) = creator_id
    AND NOT public.is_account_restricted((select auth.uid()))
    AND NOT public.is_post_restricted(posts.id)
  );

-- Trusted server-side RPC for platform staff to record machine-verified provenance
-- Uses SECURITY INVOKER + transaction-local flag so RLS remains active and
-- clients cannot forge provenance_status via direct table writes.
CREATE OR REPLACE FUNCTION public.issue_post_provenance_verification(p_post_id UUID)
RETURNS public.posts
LANGUAGE plpgsql
SECURITY INVOKER
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_caller UUID;
  v_updated public.posts;
BEGIN
  v_caller := (select auth.uid());
  IF v_caller IS NULL OR NOT public.is_platform_staff(v_caller) THEN
    RAISE EXCEPTION 'Platform staff authorization required to issue provenance verification';
  END IF;

  IF public.is_account_restricted(v_caller) THEN
    RAISE EXCEPTION 'Restricted accounts cannot issue provenance verification';
  END IF;

  PERFORM set_config('app.trusted_provenance_verifier', 'true', true);

  UPDATE public.posts
  SET provenance_status = 'machine_verified',
      provenance_verified_at = now(),
      updated_at = now()
  WHERE id = p_post_id
  RETURNING * INTO v_updated;

  PERFORM set_config('app.trusted_provenance_verifier', 'false', true);

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'Target post not found or not editable by caller';
  END IF;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_post_provenance_verification(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_post_provenance_verification(UUID) TO authenticated;

-- ================================================================
-- 6. Manipulated-Engagement Safeguards on Likes & Community Shares
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_post_like_safeguards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  v_toggle_count INTEGER;
  v_burst_count INTEGER;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL OR NEW.user_id <> caller_id THEN
    RAISE EXCEPTION 'User identity must match authenticated session';
  END IF;

  IF public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Account is currently restricted from liking posts';
  END IF;

  IF public.is_post_restricted(NEW.post_id) THEN
    RAISE EXCEPTION 'Cannot interact with a restricted post';
  END IF;

  -- 1. Rapid like/unlike toggling safeguard on the same post (max 3 likes on same post within 60s)
  SELECT COUNT(*)
  INTO v_toggle_count
  FROM public.rate_limit_events rle
  WHERE rle.user_id = caller_id
    AND rle.action_type = 'like_post'
    AND rle.target_key = NEW.post_id::text
    AND rle.created_at >= (now() - interval '60 seconds');

  IF v_toggle_count >= 3 THEN
    RAISE EXCEPTION 'Rate limit exceeded: repeated like toggling on the same post is restricted.';
  END IF;

  -- 2. Mass-liking burst safeguard across posts (max 25 likes within 15s)
  SELECT COUNT(*)
  INTO v_burst_count
  FROM public.rate_limit_events rle
  WHERE rle.user_id = caller_id
    AND rle.action_type = 'like_post'
    AND rle.created_at >= (now() - interval '15 seconds');

  IF v_burst_count >= 25 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many like actions in a short period.';
  END IF;

  INSERT INTO public.rate_limit_events (user_id, action_type, target_key)
  VALUES (caller_id, 'like_post', NEW.post_id::text);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_post_like_safeguards() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_post_like_safeguards
  BEFORE INSERT ON public.post_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_post_like_safeguards();

CREATE OR REPLACE FUNCTION public.handle_community_post_safeguards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  v_burst_count INTEGER;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NOT NULL AND public.is_account_restricted(caller_id) THEN
    RAISE EXCEPTION 'Account is currently restricted from sharing posts to communities';
  END IF;

  SELECT COUNT(*)
  INTO v_burst_count
  FROM public.rate_limit_events rle
  WHERE rle.user_id = NEW.poster_id
    AND rle.action_type = 'share_community_post'
    AND rle.created_at >= (now() - interval '15 seconds');

  IF v_burst_count >= 8 THEN
    RAISE EXCEPTION 'Rate limit exceeded: too many community post shares in a short period.';
  END IF;

  INSERT INTO public.rate_limit_events (user_id, action_type, target_key)
  VALUES (NEW.poster_id, 'share_community_post', NEW.community_id::text);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_community_post_safeguards() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_community_post_safeguards
  BEFORE INSERT ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_community_post_safeguards();

-- ================================================================
-- 7. Collaborative Contributions & Render Provenance Triggers
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
  post_ai_status TEXT;
  post_ai_details TEXT;
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

  IF NEW.ai_disclosure_details IS NOT NULL THEN
    NEW.ai_disclosure_details := NULLIF(trim(NEW.ai_disclosure_details), '');
  END IF;

  IF NEW.source_post_id IS NOT NULL THEN
    SELECT creator_id, media_path, content_type, status, ai_disclosure_status, ai_disclosure_details
    INTO post_owner, post_media, post_type, post_status, post_ai_status, post_ai_details
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

    -- Inherit disclosure metadata from source post if contributor did not override it
    IF NEW.ai_disclosure_status = 'not_declared' AND post_ai_status <> 'not_declared' THEN
      NEW.ai_disclosure_status := post_ai_status;
      NEW.ai_disclosure_details := COALESCE(NEW.ai_disclosure_details, post_ai_details);
    END IF;
  END IF;

  IF NEW.provenance_status = 'machine_verified' THEN
    RAISE EXCEPTION 'Forbidden: contribution verification status cannot be forged by client session';
  END IF;

  IF NEW.ai_disclosure_status = 'not_declared' THEN
    IF NEW.ai_disclosure_details IS NOT NULL THEN
      RAISE EXCEPTION 'Disclosure details require selecting a disclosure status other than not_declared';
    END IF;
    NEW.ai_disclosed_at := NULL;
    NEW.provenance_status := 'unverified';
  ELSE
    NEW.ai_disclosed_at := now();
    NEW.provenance_status := 'creator_declared';
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
     OR NEW.ai_disclosure_status IS DISTINCT FROM OLD.ai_disclosure_status
     OR NEW.ai_disclosure_details IS DISTINCT FROM OLD.ai_disclosure_details
     OR NEW.ai_disclosed_at IS DISTINCT FROM OLD.ai_disclosed_at
     OR NEW.provenance_status IS DISTINCT FROM OLD.provenance_status
     OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'Contribution identity, media, disclosure metadata, and original consent timestamp are immutable';
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
    AND pc.ai_disclosure_status = COALESCE(item->>'ai_disclosure_status', pc.ai_disclosure_status)
    AND public.is_project_active_participant(p_project_id, pc.contributor_id)
    AND NOT public.is_account_restricted(pc.contributor_id)
    AND NOT public.is_blocked(p_creator, pc.contributor_id)
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
        'consent_policy_version', pc.consent_policy_version,
        'ai_disclosure_status', pc.ai_disclosure_status
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
  NEW.output_provenance := NULL;
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

  IF pg_trigger_depth() > 1 AND NEW.status = 'failed' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.output_media_path := NULL;
    NEW.output_provenance := NULL;
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
    NEW.output_provenance := NULL;

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
    NEW.output_provenance := NULL;

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

    v_provenance := public.build_collaborative_output_provenance(OLD.id, OLD.input_manifest);

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

  ELSIF OLD.status IN ('queued', 'processing') AND NEW.status = 'failed' THEN
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

-- Re-create claim_project_render_job after adding output_provenance column
-- so RETURNING rj.* matches the updated composite row type of project_render_jobs.
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
