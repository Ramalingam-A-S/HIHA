-- Migration: 20261009190000_create_communities.sql
-- Description: communities and community_members tables, triggers, helper functions, and RLS policies.
-- Depends on: 20261009120000_create_profiles.sql, 20261009130000_create_interests.sql, 20261009140000_create_social_graph.sql

-- ================================================================
-- 1. communities table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT DEFAULT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  interest_id UUID REFERENCES public.interests(id) ON DELETE SET NULL,
  category TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT communities_visibility_check CHECK (visibility IN ('public', 'private')),
  CONSTRAINT communities_name_length CHECK (length(trim(name)) >= 2 AND length(name) <= 100),
  CONSTRAINT communities_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) >= 2 AND length(slug) <= 50),
  CONSTRAINT communities_description_length CHECK (description IS NULL OR length(description) <= 1000),
  CONSTRAINT communities_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_communities_slug ON public.communities (slug);
CREATE INDEX IF NOT EXISTS idx_communities_visibility ON public.communities (visibility);
CREATE INDEX IF NOT EXISTS idx_communities_owner_id ON public.communities (owner_id);
CREATE INDEX IF NOT EXISTS idx_communities_interest_id ON public.communities (interest_id) WHERE interest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communities_category ON public.communities (category) WHERE category IS NOT NULL;

-- ================================================================
-- 2. community_members table
-- ================================================================
CREATE TABLE IF NOT EXISTS public.community_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT community_members_role_check CHECK (role IN ('owner', 'moderator', 'member')),
  CONSTRAINT community_members_status_check CHECK (status IN ('active', 'pending', 'rejected', 'banned')),
  CONSTRAINT community_members_unique UNIQUE (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_members_community_id ON public.community_members (community_id);
CREATE INDEX IF NOT EXISTS idx_community_members_user_id ON public.community_members (user_id);
CREATE INDEX IF NOT EXISTS idx_community_members_role_status ON public.community_members (community_id, role, status);

-- ================================================================
-- 3. Automatic owner membership trigger
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_community_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.community_members (community_id, user_id, role, status)
  VALUES (NEW.id, NEW.owner_id, 'owner', 'active')
  ON CONFLICT (community_id, user_id) DO UPDATE
    SET role = 'owner', status = 'active';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_community_created ON public.communities;
CREATE TRIGGER on_community_created
  AFTER INSERT ON public.communities
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_community_created();

DROP TRIGGER IF EXISTS on_communities_updated_at ON public.communities;
CREATE TRIGGER on_communities_updated_at
  BEFORE UPDATE ON public.communities
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS on_community_members_updated_at ON public.community_members;
CREATE TRIGGER on_community_members_updated_at
  BEFORE UPDATE ON public.community_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ================================================================
-- 4. Helper functions (SECURITY DEFINER with safe search_path to avoid RLS recursion)
-- ================================================================
CREATE OR REPLACE FUNCTION public.is_community_active_member(c_id UUID, u_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = c_id AND user_id = u_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_community_member_role(c_id UUID, u_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT role FROM public.community_members
  WHERE community_id = c_id AND user_id = u_id AND status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_community_active_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_community_active_member(UUID, UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.get_community_member_role(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_community_member_role(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_community_membership(c_id UUID)
RETURNS public.community_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_id UUID;
  comm_vis TEXT;
  comm_owner UUID;
  new_member public.community_members;
BEGIN
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT visibility, owner_id INTO comm_vis, comm_owner
  FROM public.communities
  WHERE id = c_id;

  IF comm_vis IS NULL THEN
    RAISE EXCEPTION 'Community not found';
  END IF;

  IF public.is_blocked(comm_owner, caller_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.community_members (community_id, user_id, role, status)
  VALUES (c_id, caller_id, 'member', CASE WHEN comm_vis = 'public' THEN 'active' ELSE 'pending' END)
  RETURNING * INTO new_member;

  RETURN new_member;
END;
$$;

REVOKE ALL ON FUNCTION public.request_community_membership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_community_membership(UUID) TO authenticated;

-- ================================================================
-- 5. Grants and Row Level Security
-- ================================================================
GRANT SELECT ON public.communities TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.communities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_members TO authenticated;

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;

-- 5a. communities policies
DROP POLICY IF EXISTS "communities_select_policy" ON public.communities;
CREATE POLICY "communities_select_policy"
  ON public.communities
  FOR SELECT
  USING (
    (
      visibility = 'public'
      OR owner_id = (select auth.uid())
      OR public.is_community_active_member(id, (select auth.uid()))
    )
    AND (
      (select auth.uid()) IS NULL
      OR (select auth.uid()) = owner_id
      OR NOT public.is_blocked(owner_id, (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "communities_insert_policy" ON public.communities;
CREATE POLICY "communities_insert_policy"
  ON public.communities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "communities_update_policy" ON public.communities;
CREATE POLICY "communities_update_policy"
  ON public.communities
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = (select auth.uid())
    OR public.get_community_member_role(id, (select auth.uid())) IN ('owner', 'moderator')
  );

DROP POLICY IF EXISTS "communities_delete_policy" ON public.communities;
CREATE POLICY "communities_delete_policy"
  ON public.communities
  FOR DELETE
  TO authenticated
  USING (
    owner_id = (select auth.uid())
  );

-- 5b. community_members policies
DROP POLICY IF EXISTS "community_members_select_policy" ON public.community_members;
CREATE POLICY "community_members_select_policy"
  ON public.community_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_members.community_id
        AND c.visibility = 'public'
    )
    OR public.is_community_active_member(community_id, (select auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_members.community_id
        AND c.owner_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "community_members_insert_policy" ON public.community_members;
CREATE POLICY "community_members_insert_policy"
  ON public.community_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND role = 'member'
    AND (
      (
        status = 'active'
        AND EXISTS (
          SELECT 1 FROM public.communities c
          WHERE c.id = community_id AND c.visibility = 'public'
        )
      )
      OR
      (
        status = 'pending'
        AND EXISTS (
          SELECT 1 FROM public.communities c
          WHERE c.id = community_id AND c.visibility = 'private'
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.communities c
      JOIN public.blocks b ON (b.blocker_id = c.owner_id AND b.blocked_id = (select auth.uid()))
                           OR (b.blocker_id = (select auth.uid()) AND b.blocked_id = c.owner_id)
      WHERE c.id = community_id
    )
  );

DROP POLICY IF EXISTS "community_members_update_policy" ON public.community_members;
CREATE POLICY "community_members_update_policy"
  ON public.community_members
  FOR UPDATE
  TO authenticated
  USING (
    public.get_community_member_role(community_id, (select auth.uid())) IN ('owner', 'moderator')
  )
  WITH CHECK (
    (
      public.get_community_member_role(community_id, (select auth.uid())) = 'moderator'
      AND role = 'member'
    )
    OR
    (
      public.get_community_member_role(community_id, (select auth.uid())) = 'owner'
    )
  );

DROP POLICY IF EXISTS "community_members_delete_policy" ON public.community_members;
CREATE POLICY "community_members_delete_policy"
  ON public.community_members
  FOR DELETE
  TO authenticated
  USING (
    (
      user_id = (select auth.uid())
      AND role <> 'owner'
    )
    OR
    (
      public.get_community_member_role(community_id, (select auth.uid())) = 'moderator'
      AND role = 'member'
    )
    OR
    (
      public.get_community_member_role(community_id, (select auth.uid())) = 'owner'
      AND role <> 'owner'
    )
  );
