import { describe, it, expect } from "vitest";
import {
  notificationPageSchema,
  NOTIFICATION_TYPES,
  NOTIFICATION_LABELS,
  type NotificationType,
} from "@/lib/notifications/types";

describe("Notifications Foundation Logic & Validation", () => {
  describe("Zod Pagination Validation", () => {
    it("accepts valid pagination input", () => {
      const res = notificationPageSchema.safeParse({ page: 2, pageSize: 15 });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(2);
        expect(res.data.pageSize).toBe(15);
      }
    });

    it("applies default values for omitted parameters", () => {
      const res = notificationPageSchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
      }
    });

    it("rejects non-positive page numbers", () => {
      expect(notificationPageSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(notificationPageSchema.safeParse({ page: -1 }).success).toBe(false);
    });

    it("rejects non-integer page numbers", () => {
      expect(notificationPageSchema.safeParse({ page: 1.5 }).success).toBe(false);
    });

    it("enforces maximum pageSize of 50 to bound database load", () => {
      expect(notificationPageSchema.safeParse({ pageSize: 51 }).success).toBe(false);
      expect(notificationPageSchema.safeParse({ pageSize: 50 }).success).toBe(true);
    });

    it("rejects pageSize less than 1", () => {
      expect(notificationPageSchema.safeParse({ pageSize: 0 }).success).toBe(false);
    });
  });

  describe("Notification Types & Labels", () => {
    it("supports the 3 constrained relationship notification types", () => {
      expect(NOTIFICATION_TYPES).toContain("follow_request");
      expect(NOTIFICATION_TYPES).toContain("follow_accepted");
      expect(NOTIFICATION_TYPES).toContain("new_follower");
      expect(NOTIFICATION_TYPES.length).toBe(3);
    });

    it("provides human-readable, non-revealing labels for all notification types", () => {
      for (const type of NOTIFICATION_TYPES) {
        const label = NOTIFICATION_LABELS[type as NotificationType];
        expect(label).toBeDefined();
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Notification Invariants & Safety Rules", () => {
    // Pure logic simulation of trigger invariants
    function shouldCreateNotification(params: {
      recipientId: string;
      actorId: string;
      type: string;
      isBlocked: boolean;
      existingNotifications: Array<{ recipientId: string; actorId: string; type: string; followId: string }>;
      followId: string;
    }): { created: boolean; reason?: string } {
      if (params.recipientId === params.actorId) {
        return { created: false, reason: "Self-notification prohibited" };
      }
      if (params.isBlocked) {
        return { created: false, reason: "Blocked relationship suppresses notification" };
      }
      const duplicate = params.existingNotifications.some(
        (n) =>
          n.recipientId === params.recipientId &&
          n.actorId === params.actorId &&
          n.type === params.type &&
          n.followId === params.followId
      );
      if (duplicate) {
        return { created: false, reason: "Duplicate notification deduplicated" };
      }
      return { created: true };
    }

    it("prevents self-notification", () => {
      const res = shouldCreateNotification({
        recipientId: "user-1",
        actorId: "user-1",
        type: "follow_request",
        isBlocked: false,
        existingNotifications: [],
        followId: "follow-1",
      });
      expect(res.created).toBe(false);
      expect(res.reason).toBe("Self-notification prohibited");
    });

    it("suppresses notification when a block exists between recipient and actor", () => {
      const res = shouldCreateNotification({
        recipientId: "user-1",
        actorId: "user-2",
        type: "follow_request",
        isBlocked: true,
        existingNotifications: [],
        followId: "follow-1",
      });
      expect(res.created).toBe(false);
      expect(res.reason).toBe("Blocked relationship suppresses notification");
    });

    it("deduplicates repeated follow actions on the same relationship", () => {
      const existing = [
        {
          recipientId: "user-1",
          actorId: "user-2",
          type: "follow_request",
          followId: "follow-1",
        },
      ];
      const res = shouldCreateNotification({
        recipientId: "user-1",
        actorId: "user-2",
        type: "follow_request",
        isBlocked: false,
        existingNotifications: existing,
        followId: "follow-1",
      });
      expect(res.created).toBe(false);
      expect(res.reason).toBe("Duplicate notification deduplicated");
    });

    it("creates notification for eligible unblocked, non-duplicate follow event", () => {
      const res = shouldCreateNotification({
        recipientId: "user-1",
        actorId: "user-2",
        type: "new_follower",
        isBlocked: false,
        existingNotifications: [],
        followId: "follow-2",
      });
      expect(res.created).toBe(true);
    });

    it("correctly models read/unread state transitions", () => {
      interface MockNotif {
        id: string;
        read_at: string | null;
      }

      const notifs: MockNotif[] = [
        { id: "1", read_at: null },
        { id: "2", read_at: null },
        { id: "3", read_at: "2026-10-09T12:00:00Z" },
      ];

      const unreadCount = notifs.filter((n) => n.read_at === null).length;
      expect(unreadCount).toBe(2);

      // Mark single as read
      const markTime = new Date().toISOString();
      const updated = notifs.map((n) => (n.id === "1" ? { ...n, read_at: markTime } : n));
      expect(updated.filter((n) => n.read_at === null).length).toBe(1);

      // Mark all as read
      const allRead = updated.map((n) => ({ ...n, read_at: n.read_at ?? markTime }));
      expect(allRead.filter((n) => n.read_at === null).length).toBe(0);
    });
  });
});
