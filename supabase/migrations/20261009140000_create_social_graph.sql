-- Migration: 20261009140000_create_social_graph.sql
-- Description: follows, blocks, and mutes tables with RLS, constraints, and follower-aware profile visibility.
-- Depends on: 20261009120000_create_profiles.sql

-- ================================================================
-- 1. follows
-- ================================================================
CREATE TABLE IF NOT EXISTS public.follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT follows_status_values CHECK (status IN ('pending', 'accepted')),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id),
  CONSTRAINT follows_unique UNIQUE (follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON public.follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON public.follows (following_id);
CREATE INDEX IF NOT EXISTS idx_follows_status ON public.follows (following_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows TO authenticated;

-- Trigger: update updated_at on follow status changes
DROP TRIGGER IF EXISTS on_follows_updated_at ON public.follows;
CREATE TRIGGER on_follows_updated_at
  BEFORE UPDATE ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ================================================================
-- 2. blocks
-- ================================================================
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT blocks_no_self_block CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocks_unique UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker_id ON public.blocks (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON public.blocks (blocked_id);
CREATE INDEX IF NOT EXISTS idx_blocks_pair ON public.blocks (least(blocker_id, blocked_id), greatest(blocker_id, blocked_id));

GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;

-- ================================================================
-- 3. mutes
-- ================================================================
CREATE TABLE IF NOT EXISTS public.mutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  muter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  muted_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mutes_no_self_mute CHECK (muter_id <> muted_id),
  CONSTRAINT mutes_unique UNIQUE (muter_id, muted_id)
);

CREATE INDEX IF NOT EXISTS idx_mutes_muter_id ON public.mutes (muter_id);
CREATE INDEX IF NOT EXISTS idx_mutes_muted_id ON public.mutes (muted_id);

GRANT SELECT, INSERT, DELETE ON public.mutes TO authenticated;

-- ================================================================
-- 4. Helper function: is_blocked
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_blocked(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = user_a AND blocked_id = user_b)
       OR (blocker_id = user_b AND blocked_id = user_a)
  );
$$;

REVOKE ALL ON FUNCTION public.is_blocked(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_blocked(UUID, UUID) TO authenticated;

-- ================================================================
-- 5. Row Level Security: follows
-- ================================================================
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own follow relationships" ON public.follows;
CREATE POLICY "Users can view their own follow relationships"
  ON public.follows
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = follower_id
    OR
    (select auth.uid()) = following_id
  );

DROP POLICY IF EXISTS "Users can create follow requests" ON public.follows;
CREATE POLICY "Users can create follow requests"
  ON public.follows
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = follower_id
    AND follower_id <> following_id
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = following_id AND b.blocked_id = (select auth.uid()))
         OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = following_id)
    )
  );

DROP POLICY IF EXISTS "Users can remove follow relationships involving them" ON public.follows;
CREATE POLICY "Users can remove follow relationships involving them"
  ON public.follows
  FOR DELETE
  TO authenticated
  USING (
    (select auth.uid()) = follower_id
    OR
    (select auth.uid()) = following_id
  );

DROP POLICY IF EXISTS "Following user can update follow status" ON public.follows;
CREATE POLICY "Following user can update follow status"
  ON public.follows
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = following_id)
  WITH CHECK ((select auth.uid()) = following_id);

-- ================================================================
-- 6. Row Level Security: blocks
-- ================================================================
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view blocks they created or received" ON public.blocks;
CREATE POLICY "Users can view blocks they created or received"
  ON public.blocks
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = blocker_id
    OR
    (select auth.uid()) = blocked_id
  );

DROP POLICY IF EXISTS "Users can block others" ON public.blocks;
CREATE POLICY "Users can block others"
  ON public.blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = blocker_id
    AND blocker_id <> blocked_id
  );

DROP POLICY IF EXISTS "Users can remove their own blocks" ON public.blocks;
CREATE POLICY "Users can remove their own blocks"
  ON public.blocks
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = blocker_id);

-- ================================================================
-- 7. Row Level Security: mutes
-- ================================================================
ALTER TABLE public.mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own mutes" ON public.mutes;
CREATE POLICY "Users can view their own mutes"
  ON public.mutes
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = muter_id);

DROP POLICY IF EXISTS "Users can mute others" ON public.mutes;
CREATE POLICY "Users can mute others"
  ON public.mutes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = muter_id
    AND muter_id <> muted_id
  );

DROP POLICY IF EXISTS "Users can remove their own mutes" ON public.mutes;
CREATE POLICY "Users can remove their own mutes"
  ON public.mutes
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = muter_id);

-- ================================================================
-- 8. Updated profiles SELECT policies
-- ================================================================
ALTER POLICY "Profiles are viewable by owner or if public"
  ON public.profiles
  USING (
    (select auth.uid()) = id
    OR
    (
      is_private = false
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE b.blocker_id = profiles.id AND b.blocked_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Accepted followers can view private profiles" ON public.profiles;
CREATE POLICY "Accepted followers can view private profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = (select auth.uid())
        AND f.following_id = profiles.id
        AND f.status = 'accepted'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE b.blocker_id = profiles.id AND b.blocked_id = (select auth.uid())
    )
  );
