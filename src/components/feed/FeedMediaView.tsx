"use client";

import React, { useEffect, useState } from "react";
import { getPostMediaUrlAction } from "@/app/actions/posts";
import type { SupportedMediaType } from "@/lib/storage/types";

interface FeedMediaViewProps {
  postId: string;
  contentType: "text" | SupportedMediaType;
}

export function FeedMediaView({ postId, contentType }: FeedMediaViewProps) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    if (contentType === "text") return;

    async function loadMedia() {
      try {
        setLoading(true);
        const res = await getPostMediaUrlAction(postId);
        if (!isMounted) return;

        if (res.success && res.data?.signedUrl) {
          setMediaUrl(res.data.signedUrl);
        } else {
          setError(true);
        }
      } catch {
        if (isMounted) setError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadMedia();
    return () => {
      isMounted = false;
    };
  }, [postId, contentType]);

  if (contentType === "text") {
    return null;
  }

  if (loading) {
    return (
      <div className="w-full h-48 sm:h-64 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] animate-pulse flex items-center justify-center text-xs text-[var(--foreground-muted)]">
        Loading media...
      </div>
    );
  }

  if (error || !mediaUrl) {
    return (
      <div className="w-full p-4 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] border border-[var(--border)] text-xs text-[var(--foreground-muted)] text-center">
        Media preview unavailable
      </div>
    );
  }

  if (contentType === "image") {
    return (
      <div className="relative w-full rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border)] bg-black/5 dark:bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl}
          alt="Post media"
          className="w-full max-h-[500px] object-contain mx-auto"
          loading="lazy"
        />
      </div>
    );
  }

  // Short and long video
  return (
    <div className="relative w-full rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border)] bg-black">
      <video
        src={mediaUrl}
        controls
        preload="metadata"
        className="w-full max-h-[500px] object-contain mx-auto"
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
}
