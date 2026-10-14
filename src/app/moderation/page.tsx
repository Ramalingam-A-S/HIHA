import React from "react";
import type { Metadata } from "next";
import { checkModerationAccessAction } from "@/app/actions/reports";
import { ModerationQueueView } from "@/components/moderation/ModerationQueueView";

export const metadata: Metadata = {
  title: "Moderation Queue | HIHA",
  description: "Trust & Safety content review queue for platform staff and community moderators.",
};

export default async function ModerationPage() {
  const res = await checkModerationAccessAction();
  const isPlatformStaff = res.data?.isPlatformStaff ?? false;
  const isCommunityModerator = res.data?.isCommunityModerator ?? false;

  return (
    <div className="py-4 sm:py-8 max-w-4xl mx-auto">
      <ModerationQueueView
        isPlatformStaff={isPlatformStaff}
        isCommunityModerator={isCommunityModerator}
      />
    </div>
  );
}
