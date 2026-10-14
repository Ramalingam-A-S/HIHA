-- Migration: 20261009120000_create_profiles.sql
-- Description: Create profiles table, constraints, trigger-based provisioning, and Row Level Security policies.

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Format & length constraints
  CONSTRAINT username_format_check CHECK (
    username ~ '^[a-zA-Z0-9_]{3,30}$'
  ),
  CONSTRAINT username_lowercase_check CHECK (
    username = lower(username)
  ),
  CONSTRAINT display_name_length_check CHECK (
    char_length(trim(display_name)) >= 1 AND char_length(display_name) <= 60
  ),
  CONSTRAINT bio_length_check CHECK (
    bio IS NULL OR char_length(bio) <= 500
  )
);

-- Case-insensitive unique index and lookup indexes
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique_idx ON public.profiles (lower(username));
CREATE INDEX IF NOT EXISTS profiles_is_private_idx ON public.profiles (is_private);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON public.profiles (created_at DESC);

-- Grants for Data API
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;

-- 2. Updated_at and immutable id trigger
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Prevent altering profile ownership id
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Profile ID cannot be modified';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_profiles_updated_at ON public.profiles;
CREATE TRIGGER on_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 3. Automatic profile creation trigger on auth.users registration
-- Safely extracts and sanitizes metadata or derives fallback username/display_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_raw_username TEXT;
  v_username TEXT;
  v_display_name TEXT;
  v_is_valid_username BOOLEAN;
BEGIN
  -- Check if profile already exists to prevent duplicate execution
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  -- Treat raw user_metadata as untrusted input
  v_raw_username := lower(trim(COALESCE(NEW.raw_user_meta_data->>'username', '')));
  v_display_name := trim(COALESCE(NEW.raw_user_meta_data->>'display_name', ''));

  -- Validate metadata username against format rules (3-30 alphanumeric + underscore)
  v_is_valid_username := (v_raw_username ~ '^[a-zA-Z0-9_]{3,30}$');

  -- Fallback to sanitized user prefix if invalid or missing
  IF NOT v_is_valid_username THEN
    v_raw_username := 'user_' || substr(NEW.id::text, 1, 8);
  END IF;

  -- Ensure username uniqueness by appending short uuid slice if collision occurs
  v_username := v_raw_username;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
    v_username := substr(v_raw_username, 1, 21) || '_' || substr(NEW.id::text, 1, 8);
  END IF;

  -- Validate and fallback display name
  IF char_length(v_display_name) < 1 OR char_length(v_display_name) > 60 THEN
    v_display_name := COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), v_username);
    IF char_length(v_display_name) > 60 THEN
      v_display_name := substr(v_display_name, 1, 60);
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id,
    username,
    display_name,
    bio,
    avatar_url,
    is_private,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    v_username,
    v_display_name,
    NULL,
    NULL,
    false,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Gracefully log warning rather than blocking user signup
    RAISE WARNING 'Profile auto-creation error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Select Policy:
-- Public profiles (is_private = false) are visible to all users (authenticated and anonymous).
-- Private profiles (is_private = true) are visible ONLY to the profile owner ((select auth.uid()) = id).
DROP POLICY IF EXISTS "Profiles are viewable by owner or if public" ON public.profiles;
CREATE POLICY "Profiles are viewable by owner or if public"
  ON public.profiles
  FOR SELECT
  USING (
    is_private = false
    OR
    (select auth.uid()) = id
  );

-- Insert Policy:
-- Authenticated user can only insert their own profile ID
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = id
  );

-- Update Policy:
-- Users can only update their own profile
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    (select auth.uid()) = id
  )
  WITH CHECK (
    (select auth.uid()) = id
  );

-- Delete Policy:
-- Users can only delete their own profile
DROP POLICY IF EXISTS "Users can delete their own profile" ON public.profiles;
CREATE POLICY "Users can delete their own profile"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    (select auth.uid()) = id
  );
