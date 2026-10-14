-- Migration: 20261009200000_create_community_posts.sql
-- Description: Community posts (cross-post into communities), pinned posts, and scoped moderation.
-- Depends on: 20261009150000_create_posts_and_media.sql, 20261009190000_create_communities.sql

-- ================================================================
-- 1. community_posts table
--    Links an existing post into a community context.
--    A post may be shared into multiple communities (many-to-many).
--    Only community members can post; only published posts can be shared.
-- ================================================================
CREATE TABLE IF NOT EXISTS public.community_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  post_id      UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  poster_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pinned_at    TIMESTAMPTZ DEFAULT NULL,
  removed_at   TIMESTAMPTZ DEFAULT NULL,
  removed_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  removal_reason TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT community_posts_unique UNIQUE (community_id, post_id),
  CONSTRAINT community_posts_removal_reason_length CHECK (
    removal_reason IS NULL OR length(removal_reason) <= 500
  )
);

CREATE INDEX IF NOT EXISTS idx_community_posts_community_id
  ON public.community_posts (community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_post_id
  ON public.community_posts (post_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_poster_id
  ON public.community_posts (poster_id);
CREATE INDEX IF NOT EXISTS idx_community_posts_pinned
  ON public.community_posts (community_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_posts_active
  ON public.community_posts (community_id, created_at DESC)
  WHERE removed_at IS NULL;

-- ================================================================
-- 2. Helper function: is_community_staff
--    Returns TRUE when the user is an active owner or moderator.
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_community_staff(c_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = c_id
      AND user_id = u_id
      AND status  = 'active'
      AND role    IN ('owner', 'moderator')
  );
$$;

REVOKE ALL ON FUNCTION public.is_community_staff(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_staff(UUID, UUID) TO authenticated;

-- ================================================================
-- 3. Grants
-- ================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_posts TO authenticated;

-- ================================================================
-- 4. Row Level Security: community_posts
-- ================================================================
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

-- SELECT: anyone who can see the community (public or active member)
DROP POLICY IF EXISTS "community_posts_select_policy" ON public.community_posts;
CREATE POLICY "community_posts_select_policy"
  ON public.community_posts
  FOR SELECT
  USING (
    -- Community must be visible to the caller
    EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_posts.community_id
    )
    -- The underlying post must be readable by the caller
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = community_posts.post_id
    )
  );

-- INSERT: authenticated active members of the community
DROP POLICY IF EXISTS "community_posts_insert_policy" ON public.community_posts;
CREATE POLICY "community_posts_insert_policy"
  ON public.community_posts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    poster_id = (select auth.uid())
    AND public.is_community_active_member(community_id, (select auth.uid()))
    -- Only published posts may be shared into communities
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_id
        AND p.status = 'published'
        AND p.creator_id = (select auth.uid())
    )
  );

-- UPDATE: staff can pin/unpin and mark removals (pinned_at, removed_at, removed_by, removal_reason)
DROP POLICY IF EXISTS "community_posts_update_policy" ON public.community_posts;
CREATE POLICY "community_posts_update_policy"
  ON public.community_posts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_community_staff(community_id, (select auth.uid()))
  )
  WITH CHECK (
    public.is_community_staff(community_id, (select auth.uid()))
  );

-- DELETE: poster can retract their own post; staff can hard-delete any community post
DROP POLICY IF EXISTS "community_posts_delete_policy" ON public.community_posts;
CREATE POLICY "community_posts_delete_policy"
  ON public.community_posts
  FOR DELETE
  TO authenticated
  USING (
    poster_id = (select auth.uid())
    OR public.is_community_staff(community_id, (select auth.uid()))
  );
