-- Migration: 20261009180000_create_post_likes.sql
-- Description: post_likes table with RLS, foreign keys, indexes, and unique constraints.
-- Depends on: 20261009150000_create_posts_and_media.sql

-- ================================================================
-- 1. post_likes table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT post_likes_unique UNIQUE (post_id, user_id)
);

-- ================================================================
-- 2. Indexes
-- ================================================================
-- Fast aggregation and count queries per post
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes (post_id);

-- Fast lookup for viewer's liked posts
CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON public.post_likes (user_id);

-- ================================================================
-- 3. Table grants
-- ================================================================
GRANT SELECT ON public.post_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_likes TO authenticated;

-- ================================================================
-- 4. Row Level Security
-- ================================================================
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;

-- SELECT: users can view likes on posts they are authorized to view under posts RLS
DROP POLICY IF EXISTS "Post likes viewable if post is viewable" ON public.post_likes;
CREATE POLICY "Post likes viewable if post is viewable"
  ON public.post_likes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_likes.post_id
    )
  );

-- INSERT: authenticated user can only insert their own like, and only on viewable posts
DROP POLICY IF EXISTS "Users can like viewable posts" ON public.post_likes;
CREATE POLICY "Users can like viewable posts"
  ON public.post_likes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_likes.post_id
    )
  );

-- DELETE: authenticated user can only delete their own likes
DROP POLICY IF EXISTS "Users can unlike their own likes" ON public.post_likes;
CREATE POLICY "Users can unlike their own likes"
  ON public.post_likes
  FOR DELETE
  TO authenticated
  USING (
    user_id = (select auth.uid())
  );
