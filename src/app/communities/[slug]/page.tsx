import React from "react";
import { notFound } from "next/navigation";
import { getCommunityBySlugAction } from "@/app/actions/communities";
import { getCurrentUser } from "@/lib/supabase/server";
import { CommunityDetailView } from "@/components/communities/CommunityDetailView";

interface CommunitySlugPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateMetadata({ params }: CommunitySlugPageProps) {
  const { slug } = await params;
  const res = await getCommunityBySlugAction(slug);
  if (!res.success || !res.data) {
    return { title: "Community Not Found | HIHA" };
  }
  return {
    title: `${res.data.name} | HIHA Communities`,
    description: res.data.description || `Explore discussions in c/${res.data.slug}`,
  };
}

export default async function CommunitySlugPage({ params }: CommunitySlugPageProps) {
  const { slug } = await params;
  const [res, user] = await Promise.all([
    getCommunityBySlugAction(slug),
    getCurrentUser(),
  ]);

  if (!res.success || !res.data) {
    notFound();
  }

  return (
    <div className="py-2 sm:py-6">
      <CommunityDetailView initialCommunity={res.data} viewerId={user?.id ?? null} />
    </div>
  );
}
