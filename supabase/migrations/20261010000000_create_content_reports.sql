-- Migration: 20261010000000_create_content_reports.sql
-- Description: Content reporting, platform staff roles, and scoped moderation review queue.
-- Depends on: 20261009120000_create_profiles.sql, 20261009150000_create_posts_and_media.sql, 20261009190000_create_communities.sql, 20261009200000_create_community_posts.sql

-- ================================================================
-- 1. platform_staff table & helper
--    Defines global platform moderators/administrators.
--    Decoupled from community ownership/roles.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.platform_staff (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('admin', 'moderator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_staff_user ON public.platform_staff (user_id);

GRANT SELECT ON public.platform_staff TO authenticated;

ALTER TABLE public.platform_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_staff_select_own" ON public.platform_staff;
CREATE POLICY "platform_staff_select_own"
  ON public.platform_staff
  FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.is_platform_staff(u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_staff
    WHERE user_id = u_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_staff(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_staff(UUID) TO authenticated;

-- ================================================================
-- 2. content_reports table
--    Polymorphic report storage for posts, community posts, and profiles.
--    Maintains explicit foreign keys to guarantee referential integrity
--    and automatic CASCADE cleanup on target deletion.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post', 'community_post', 'profile')),
  target_id UUID NOT NULL,

  -- Referential columns for polymorphic cascade and DB-level integrity
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  community_post_id UUID REFERENCES public.community_posts(id) ON DELETE CASCADE,
  reported_profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  community_id UUID REFERENCES public.communities(id) ON DELETE CASCADE,

  reason TEXT NOT NULL CHECK (
    reason IN ('spam', 'harassment', 'hate_speech', 'misinformation', 'violence', 'copyright', 'other')
  ),
  details TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'in_review', 'resolved', 'dismissed')
  ),
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  resolution_note TEXT DEFAULT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Target polymorphism mapping constraint
  CONSTRAINT content_reports_target_ref_check CHECK (
    (target_type = 'post' AND post_id = target_id AND community_post_id IS NULL AND reported_profile_id IS NULL)
    OR
    (target_type = 'community_post' AND community_post_id = target_id AND post_id IS NULL AND reported_profile_id IS NULL)
    OR
    (target_type = 'profile' AND reported_profile_id = target_id AND post_id IS NULL AND community_post_id IS NULL)
  ),

  -- Rejection of direct self-reporting for profile targets
  CONSTRAINT content_reports_no_self_profile_report CHECK (
    NOT (target_type = 'profile' AND target_id = reporter_id)
  ),

  -- Length limits
  CONSTRAINT content_reports_details_length CHECK (
    details IS NULL OR length(details) <= 1000
  ),
  CONSTRAINT content_reports_resolution_note_length CHECK (
    resolution_note IS NULL OR length(resolution_note) <= 1000
  )
);

-- ================================================================
-- 3. Indexes
-- ================================================================

-- Concurrency-safe deduplication: only ONE active (open / in_review) report per reporter per target
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_unique_active
  ON public.content_reports (reporter_id, target_type, target_id)
  WHERE status IN ('open', 'in_review');

CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON public.content_reports (target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_content_reports_reporter
  ON public.content_reports (reporter_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_reports_queue
  ON public.content_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_reports_community_queue
  ON public.content_reports (community_id, status, created_at DESC)
  WHERE community_id IS NOT NULL;

-- ================================================================
-- 4. Triggers
-- ================================================================

-- Updated_at trigger
DROP TRIGGER IF EXISTS on_content_reports_updated_at ON public.content_reports;
CREATE TRIGGER on_content_reports_updated_at
  BEFORE UPDATE ON public.content_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Target validation and automatic linking trigger
CREATE OR REPLACE FUNCTION public.handle_content_report_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  post_author UUID;
  cp_author UUID;
  cp_community UUID;
  prof_exists BOOLEAN;
BEGIN
  -- 1. Validate post target
  IF NEW.target_type = 'post' THEN
    SELECT creator_id INTO post_author
    FROM public.posts
    WHERE id = NEW.target_id;

    IF post_author IS NULL THEN
      RAISE EXCEPTION 'Target post does not exist';
    END IF;

    IF post_author = NEW.reporter_id THEN
      RAISE EXCEPTION 'Cannot report your own post';
    END IF;

    NEW.post_id := NEW.target_id;
    NEW.community_post_id := NULL;
    NEW.reported_profile_id := NULL;

  -- 2. Validate community post target
  ELSIF NEW.target_type = 'community_post' THEN
    SELECT poster_id, community_id INTO cp_author, cp_community
    FROM public.community_posts
    WHERE id = NEW.target_id;

    IF cp_author IS NULL THEN
      RAISE EXCEPTION 'Target community post does not exist';
    END IF;

    IF cp_author = NEW.reporter_id THEN
      RAISE EXCEPTION 'Cannot report your own community post';
    END IF;

    NEW.community_post_id := NEW.target_id;
    NEW.community_id := cp_community;
    NEW.post_id := NULL;
    NEW.reported_profile_id := NULL;

  -- 3. Validate profile target
  ELSIF NEW.target_type = 'profile' THEN
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.target_id) INTO prof_exists;

    IF NOT prof_exists THEN
      RAISE EXCEPTION 'Target profile does not exist';
    END IF;

    IF NEW.target_id = NEW.reporter_id THEN
      RAISE EXCEPTION 'Cannot report your own profile';
    END IF;

    NEW.reported_profile_id := NEW.target_id;
    NEW.post_id := NULL;
    NEW.community_post_id := NULL;
    NEW.community_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_content_report_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_content_report_validate ON public.content_reports;
CREATE TRIGGER on_content_report_validate
  BEFORE INSERT ON public.content_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_content_report_insert();

-- ================================================================
-- 5. Grants
-- ================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_reports TO authenticated;

-- ================================================================
-- 6. Row Level Security: content_reports
-- ================================================================
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- SELECT policy:
-- 1. Reporters can view their own reports
-- 2. Platform staff can view all reports
-- 3. Community staff can view reports scoped to their community
DROP POLICY IF EXISTS "content_reports_select_policy" ON public.content_reports;
CREATE POLICY "content_reports_select_policy"
  ON public.content_reports
  FOR SELECT
  TO authenticated
  USING (
    reporter_id = (select auth.uid())
    OR
    public.is_platform_staff((select auth.uid()))
    OR
    (
      community_id IS NOT NULL
      AND public.is_community_staff(community_id, (select auth.uid()))
    )
  );

-- INSERT policy:
-- Authenticated users can insert their own reports with status='open'
-- Privileged fields (status, reviewer_id, reviewed_at, resolution_note) are strictly forbidden
DROP POLICY IF EXISTS "content_reports_insert_policy" ON public.content_reports;
CREATE POLICY "content_reports_insert_policy"
  ON public.content_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id = (select auth.uid())
    AND status = 'open'
    AND reviewer_id IS NULL
    AND reviewed_at IS NULL
    AND resolution_note IS NULL
  );

-- UPDATE policy:
-- Only platform staff (globally) or community staff (for community-scoped reports)
-- Reporters CANNOT update reports
DROP POLICY IF EXISTS "content_reports_update_policy" ON public.content_reports;
CREATE POLICY "content_reports_update_policy"
  ON public.content_reports
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_staff((select auth.uid()))
    OR
    (
      community_id IS NOT NULL
      AND public.is_community_staff(community_id, (select auth.uid()))
    )
  )
  WITH CHECK (
    public.is_platform_staff((select auth.uid()))
    OR
    (
      community_id IS NOT NULL
      AND public.is_community_staff(community_id, (select auth.uid()))
    )
  );

-- DELETE policy:
-- Strictly platform staff only
DROP POLICY IF EXISTS "content_reports_delete_policy" ON public.content_reports;
CREATE POLICY "content_reports_delete_policy"
  ON public.content_reports
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_staff((select auth.uid()))
  );
