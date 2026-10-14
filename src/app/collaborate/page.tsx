import React from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getProjectsAction } from "@/app/actions/collaboration";
import { CollaborateWorkspaceView } from "@/components/collaboration/CollaborateWorkspaceView";

export const metadata = {
  title: "Collaborative Projects & Video Stitching | HIHA",
  description:
    "Co-create multi-contributor video projects with explicit usage consent, clip review, sequence ordering, and durable render jobs.",
};

export default async function CollaboratePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/collaborate");
  }

  const res = await getProjectsAction();
  const initialProjects = res.success && res.data ? res.data.projects : [];

  return (
    <CollaborateWorkspaceView
      initialProjects={initialProjects}
      currentUserId={user.id}
    />
  );
}
