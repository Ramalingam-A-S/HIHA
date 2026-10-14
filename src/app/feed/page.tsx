import React from "react";
import { FeedList } from "@/components/feed/FeedList";

export const metadata = {
  title: "Personalized Feed | HIHA",
  description: "User-controlled, deterministic content feed with transparent ranking.",
};

export default function FeedPage() {
  return (
    <div className="py-2 sm:py-6">
      <FeedList />
    </div>
  );
}
