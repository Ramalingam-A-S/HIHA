import { redirect } from "next/navigation";
import { getCurrentUser, getCurrentUserProfile } from "@/lib/supabase/server";
import { getAllInterestsAction } from "@/app/actions/interests";
import { CreatePostForm } from "@/components/posts/CreatePostForm";
import type { Interest } from "@/lib/supabase/types";

export const metadata = {
  title: "Create Content | HIHA",
  description: "Share thoughts, perspectives, and media with intentional audience controls.",
};

export default async function CreatePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/create");
  }

  const [interestsRes, profile] = await Promise.all([
    getAllInterestsAction(),
    getCurrentUserProfile(),
  ]);
  const availableInterests = (interestsRes.data as Interest[]) ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
      {/* Editorial Header */}
      <div className="border-b border-[var(--border)] pb-4 space-y-1">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono rounded-full bg-[var(--surface-muted)] text-[var(--accent)] border border-[var(--border-subtle)]">
          <span>Content Creation</span>
          <span>•</span>
          <span>Intentional Publishing</span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--foreground)]">
          Create & Reflect
        </h1>
        <p className="text-xs text-[var(--foreground-secondary)] leading-relaxed">
          Craft thoughtful content with transparent topic tagging and audience controls.
          Posts are indexed deterministically according to user interests rather than engagement traps.
        </p>
      </div>

      <CreatePostForm
        availableInterests={availableInterests}
        defaultVisibility={profile?.default_post_visibility ?? "public"}
        ageSafetyMode={profile?.age_safety_mode ?? "standard"}
      />
    </div>
  );
}
