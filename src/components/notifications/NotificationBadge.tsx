"use client";

import React, { useEffect, useState } from "react";
import { getUnreadCountAction } from "@/app/actions/notifications";

export function NotificationBadge() {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    getUnreadCountAction().then((res) => {
      if (mounted && res.success && res.data) {
        setCount(res.data.count);
      }
    }).catch(() => {
      // Graceful fallback: show no badge if unauthenticated or error
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (count <= 0) return null;

  return (
    <span
      className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-[var(--accent)] rounded-full"
      aria-label={`${count} unread notifications`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
