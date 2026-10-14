-- Migration: 20261009160000_update_storage_media_read_policy.sql
-- Description: Updates storage.objects SELECT policy for the private 'media' bucket.
-- Allows authenticated users to read media objects if they own the object (folder prefix)
-- OR if the object is attached to a post that the user is authorized to read under public.posts RLS.
-- Depends on: 20261009150000_create_posts_and_media.sql

ALTER POLICY "Users can read media objects"
  ON storage.objects
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
