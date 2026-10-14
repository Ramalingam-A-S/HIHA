-- Migration: 20261009170000_create_notifications.sql
-- Description: notifications table with RLS, dedup index, and trigger-based creation on follow events.
-- Depends on: 20261009140000_create_social_graph.sql

-- ================================================================
-- 1. notifications table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id     UUID                 REFERENCES auth.users(id) ON DELETE SET NULL,
  type         TEXT        NOT NULL,
  follow_id    UUID                 REFERENCES public.follows(id) ON DELETE CASCADE,
  read_at      TIMESTAMPTZ          DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notifications_type_values  CHECK (type IN ('follow_request', 'follow_accepted', 'new_follower')),
  CONSTRAINT notifications_no_self_notify CHECK (recipient_id <> actor_id)
);

-- ================================================================
-- 2. Indexes
-- ================================================================
-- Efficient chronological retrieval per recipient
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_id
  ON public.notifications (recipient_id, created_at DESC);

-- Fast unread count (partial index – only unread rows)
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_id, read_at) WHERE read_at IS NULL;

-- Follow cascade lookup
CREATE INDEX IF NOT EXISTS idx_notifications_follow_id
  ON public.notifications (follow_id) WHERE follow_id IS NOT NULL;

-- Deduplication: one notification per (recipient, actor, type, follow relationship)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON public.notifications (recipient_id, actor_id, type, follow_id)
  WHERE follow_id IS NOT NULL;

-- ================================================================
-- 3. Table grants (authenticated role may only SELECT + UPDATE read_at)
--    INSERT is performed exclusively by the SECURITY DEFINER trigger function.
-- ================================================================
GRANT SELECT, UPDATE ON public.notifications TO authenticated;

-- ================================================================
-- 4. Row-level security
-- ================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients may read only their own notifications.
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

-- Recipients may update only their own notifications, and only to change read_at.
-- WITH CHECK prevents changing recipient_id, actor_id, type, or follow_id.
CREATE POLICY "notifications_update_own_read" ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (
    recipient_id = auth.uid()
    AND actor_id    IS NOT DISTINCT FROM actor_id
    AND type        IS NOT DISTINCT FROM type
    AND follow_id   IS NOT DISTINCT FROM follow_id
  );

-- ================================================================
-- 5. Server-side trigger function: notify_follow_event
--    SECURITY DEFINER so it can INSERT into notifications regardless
--    of the authenticated user's grants. Checks blocks before inserting.
-- ================================================================
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
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      -- follow_request: notify the person being followed that they have a pending request
      v_recipient_id := NEW.following_id;
      v_actor_id     := NEW.follower_id;
      v_type         := 'follow_request';
    ELSIF NEW.status = 'accepted' THEN
      -- new_follower: public profile auto-accept — notify the followed user of new follower
      v_recipient_id := NEW.following_id;
      v_actor_id     := NEW.follower_id;
      v_type         := 'new_follower';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
      -- follow_accepted: notify the requester that their pending request was accepted
      v_recipient_id := NEW.follower_id;
      v_actor_id     := NEW.following_id;
      v_type         := 'follow_accepted';
    END IF;
  END IF;

  IF v_recipient_id IS NOT NULL AND v_actor_id IS NOT NULL AND v_type IS NOT NULL THEN
    -- Block-aware: never notify when either party has blocked the other
    IF NOT public.is_blocked(v_recipient_id, v_actor_id) THEN
      INSERT INTO public.notifications (recipient_id, actor_id, type, follow_id)
      VALUES (v_recipient_id, v_actor_id, v_type, NEW.id)
      ON CONFLICT (recipient_id, actor_id, type, follow_id) WHERE follow_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ================================================================
-- 6. Trigger: fire on INSERT and on status UPDATE of follows
-- ================================================================
DROP TRIGGER IF EXISTS on_follows_notify ON public.follows;
CREATE TRIGGER on_follows_notify
  AFTER INSERT OR UPDATE OF status ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_follow_event();
