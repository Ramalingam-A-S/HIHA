-- ================================================================
-- HIHA Milestone 4.5 Checkpoint 1: PostgREST Profile Foreign Key Alignment
-- Migration: 20261013050000_align_postgrest_profile_foreign_keys.sql
--
-- Aligns foreign keys from auth.users(id) to public.profiles(id) to enable
-- PostgREST embedded joins across schema boundaries without compromising data integrity.
-- Verified 0 orphan records exist prior to execution.
-- ================================================================

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 1. posts.creator_id
ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_creator_id_fkey,
  ADD CONSTRAINT posts_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 2. communities.owner_id
ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_owner_id_fkey,
  ADD CONSTRAINT communities_owner_id_fkey
    FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- 3. notifications.actor_id
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_actor_id_fkey,
  ADD CONSTRAINT notifications_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 4. content_reports.reporter_id
ALTER TABLE public.content_reports
  DROP CONSTRAINT IF EXISTS content_reports_reporter_id_fkey,
  ADD CONSTRAINT content_reports_reporter_id_fkey
    FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
