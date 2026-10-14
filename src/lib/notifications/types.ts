import { z } from "zod";
import type { Profile } from "@/lib/supabase/types";

export const NOTIFICATION_TYPES = [
  "follow_request",
  "follow_accepted",
  "new_follower",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: NotificationType;
  follow_id: string | null;
  read_at: string | null;
  created_at: string;
  actor?: Profile | null;
}

export interface NotificationWithActor extends Notification {
  actor: Profile | null;
}

export interface NotificationsResponse {
  items: NotificationWithActor[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  unreadCount: number;
}

export const notificationPageSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export type NotificationPageInput = z.infer<typeof notificationPageSchema>;

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  follow_request: "sent you a follow request",
  follow_accepted: "accepted your follow request",
  new_follower: "started following you",
};
