"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  notificationPageSchema,
  type NotificationPageInput,
  type NotificationWithActor,
  type NotificationsResponse,
} from "@/lib/notifications/types";
import type { ActionResult } from "./auth";
import type { Profile } from "@/lib/supabase/types";

/**
 * Lists paginated notifications for the authenticated user, newest first.
 * Only returns the caller's own notifications (enforced by RLS).
 */
export async function getNotificationsAction(
  input: NotificationPageInput
): Promise<ActionResult<NotificationsResponse>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const validation = notificationPageSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, message: "Invalid pagination parameters." };
  }

  const { page, pageSize } = validation.data;
  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const fromIndex = (page - 1) * pageSize;
  const toIndex = fromIndex + pageSize - 1;

  const [notifRes, countRes] = await Promise.all([
    supabase
      .from("notifications")
      .select(`
        id, recipient_id, actor_id, type, follow_id, read_at, created_at,
        actor:profiles!notifications_actor_id_fkey (
          id, username, display_name, avatar_url, is_private
        )
      `)
      .eq("recipient_id", user.id)
      .order("created_at", { ascending: false })
      .range(fromIndex, toIndex),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", user.id)
      .is("read_at", null),
  ]);

  if (notifRes.error) {
    return { success: false, message: "Failed to load notifications." };
  }

  const items: NotificationWithActor[] = (notifRes.data ?? []).map((n) => ({
    id: n.id,
    recipient_id: n.recipient_id,
    actor_id: n.actor_id,
    type: n.type as NotificationWithActor["type"],
    follow_id: n.follow_id,
    read_at: n.read_at,
    created_at: n.created_at,
    actor: (n.actor as unknown as Profile) ?? null,
  }));

  return {
    success: true,
    data: {
      items,
      page,
      pageSize,
      hasMore: items.length === pageSize,
      unreadCount: countRes.count ?? 0,
    },
  };
}

/**
 * Returns the count of unread notifications for the authenticated user.
 * Used by the navigation bell indicator.
 */
export async function getUnreadCountAction(): Promise<ActionResult<{ count: number }>> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    return { success: false, message: "Failed to fetch unread count." };
  }

  return { success: true, data: { count: count ?? 0 } };
}

/**
 * Marks a single notification as read. Verifies the caller owns the notification via RLS.
 */
export async function markNotificationReadAction(
  notificationId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  if (!notificationId || typeof notificationId !== "string") {
    return { success: false, message: "Invalid notification ID." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    return { success: false, message: "Failed to mark notification as read." };
  }

  revalidatePath("/notifications");
  return { success: true, message: "Notification marked as read." };
}

/**
 * Marks all of the authenticated user's unread notifications as read.
 */
export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, message: "Authentication required." };
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return { success: false, message: "Database connection unavailable." };
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);

  if (error) {
    return { success: false, message: "Failed to mark all notifications as read." };
  }

  revalidatePath("/notifications");
  return { success: true, message: "All notifications marked as read." };
}
