-- Migration: 20261009150000_create_posts_and_media.sql
-- Description: Creates posts table, post_interests association table, constraints, indexes,
-- RLS visibility and mutation policies, and private media storage bucket setup.
-- Depends on: 20261009120000_create_profiles.sql, 20261009130000_create_interests.sql, 20261009140000_create_social_graph.sql

-- ================================================================
-- 1. posts table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  caption TEXT,
  media_path TEXT,
  media_metadata JSONB DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  visibility TEXT NOT NULL DEFAULT 'public',
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ DEFAULT NULL,

  -- Constraints
  CONSTRAINT posts_content_type_check CHECK (
    content_type IN ('text', 'image', 'short_video', 'long_video')
  ),
  CONSTRAINT posts_status_check CHECK (
    status IN ('draft', 'published')
  ),
  CONSTRAINT posts_visibility_check CHECK (
    visibility IN ('public', 'followers', 'private')
  ),
  CONSTRAINT posts_caption_length_check CHECK (
    caption IS NULL OR char_length(caption) <= 2200
  ),
  CONSTRAINT posts_media_path_format CHECK (
    media_path IS NULL OR media_path ~ '^[0-9a-fA-F-]{36}/[a-zA-Z0-9._-]+$'
  ),
  CONSTRAINT posts_category_check CHECK (
    category IS NULL OR category IN (
      'technology-science',
      'education-learning',
      'art-design',
      'sports-fitness',
      'entertainment-gaming',
      'personal-stories-lifestyle',
      'social-causes-community',
      'business-careers',
      'health-wellbeing'
    )
  ),
  -- Text posts require a non-empty caption
  CONSTRAINT posts_text_content_check CHECK (
    content_type <> 'text' OR (caption IS NOT NULL AND char_length(trim(caption)) >= 1)
  ),
  -- Published media posts require a media_path
  CONSTRAINT posts_media_content_check CHECK (
    content_type = 'text' OR status = 'draft' OR media_path IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_posts_creator_id ON public.posts (creator_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON public.posts (status, published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON public.posts (visibility);
CREATE INDEX IF NOT EXISTS idx_posts_category ON public.posts (category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts (created_at DESC);

-- Trigger: update updated_at on post updates
DROP TRIGGER IF EXISTS on_posts_updated_at ON public.posts;
CREATE TRIGGER on_posts_updated_at
  BEFORE UPDATE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ================================================================
-- 2. post_interests table (reusing interests taxonomy)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.post_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES public.interests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT post_interests_unique UNIQUE (post_id, interest_id)
);

CREATE INDEX IF NOT EXISTS idx_post_interests_post_id ON public.post_interests (post_id);
CREATE INDEX IF NOT EXISTS idx_post_interests_interest_id ON public.post_interests (interest_id);

-- Grants for Data API
GRANT SELECT ON public.posts TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT SELECT ON public.post_interests TO anon, authenticated;
GRANT INSERT, DELETE ON public.post_interests TO authenticated;

-- ================================================================
-- 3. Row Level Security: posts
-- ================================================================
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create their own posts" ON public.posts;
CREATE POLICY "Users can create their own posts"
  ON public.posts
  FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = creator_id);

DROP POLICY IF EXISTS "Users can update their own posts" ON public.posts;
CREATE POLICY "Users can update their own posts"
  ON public.posts
  FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = creator_id)
  WITH CHECK ((select auth.uid()) = creator_id);

DROP POLICY IF EXISTS "Users can delete their own posts" ON public.posts;
CREATE POLICY "Users can delete their own posts"
  ON public.posts
  FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = creator_id);

DROP POLICY IF EXISTS "Posts visibility policy" ON public.posts;
CREATE POLICY "Posts visibility policy"
  ON public.posts
  FOR SELECT
  USING (
    -- 1. Creator can always view their own posts (including drafts and private)
    (select auth.uid()) = creator_id
    OR (
      -- 2. Only published posts are accessible to non-creators
      status = 'published'
      AND (
        -- Viewer and creator must not have an active block between them
        (select auth.uid()) IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.blocks b
          WHERE (b.blocker_id = posts.creator_id AND b.blocked_id = (select auth.uid()))
             OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = posts.creator_id)
        )
      )
      AND (
        -- Public posts are readable by anyone not blocked
        visibility = 'public'
        OR (
          -- Followers-only posts require an accepted follow relationship
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

-- ================================================================
-- 4. Row Level Security: post_interests
-- ================================================================
ALTER TABLE public.post_interests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Post interests viewable if post is viewable" ON public.post_interests;
CREATE POLICY "Post interests viewable if post is viewable"
  ON public.post_interests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_interests.post_id
    )
  );

DROP POLICY IF EXISTS "Creators can attach interests to their posts" ON public.post_interests;
CREATE POLICY "Creators can attach interests to their posts"
  ON public.post_interests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_interests.post_id
        AND p.creator_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Creators can remove interests from their posts" ON public.post_interests;
CREATE POLICY "Creators can remove interests from their posts"
  ON public.post_interests
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = post_interests.post_id
        AND p.creator_id = (select auth.uid())
    )
  );

-- ================================================================
-- 5. Storage bucket setup for media
-- ================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  false,
  524288000, -- 500 MB max size
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS on storage.objects for the 'media' bucket
DROP POLICY IF EXISTS "Users can upload media to their own directory" ON storage.objects;
CREATE POLICY "Users can upload media to their own directory"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
CREATE POLICY "Users can delete their own media"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

DROP POLICY IF EXISTS "Users can read media objects" ON storage.objects;
CREATE POLICY "Users can read media objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = (select auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.posts p
        WHERE p.media_path = storage.objects.name
      )
    )
  );
