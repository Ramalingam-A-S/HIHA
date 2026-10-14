import React from "react";
import { CommunityList } from "@/components/communities/CommunityList";

export const metadata = {
  title: "Communities | HIHA",
  description: "Explore topic-based communities and collaborative interest groups.",
};

export default function CommunitiesPage() {
  return (
    <div className="py-2 sm:py-6">
      <CommunityList />
    </div>
  );
}
