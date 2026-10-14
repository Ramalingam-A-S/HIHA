import React from "react";
import { NotificationList } from "@/components/notifications/NotificationList";

export const metadata = {
  title: "Notifications | HIHA",
  description: "Stay updated with follow requests and relationship activity.",
};

export default function NotificationsPage() {
  return (
    <div className="py-2 sm:py-6">
      <NotificationList />
    </div>
  );
}
