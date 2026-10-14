-- Migration: 20261010010000_create_moderation_enforcement_and_appeals.sql
-- Description: Moderation enforcement actions, tamper-resistant audit trail, appeals workflow, and cross-route restriction enforcement.
-- Depends on: 20261010000000_create_content_reports.sql

-- ================================================================
-- 1. moderation_actions table (Tamper-Resistant Enforcement & Audit Log)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'community_post', 'profile')),
  target_id UUID NOT NULL,

  -- Explicit foreign keys for referential integrity & cascade cleanup when content/communities are deleted
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  community_post_id UUID REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reported_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id UUID REFERENCES public.communities(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.content_reports(id) ON DELETE SET NULL,

  action_type TEXT NOT NULL CHECK (
    action_type IN ('warning', 'content_restriction', 'account_restriction')
  ),
  reason TEXT NOT NULL CHECK (
    char_length(trim(reason)) >= 3 AND char_length(reason) <= 1000
  ),
  duration_hours INTEGER DEFAULT NULL CHECK (
    duration_hours IS NULL OR (duration_hours >= 1 AND duration_hours <= 8760)
  ),
  expires_at TIMESTAMPTZ DEFAULT NULL,

  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'reversed', 'expired')
  ),
  reversed_at TIMESTAMPTZ DEFAULT NULL,
  reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason TEXT DEFAULT NULL CHECK (
    reversal_reason IS NULL OR char_length(reversal_reason) <= 1000
  ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Polymorphic target reference integrity
  CONSTRAINT moderation_actions_target_ref_check CHECK (
    (target_type = 'post' AND post_id = target_id AND community_post_id IS NULL AND reported_profile_id IS NULL AND community_id IS NULL)
    OR
    (target_type = 'community_post' AND community_post_id = target_id AND post_id IS NULL AND reported_profile_id IS NULL AND community_id IS NOT NULL)
    OR
    (target_type = 'profile' AND reported_profile_id = target_id AND post_id IS NULL AND community_post_id IS NULL AND community_id IS NULL)
  ),

  -- Prevent self-moderation
  CONSTRAINT moderation_actions_no_self_action CHECK (
    actor_id <> target_user_id
  ),

  -- Temporary account restrictions must target a profile, be global, and specify a bounded duration & expiration
  CONSTRAINT moderation_actions_account_restriction_check CHECK (
    action_type <> 'account_restriction'
    OR (
      target_type = 'profile'
      AND community_id IS NULL
      AND duration_hours IS NOT NULL
      AND expires_at IS NOT NULL
    )
  ),

  -- Content restrictions must target a post or community_post
  CONSTRAINT moderation_actions_content_restriction_check CHECK (
    action_type <> 'content_restriction'
    OR target_type IN ('post', 'community_post')
  )
);

-- ================================================================
-- 2. Indexes on moderation_actions
-- ================================================================

-- Prevent duplicate active restrictions on the same target
CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_actions_unique_active_restriction
  ON public.moderation_actions (target_type, target_id, action_type)
  WHERE status = 'active' AND action_type IN ('content_restriction', 'account_restriction');

