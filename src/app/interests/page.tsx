import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getAllInterestsAction,
  getUserInterestsAction,
} from "@/app/actions/interests";
import { InterestSelector } from "@/components/interests/InterestSelector";

export const metadata = {
  title: "Your Interests & Discovery Preferences | HIHA",
  description:
    "Curate your interest taxonomy and priority weights to transparently control your personalized feed recommendations.",
};

export default async function InterestsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/interests");
  }

  const [catalogResult, userInterestsResult] = await Promise.all([
    getAllInterestsAction(),
    getUserInterestsAction(),
  ]);

  const catalog = catalogResult.data ?? [];
  const initialPreferences = userInterestsResult.data ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-8 py-4">
      {/* Editorial Header */}
      <div className="border-b border-[var(--border)] pb-6 space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono rounded-full bg-[var(--surface-muted)] text-[var(--accent)] border border-[var(--border-subtle)]">
          <span>User-Controlled Discovery</span>
          <span>•</span>
          <span>Transparent Algorithm</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
          Interest Taxonomy & Feed Weights
        </h1>
        <p className="text-sm text-[var(--foreground-secondary)] max-w-2xl leading-relaxed">
          Select the subjects you care about and calibrate their priority weights (1–5).
          Unlike traditional black-box platforms, your explicit selections directly govern
          content ranking in <strong className="text-[var(--foreground)]">My Mix</strong> and{" "}
          <strong className="text-[var(--foreground)]">Focus</strong> modes with zero opaque tracking.
        </p>
      </div>

      <InterestSelector
        initialCatalog={catalog}
        initialPreferences={initialPreferences}
      />
    </div>
  );
}
