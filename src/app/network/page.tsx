import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, tryCreateClient } from "@/lib/supabase/server";
import {
  getPendingIncomingRequestsAction,
  getRelationshipStateAction,
} from "@/app/actions/relationships";
import { IncomingRequestsList } from "@/components/relationships/IncomingRequestsList";
import { RelationshipActions } from "@/components/relationships/RelationshipActions";

export const metadata = {
  title: "Connections & Safety | HIHA",
  description:
    "Manage your social relationships, review pending follow requests, and control blocking and muting.",
};

export default async function NetworkPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirectTo=/network");
  }

  const supabase = await tryCreateClient();
  if (!supabase) {
    return <div>Database unavailable.</div>;
  }

  // 1. Fetch incoming requests
  const incomingResult = await getPendingIncomingRequestsAction();
  const incomingRequests = incomingResult.data ?? [];

  // 2. Fetch other user profiles that are active and discoverable in directory search
  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .neq("id", user.id)
    .is("deactivated_at", null)
    .eq("discoverable_in_search", true)
    .order("created_at", { ascending: false })
    .limit(20);

  const otherProfiles = profiles ?? [];

  // 3. Fetch relationship states for these profiles in parallel
  const relationshipStates = await Promise.all(
    otherProfiles.map(async (p) => {
      const stateRes = await getRelationshipStateAction(p.id);
      return {
        profileId: p.id,
        state: stateRes.data ?? {
          isFollowing: false,
          isPendingOutgoing: false,
          isFollower: false,
          isPendingIncoming: false,
          isBlockedByMe: false,
          isBlockedByThem: false,
          isMuted: false,
        },
      };
    })
  );

  const stateMap = new Map(relationshipStates.map((s) => [s.profileId, s.state]));

  return (
    <div className="max-w-4xl mx-auto space-y-10 py-4">
      {/* Editorial Header */}
      <div className="border-b border-[var(--border)] pb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-mono rounded-full bg-[var(--surface-muted)] text-[var(--accent)] border border-[var(--border-subtle)]">
            <span>Social Graph</span>
            <span>•</span>
            <span>Responsible Safety</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
            Connections & Relationship Safety
          </h1>
          <p className="text-sm text-[var(--foreground-secondary)] max-w-2xl leading-relaxed">
            Manage follow requests, audience access, and content safety. On HIHA,
            following a private account requires their approval, and blocking strictly
            severs all connection and visibility.
          </p>
        </div>
        <Link
          href="/settings"
          className="shrink-0 py-2 px-3.5 text-xs font-medium rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-muted)] transition-colors"
        >
          Privacy &amp; Safety Settings →
        </Link>
      </div>

      {/* Incoming Requests Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            Incoming Follow Requests
          </h2>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--surface-muted)] text-[var(--foreground-muted)] border border-[var(--border)]">
            {incomingRequests.length} pending
          </span>
        </div>
        <IncomingRequestsList initialRequests={incomingRequests} />
      </section>

      {/* Discover & Connect Section */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            Discoverable Members &amp; Creators
          </h2>
          <p className="text-xs text-[var(--foreground-muted)]">
            Explore accounts that have opted into directory discovery and establish intentional connections.
          </p>
        </div>

        <div className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          {otherProfiles.map((target) => {
            const relState = stateMap.get(target.id) ?? {
              isFollowing: false,
              isPendingOutgoing: false,
              isFollower: false,
              isPendingIncoming: false,
              isBlockedByMe: false,
              isBlockedByThem: false,
              isMuted: false,
            };

            return (
              <div
                key={target.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--foreground)]">
                      {target.display_name}
                    </span>
                    <span className="text-xs font-mono text-[var(--foreground-muted)]">
                      @{target.username}
                    </span>
                    {target.is_private && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border-subtle)]">
                        Private
                      </span>
                    )}
                    {!target.is_private && target.follow_permission === "approval_required" && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border-subtle)]">
                        Follow Approval Required
                      </span>
                    )}
                    {target.follow_permission === "nobody" && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--surface-muted)] text-[var(--foreground-secondary)] border border-[var(--border-subtle)]">
                        Follows Closed
                      </span>
                    )}
                  </div>
                  {target.bio && (
                    <p className="text-xs text-[var(--foreground-secondary)] line-clamp-2 max-w-lg">
                      {target.bio}
                    </p>
                  )}
                </div>

                <RelationshipActions
                  targetUserId={target.id}
                  targetUsername={target.username}
                  isTargetPrivate={
                    target.is_private ||
                    target.follow_permission === "approval_required"
                  }
                  initialState={relState}
                />
              </div>
            );
          })}

          {otherProfiles.length === 0 && (
            <div className="p-8 text-center text-xs text-[var(--foreground-muted)]">
              No discoverable accounts found.
            </div>
          )}
        </div>
      </section>

      {/* Safety Tenets Panel */}
      <div className="p-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--foreground-secondary)] space-y-2">
        <h3 className="font-semibold text-[var(--foreground)]">
          Safety & Disconnection Tenets
        </h3>
        <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
          <li>
            <strong>Private Accounts:</strong> Following a private account creates a pending request. They must explicitly accept before you can access their protected profile.
          </li>
          <li>
            <strong>Blocking:</strong> Blocking completely severs any existing follow relationship in both directions and prevents either party from seeing protected content.
          </li>
          <li>
            <strong>Muting:</strong> Muting quietly suppresses a creator&apos;s posts from your feed algorithms without alerting them or altering your follow status.
          </li>
        </ul>
      </div>
    </div>
  );
}