-- Prevent duplicate active actions for the same report and action_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_actions_unique_report_action
  ON public.moderation_actions (report_id, action_type)
  WHERE report_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_moderation_actions_target_user
  ON public.moderation_actions (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_post_active
  ON public.moderation_actions (post_id)
  WHERE status = 'active' AND action_type = 'content_restriction';

CREATE INDEX IF NOT EXISTS idx_moderation_actions_cp_active
  ON public.moderation_actions (community_post_id)
  WHERE status = 'active' AND action_type = 'content_restriction';

CREATE INDEX IF NOT EXISTS idx_moderation_actions_community
  ON public.moderation_actions (community_id, created_at DESC)
  WHERE community_id IS NOT NULL;

-- ================================================================
-- 3. Enforcement Helper Functions
--    Evaluates active status AND expiration timestamp so temporary
--    restrictions automatically cease once expires_at <= now().
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_post_restricted(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.moderation_actions
    WHERE target_type = 'post'
      AND post_id = p_id
      AND action_type = 'content_restriction'
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_community_post_restricted(cp_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.moderation_actions
    WHERE target_type = 'community_post'
      AND community_post_id = cp_id
      AND action_type = 'content_restriction'
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.is_account_restricted(u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.moderation_actions
    WHERE target_type = 'profile'
      AND target_user_id = u_id
      AND action_type = 'account_restriction'
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

REVOKE ALL ON FUNCTION public.is_post_restricted(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_post_restricted(UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_community_post_restricted(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_post_restricted(UUID) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.is_account_restricted(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_restricted(UUID) TO anon, authenticated;

-- ================================================================
-- 4. Triggers on moderation_actions (Validation & Audit Immutability)
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_moderation_action_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  resolved_owner UUID;
  resolved_comm UUID;
  prof_exists BOOLEAN;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NEW.actor_id <> caller_id THEN
    RAISE EXCEPTION 'Actor identity must match authenticated session';
  END IF;

  -- Enforce initial audit state on creation
  IF NEW.status <> 'active' OR NEW.reversed_at IS NOT NULL OR NEW.reversed_by IS NOT NULL OR NEW.reversal_reason IS NOT NULL THEN
    RAISE EXCEPTION 'New moderation actions must start in active state without reversal metadata';
  END IF;

  -- 1. Validate Post target (Global Platform Staff only)
  IF NEW.target_type = 'post' THEN
    IF NOT public.is_platform_staff(caller_id) THEN
      RAISE EXCEPTION 'Global platform staff authorization required for post moderation actions';
    END IF;

    SELECT creator_id INTO resolved_owner
    FROM public.posts
    WHERE id = NEW.target_id;

    IF resolved_owner IS NULL THEN
      RAISE EXCEPTION 'Target post does not exist';
    END IF;

    NEW.target_user_id := resolved_owner;
    NEW.post_id := NEW.target_id;
    NEW.community_post_id := NULL;
    NEW.reported_profile_id := NULL;
    NEW.community_id := NULL;

  -- 2. Validate Community Post target (Platform Staff OR Community Staff of that community)
  ELSIF NEW.target_type = 'community_post' THEN
    IF NEW.action_type = 'account_restriction' THEN
      RAISE EXCEPTION 'Account restrictions cannot target a community post';
    END IF;

    SELECT poster_id, community_id INTO resolved_owner, resolved_comm
    FROM public.community_posts
    WHERE id = NEW.target_id;

    IF resolved_owner IS NULL THEN
      RAISE EXCEPTION 'Target community post does not exist';
    END IF;

    IF NOT (public.is_platform_staff(caller_id) OR public.is_community_staff(resolved_comm, caller_id)) THEN
      RAISE EXCEPTION 'Moderator authorization required for this community';
    END IF;

    NEW.target_user_id := resolved_owner;
    NEW.community_post_id := NEW.target_id;
    NEW.community_id := resolved_comm;
    NEW.post_id := NULL;
    NEW.reported_profile_id := NULL;

  -- 3. Validate Profile target (Global Platform Staff only)
  ELSIF NEW.target_type = 'profile' THEN
    IF NOT public.is_platform_staff(caller_id) THEN
      RAISE EXCEPTION 'Global platform staff authorization required for profile moderation actions';
    END IF;

    IF NEW.action_type = 'content_restriction' THEN
      RAISE EXCEPTION 'Content restrictions cannot target a user profile';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.target_id) INTO prof_exists;
    IF NOT prof_exists THEN
      RAISE EXCEPTION 'Target profile does not exist';
    END IF;

    NEW.target_user_id := NEW.target_id;
    NEW.reported_profile_id := NEW.target_id;
    NEW.post_id := NULL;
    NEW.community_post_id := NULL;
    NEW.community_id := NULL;
  END IF;

  IF NEW.actor_id = NEW.target_user_id THEN
    RAISE EXCEPTION 'Cannot issue a moderation action against yourself';
  END IF;

  -- Compute expires_at from duration_hours if not explicitly provided
  IF NEW.duration_hours IS NOT NULL AND NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + (NEW.duration_hours || ' hours')::interval;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_action_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_moderation_action_insert ON public.moderation_actions;
CREATE TRIGGER on_moderation_action_insert
  BEFORE INSERT ON public.moderation_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_moderation_action_insert();

CREATE OR REPLACE FUNCTION public.handle_moderation_action_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Core audit fields are strictly immutable
  IF NEW.id <> OLD.id
     OR NEW.actor_id <> OLD.actor_id
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
    NEW.reversed_by := COALESCE(auth.uid(), NEW.reversed_by);
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_action_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_moderation_action_update ON public.moderation_actions;
CREATE TRIGGER on_moderation_action_update
  BEFORE UPDATE ON public.moderation_actions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_moderation_action_update();

-- ================================================================
-- 5. Grants & RLS on moderation_actions
--    Note: DELETE is strictly withheld from authenticated/anon to
--    preserve a tamper-resistant audit log.
-- ================================================================
REVOKE ALL ON public.moderation_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.moderation_actions TO authenticated;

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

-- SELECT:
-- 1. Affected user can view moderation actions targeting them
-- 2. Platform staff can view all moderation actions
-- 3. Community staff can view moderation actions scoped to their community
DROP POLICY IF EXISTS "moderation_actions_select_policy" ON public.moderation_actions;
CREATE POLICY "moderation_actions_select_policy"
  ON public.moderation_actions
  FOR SELECT
  TO authenticated
  USING (
    target_user_id = (select auth.uid())
    OR public.is_platform_staff((select auth.uid()))
    OR (
      community_id IS NOT NULL
      AND public.is_community_staff(community_id, (select auth.uid()))
    )
  );

-- INSERT:
-- Actor must be the authenticated user AND either platform staff (global) or community staff (scoped)
DROP POLICY IF EXISTS "moderation_actions_insert_policy" ON public.moderation_actions;
CREATE POLICY "moderation_actions_insert_policy"
  ON public.moderation_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = (select auth.uid())
    AND status = 'active'
    AND (
      public.is_platform_staff((select auth.uid()))
      OR (
        target_type = 'community_post'
        AND community_id IS NOT NULL
        AND public.is_community_staff(community_id, (select auth.uid()))
      )
    )
  );

-- UPDATE:
-- Only platform staff (global) or community staff (for their community) can reverse/expire an action.
-- Target users can NEVER update their own moderation_actions record.
DROP POLICY IF EXISTS "moderation_actions_update_policy" ON public.moderation_actions;
CREATE POLICY "moderation_actions_update_policy"
  ON public.moderation_actions
  FOR UPDATE
  TO authenticated
  USING (
    target_user_id <> (select auth.uid())
    AND (
      public.is_platform_staff((select auth.uid()))
      OR (
        community_id IS NOT NULL
        AND public.is_community_staff(community_id, (select auth.uid()))
      )
    )
  )
  WITH CHECK (
    target_user_id <> (select auth.uid())
    AND (
      public.is_platform_staff((select auth.uid()))
      OR (
        community_id IS NOT NULL
        AND public.is_community_staff(community_id, (select auth.uid()))
      )
    )
  );

-- ================================================================
-- 6. moderation_appeals table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  moderation_action_id UUID NOT NULL REFERENCES public.moderation_actions(id) ON DELETE CASCADE,
  appellant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (
    char_length(trim(reason)) >= 10 AND char_length(reason) <= 1000
  ),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'under_review', 'approved', 'rejected')
  ),
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  resolution_note TEXT DEFAULT NULL CHECK (
    resolution_note IS NULL OR char_length(resolution_note) <= 1000
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT moderation_appeals_unique_action UNIQUE (moderation_action_id)
);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_appellant
  ON public.moderation_appeals (appellant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_appeals_status
  ON public.moderation_appeals (status, created_at DESC);

-- ================================================================
-- 7. Triggers on moderation_appeals
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_moderation_appeal_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  act_target_user UUID;
  act_status TEXT;
  act_expires TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR NEW.appellant_id <> auth.uid() THEN
    RAISE EXCEPTION 'Appellant identity must match authenticated session';
  END IF;

  SELECT target_user_id, status, expires_at
  INTO act_target_user, act_status, act_expires
  FROM public.moderation_actions
  WHERE id = NEW.moderation_action_id;

  IF act_target_user IS NULL THEN
    RAISE EXCEPTION 'Referenced moderation action does not exist';
  END IF;

  IF act_target_user <> NEW.appellant_id THEN
    RAISE EXCEPTION 'Only the user subject to the moderation action may submit an appeal';
  END IF;

  IF act_status <> 'active' OR (act_expires IS NOT NULL AND act_expires <= now()) THEN
    RAISE EXCEPTION 'Cannot appeal a moderation action that is already reversed or expired';
  END IF;

  IF NEW.status <> 'pending' OR NEW.reviewer_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.resolution_note IS NOT NULL THEN
    RAISE EXCEPTION 'New appeals must start in pending state without reviewer metadata';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_appeal_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_moderation_appeal_insert ON public.moderation_appeals;
CREATE TRIGGER on_moderation_appeal_insert
  BEFORE INSERT ON public.moderation_appeals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_moderation_appeal_insert();

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
  caller_id := auth.uid();
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
    WHERE id = NEW.moderation_action_id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_moderation_appeal_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_moderation_appeal_update ON public.moderation_appeals;
CREATE TRIGGER on_moderation_appeal_update
  BEFORE UPDATE ON public.moderation_appeals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_moderation_appeal_update();

-- ================================================================
-- 8. Grants & RLS on moderation_appeals
-- ================================================================
REVOKE ALL ON public.moderation_appeals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.moderation_appeals TO authenticated;

ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;

-- SELECT: Appellant, platform staff, or community staff for the parent action's community
DROP POLICY IF EXISTS "moderation_appeals_select_policy" ON public.moderation_appeals;
CREATE POLICY "moderation_appeals_select_policy"
  ON public.moderation_appeals
  FOR SELECT
  TO authenticated
  USING (
    appellant_id = (select auth.uid())
    OR public.is_platform_staff((select auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.moderation_actions ma
      WHERE ma.id = moderation_appeals.moderation_action_id
        AND ma.community_id IS NOT NULL
        AND public.is_community_staff(ma.community_id, (select auth.uid()))
    )
  );

-- INSERT: Appellant only
DROP POLICY IF EXISTS "moderation_appeals_insert_policy" ON public.moderation_appeals;
CREATE POLICY "moderation_appeals_insert_policy"
  ON public.moderation_appeals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    appellant_id = (select auth.uid())
    AND status = 'pending'
    AND reviewer_id IS NULL
    AND reviewed_at IS NULL
    AND resolution_note IS NULL
  );

-- UPDATE: Platform staff or authorized community staff (never the appellant)
DROP POLICY IF EXISTS "moderation_appeals_update_policy" ON public.moderation_appeals;
CREATE POLICY "moderation_appeals_update_policy"
  ON public.moderation_appeals
  FOR UPDATE
  TO authenticated
  USING (
    appellant_id <> (select auth.uid())
    AND (
      public.is_platform_staff((select auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.moderation_actions ma
        WHERE ma.id = moderation_appeals.moderation_action_id
          AND ma.community_id IS NOT NULL
          AND public.is_community_staff(ma.community_id, (select auth.uid()))
      )
    )
  )
  WITH CHECK (
    appellant_id <> (select auth.uid())
    AND (
      public.is_platform_staff((select auth.uid()))
      OR EXISTS (
        SELECT 1 FROM public.moderation_actions ma
        WHERE ma.id = moderation_appeals.moderation_action_id
          AND ma.community_id IS NOT NULL
          AND public.is_community_staff(ma.community_id, (select auth.uid()))
      )
    )
  );

-- ================================================================
-- 9. Cross-Route Enforcement Integration on posts & community_posts
--    Ensures restricted posts cannot bypass enforcement via feeds,
--    community cross-posts, or signed/direct media access, and
--    restricted accounts cannot create or cross-post content while
--    their temporary restriction is active.
-- ================================================================

DROP POLICY IF EXISTS "Posts visibility policy" ON public.posts;
CREATE POLICY "Posts visibility policy"
  ON public.posts
  FOR SELECT
  USING (
    -- 1. Creator can always view their own posts (including drafts, private, and restricted for appeal visibility)
    (select auth.uid()) = creator_id
    OR (
      -- 2. Only published, non-restricted posts are accessible to non-creators
      status = 'published'
      AND NOT public.is_post_restricted(posts.id)
      AND (
        (select auth.uid()) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (b.blocker_id = posts.creator_id AND b.blocked_id = (select auth.uid()))
             OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = posts.creator_id)
        )
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

DROP POLICY IF EXISTS "Users can create their own posts" ON public.posts;
CREATE POLICY "Users can create their own posts"
  ON public.posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = creator_id
    AND NOT public.is_account_restricted((select auth.uid()))
  );

DROP POLICY IF EXISTS "Users can update their own posts" ON public.posts;
CREATE POLICY "Users can update their own posts"
  ON public.posts
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = creator_id
    AND NOT public.is_account_restricted((select auth.uid()))
  )
  WITH CHECK (
    (select auth.uid()) = creator_id
    AND NOT public.is_account_restricted((select auth.uid()))
  );

DROP POLICY IF EXISTS "community_posts_select_policy" ON public.community_posts;
CREATE POLICY "community_posts_select_policy"
  ON public.community_posts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_posts.community_id
    )
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = community_posts.post_id
    )
    AND (
      NOT public.is_post_restricted(community_posts.post_id)
    )
    AND (
      NOT public.is_community_post_restricted(community_posts.id)
      OR poster_id = (select auth.uid())
      OR public.is_community_staff(community_posts.community_id, (select auth.uid()))
      OR public.is_platform_staff((select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "community_posts_insert_policy" ON public.community_posts;
CREATE POLICY "community_posts_insert_policy"
  ON public.community_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    poster_id = (select auth.uid())
    AND NOT public.is_account_restricted((select auth.uid()))
    AND NOT public.is_post_restricted(post_id)
    AND public.is_community_active_member(community_id, (select auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = community_posts.post_id
        AND p.status = 'published'
    )
  );
