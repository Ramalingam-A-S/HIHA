# PROJECT CONTEXT: Responsible Social Media Platform

## Current Architecture
- **Workspace**: `c:\HIHA`
- **Runtime Environment**: Node.js v22.20.0, npm 11.6.2, Git 2.54.0
- **Live Supabase Project**: `https://xkvgdnlwyirpjxtalbgr.supabase.co`
- **Stack**:
  - Frontend: Next.js 15.5 (App Router), React 19, TypeScript (Strict)
  - Styling: Tailwind CSS v4, CSS variables design token system
  - Database & Auth: PostgreSQL via Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
  - Storage: Supabase Storage private bucket `media` with post-aware RLS and scoped path validation
  - Environment Validation: Zod (`src/lib/env.ts`) with strict server/client boundary
  - Security: HTTP Hardening & Content Security Policy (`src/lib/security.ts`)
  - Testing: Vitest (`vitest.config.mts`)

## Implemented Features
- **Scaffold & Architecture Shell (Milestone 1.1)**:
  - App Router structure (`src/app/`, `src/components/`, `src/lib/`, `tests/`).
  - Semantic `NavShell` with accessible navigation, platform wordmark, skip-to-content link, and planned module indicators.
  - Homepage reflecting platform vision, the 5 user-controlled feed modes, and architectural tenets.
  - Neutral editorial design tokens with CSS variables in `src/app/globals.css`.
- **Security & Environment Hardening**:
  - Production CSP strictly omitting `'unsafe-eval'`.
  - Development CSP allowing `'unsafe-eval'` solely for Next.js Fast Refresh & dev tooling.
  - Zod schemas in `src/lib/env.ts` supporting publishable and anon keys without leaking server secrets.
- **Supabase Authentication & Profiles (Milestone 1.2)**:
  - Browser and server Supabase clients using `@supabase/ssr` with async Next.js 15 `cookies()`.
  - Session refresh and route protection in `src/middleware.ts`.
  - Version-controlled SQL migration (`supabase/migrations/20261009120000_create_profiles.sql`) applied and live on development project.
  - Hardened database functions with `SET search_path = ''` and revoked public execute permissions (0 security advisor warnings).
  - Server actions for authentication (`signUpAction`, `loginAction`, `logoutAction`, `resetPasswordAction`) with anti-enumeration responses and Zod validation.
  - User interface pages: `/login`, `/signup`, `/reset-password`, and `/profile`.
- **Interest Taxonomy & User Preferences (Milestone 2.1)**:
  - SQL migration `supabase/migrations/20261009130000_create_interests.sql` applied to live development database.
  - Canonical interest catalog with 38 topics seeded across 9 categories.
  - Custom interest creation with normalization, slug uniqueness, and anti-spam limits (20 max).
  - User preferences table `user_interests` with priority weights (1–5) and unique assignments.
  - Full Row Level Security: public catalog reads, self-only preference reads/writes, creator-only custom topic updates/deletions.
  - Authenticated route `/interests` with category filters, real-time search, multi-select, priority weight calibration (1–5), custom topic creation, and atomic persistence.
  - Pure, deterministic content recommendation scorer (`src/lib/recommendation/scorer.ts`) with documented rules, feed modes (`my-mix`, `focus`, `explore`, `quiet`), cold start handling, and decoupled safety gate.
- **Social Graph & Relationship Safety (Milestone 2.2)**:
  - SQL migration `supabase/migrations/20261009140000_create_social_graph.sql` applied to live development database.
  - Tables: `follows` (pending/accepted requests), `blocks` (bidirectional severing), and `mutes` (content suppression).
  - Constraints preventing self-follow, self-block, and self-mute, plus unique pair constraints.
  - Non-recursive Row Level Security on `follows`, `blocks`, and `mutes`.
  - Updated `profiles` SELECT policies integrating follower access and strict block barriers.
  - Server actions (`src/app/actions/relationships.ts`) for follow, request, cancel, accept, reject, unfollow, block, unblock, mute, unmute, and state inspection.
  - Authenticated route `/network` with `IncomingRequestsList`, creator discovery, and `RelationshipActions`.
- **Content Foundation & Media Storage Abstraction (Milestone 2.3)**:
  - SQL migration `supabase/migrations/20261009150000_create_posts_and_media.sql` applied to live development database.
  - Table: `posts` supporting `content_type` (`text`, `image`, `short_video`, `long_video`), `status` (`draft`, `published`), `visibility` (`public`, `followers`, `private`), `category`, and timestamps.
  - Table: `post_interests` for multi-topic association reusing existing canonical interest catalog.
  - Private Supabase Storage bucket `media` (500MB max limit) with strict directory isolation (`{userId}/{fileId}.{ext}`) and RLS policies on `storage.objects`.
  - Provider-neutral media abstraction interface (`MediaStorageProvider`) and `SupabaseMediaStorageProvider` implementation supporting signed direct upload URLs, download URLs, and path ownership verification.
  - Post RLS visibility policy:
    - Creator always has access to their own drafts, private, followers, and public posts.
    - Drafts and private posts are strictly hidden from all non-creators.
    - Public posts are readable when published by non-blocked accounts.
    - Followers-only posts require an accepted follow relationship.
    - Blocking strictly denies post access in both directions regardless of visibility.
  - Server actions (`src/app/actions/posts.ts`): `createPostAction`, `updatePostAction`, `publishPostAction`, `deletePostAction`, `getUploadIntentAction`, `getPostAction`, and `getPostMediaUrlAction`.
  - Authenticated route `/create` with interactive `CreatePostForm` supporting text posts, content format selector, character counter (2,200 max), audience visibility, category, and topic tagging.
- **Security Remediation: Signed Media Authorization**:
  - SQL migration `supabase/migrations/20261009160000_update_storage_media_read_policy.sql` applied to live development database.
  - Post-aware `storage.objects` SELECT policy: Authenticated users can read media objects only if they own the object or if the object is attached to a post viewable under `public.posts` RLS.
  - Dedicated Server Action `getPostMediaUrlAction(postId)` verifying caller session, fetching post via user-scoped client, enforcing post visibility rules, verifying path prefix ownership, and issuing signed URLs with a short 300s (5-minute) TTL.
  - Storage path shielding: `getPostAction` masks `media_path` as `null` for non-creators to prevent direct storage probing.
  - Upload Intent Security: `createUploadIntent` rejects path traversal (`..`), path separators (`/`, `\`), hidden files, and validates file extensions against an explicit whitelist for the requested media type.
- **Personalized Feed Assembly & Transparent Ranking (Milestone 3.1)**:
  - Authenticated route `/feed` (protected by middleware) with accessible feed-mode tab switcher.
  - Five user-controlled feed modes implemented in `src/app/actions/feed.ts` (`getFeedAction`):
    - **My Mix** (`my-mix`): Posts scored by `scoreCandidate` using user interest priorities. Sorted score DESC → published_at DESC → id ASC for deterministic tie-breaking.
    - **Focus** (`focus`): Ranked like My Mix; filters out posts with no matched interest or learning-oriented category (`technology-science`, `education-learning`, `business-careers`). Applies 1.25× boost to science/education posts and 0.7× dampener to entertainment.
    - **Following** (`following`): Strict reverse-chronological stream from accepted follows excluding muted creators. No ranking applied; paginates directly at the database layer.
    - **Explore** (`explore`): Novel (unmatched) topics amplified 2.5×; familiar matched topics capped at score 40. Encourages discovery beyond established interests.
    - **Quiet Mode** (`quiet`): Reverse-chronological; score computed but not used for ordering. Low-stimulus design without fabricated well-being claims.
  - Feed retrieval enforces: published status, public/followers/private visibility, accepted follow relationships, bidirectional block barriers, and muted creator suppression — all derived from verified server session (never client-provided viewer ID).
  - Bounded candidate pool of 60 posts per ranked query; JS-layer mute filter applied before scoring.
  - Transparent explanation tags per card ("Matches your interest", "From someone you follow", "Trending topic") with "Why am I seeing this?" disclosure.
  - Secure media rendering via `getPostMediaUrlAction` — signed URL fetched on-demand per card, `media_path` never exposed to the client.
  - New files: `src/lib/feed/types.ts`, `src/app/actions/feed.ts`, `src/components/feed/FeedMediaView.tsx`, `src/components/feed/FeedModeSelector.tsx`, `src/components/feed/FeedCard.tsx`, `src/components/feed/FeedList.tsx`, `src/app/feed/page.tsx`.
  - Modified: `src/lib/supabase/middleware.ts` (added `/feed` to protected routes), `src/components/navigation/NavShell.tsx` (Feed link in desktop sidebar and mobile nav), `src/app/page.tsx` (Open Feed / Tune Interests / Create Post CTAs).
- **Automated Tests**:
  - 252 passing unit tests across 23 test suites:
    - `tests/privacy-and-data-controls.test.ts` (10 tests — account privacy & Teen 13–17 Safety Mode normalization, age-assurance adapter boundaries, follow/interaction permission gates, personal data export redaction, deactivation/deletion confirmation phrase validation)
    - `tests/authenticity-and-safeguards.test.ts` (7 tests — AI disclosure validation, non-accusatory labels, collaborative provenance, tag-stuffing & creator velocity safeguards)
    - `tests/ffmpeg-worker.test.ts` (6 tests — real FFmpeg & ffprobe binary execution)
    - `tests/collaborative-projects.test.ts` (7 tests)
    - `tests/moderation-enforcement.test.ts` (12 tests)
    - `tests/reports-logic.test.ts` (29 tests)
    - `tests/community-posts-logic.test.ts` (19 tests)
    - `tests/communities-logic.test.ts` (21 tests)
    - `tests/likes-logic.test.ts` (13 tests)
    - `tests/notifications-logic.test.ts` (13 tests)
    - `tests/feed-logic.test.ts` (10 tests)
    - `tests/posts-validation.test.ts` (19 tests)
    - `tests/posts-logic.test.ts` (7 tests)
    - `tests/relationships-logic.test.ts` (10 tests)
    - `tests/recommendation-scorer.test.ts` (9 tests)
    - `tests/interests-validation.test.ts` (10 tests)
    - `tests/rls-policy-logic.test.ts` (10 tests)
    - `tests/security.test.ts` (7 tests)
    - `tests/utils.test.ts` (6 tests)
    - `tests/supabase-config.test.ts` (5 tests)
    - `tests/profile-validation.test.ts` (5 tests)
    - `tests/env.test.ts` (9 tests)
    - `tests/auth-validation.test.ts` (8 tests)
- **Live Database Integration Verification**:
  - 170/170 live integration tests verified against actual Supabase project (`scripts/verify-live-supabase.mts`).
  - Original 51 milestones 1.2–2.3 + security remediation tests: all PASS (no regressions).
  - 18 Milestone 3.1A feed integration tests: all PASS.
  - 10 Milestone 3.2A notifications foundation tests: all PASS.
  - 10 Milestone 3.2B likes & engagement counter tests: all PASS.
  - 10 Milestone 3.3A communities foundation tests: all PASS.
  - 9 Milestone 3.3B community posts & scoped moderation tests: all PASS.
  - 14 Milestone 3.4 content reporting & trust safety foundation tests: all PASS.
  - 10 Milestone 4.1 moderation enforcement & appeals tests: all PASS.
  - 12 Milestone 4.2 collaborative content creation & video stitching tests: all PASS.
  - 6 Milestone 4.2A end-to-end FFmpeg video rendering worker tests: all PASS.
  - 10 Milestone 4.3 AI content transparency, provenance & anti-manipulation safeguard tests: all PASS.
  - 10 Milestone 4.4 child safety, privacy & user data controls tests: all PASS.
- **Communities Foundation (Milestone 3.3A)**:
  - Version-controlled migration: `supabase/migrations/20261009190000_create_communities.sql` applied to live database.
  - Schema architecture:
    - `public.communities`: UUID primary key, `owner_id REFERENCES auth.users(id) ON DELETE RESTRICT`, `name`, `slug` (unique normalized alphanumeric-hyphenated string `^[a-z0-9]+(-[a-z0-9]+)*$`), `description`, `visibility` (`public` or `private`), optional `interest_id REFERENCES public.interests(id) ON DELETE SET NULL`, `category`, and timestamps.
    - `public.community_members`: UUID primary key, `community_id REFERENCES public.communities(id) ON DELETE CASCADE`, `user_id REFERENCES auth.users(id) ON DELETE CASCADE`, `role` (`owner`, `moderator`, `member`), `status` (`active`, `pending`, `rejected`, `banned`), and `UNIQUE (community_id, user_id)`.
  - Database invariants & triggers:
    - `handle_community_created()`: `SECURITY DEFINER` trigger automatically inserts the community creator into `community_members` as `role = 'owner'` and `status = 'active'` atomically upon community insertion.
    - `handle_updated_at()`: triggers on both tables keep `updated_at` current.
    - `is_community_active_member()` and `get_community_member_role()`: `SECURITY DEFINER` helper functions with `SET search_path = ''` allow safe RLS checks without infinite policy recursion.
    - `request_community_membership()`: `SECURITY DEFINER` function managing safe atomic membership requests/joins respecting visibility and block barriers without leaking private community metadata.
  - Row Level Security:
    - Communities SELECT: Public communities visible to all non-blocked users; private communities visible to owner and active members.
    - Communities UPDATE/DELETE: Restricted strictly to community owner or staff moderators.
    - Community Members RLS: Non-recursive policies allowing members/staff to query roster; owner cannot leave without ownership transfer (`role <> 'owner'`); staff can moderate roles and pending requests.
  - Server actions (`src/app/actions/communities.ts`):
    - `createCommunityAction`: Validates inputs with Zod (`createCommunitySchema`), verifies session user as owner.
    - `getCommunitiesAction`: Paginated discovery with optional search and category filters, computing live active member counts and viewer membership status.
    - `getCommunityBySlugAction`: Detailed profile retrieval including owner profile, linked canonical interest, and viewer status.
    - `joinCommunityAction`: Auto-enrolls active member for public hubs or queues pending request for private hubs via atomic RPC.
    - `leaveCommunityAction`: Enforces owner leave prohibition.
    - `respondToMembershipRequestAction`: Moderator/Owner approval or rejection of pending requests.
    - `removeCommunityMemberAction`: Moderation removal of members.
    - `updateMemberRoleAction`: Owner promotion of members to moderator or demotion back to member.
    - `transferCommunityOwnershipAction`: Explicit atomic ownership handover; demotes previous owner to moderator.
    - `getCommunityMembersAction` and `getCommunityPendingRequestsAction`: Paginated member rosters and staff moderation queues.
  - Responsive UI & Navigation:
    - `/communities`: Discovery page with search bar, category filter, responsive grid, loading skeletons, empty states, and `CreateCommunityModal`.
    - `/communities/[slug]`: Community hub detail page with About, Members, and Staff Pending Requests tabs, dynamic metadata generation, and membership controls.
    - Desktop sidebar and mobile bottom tab bar (`NavShell.tsx`) updated with active `Communities` / `Hubs` links.
- **Community Posts, Discussions & Scoped Moderation (Milestone 3.3B)**:
  - Version-controlled migration: `supabase/migrations/20261009200000_create_community_posts.sql` applied to live database.
  - Relational schema & indexing:
    - `public.community_posts`: UUID primary key, `community_id REFERENCES public.communities(id) ON DELETE CASCADE`, `post_id REFERENCES public.posts(id) ON DELETE CASCADE`, `poster_id REFERENCES auth.users(id) ON DELETE CASCADE`, `pinned_at TIMESTAMPTZ`, `removed_at TIMESTAMPTZ`, `removed_by REFERENCES auth.users(id) ON DELETE SET NULL`, `removal_reason TEXT CHECK (length <= 500)`, `created_at TIMESTAMPTZ`.
    - Constraints: `UNIQUE (community_id, post_id)` guarantees idempotency and prevents duplicate shares.
    - Indexes: composite on `(community_id, created_at DESC)`, `post_id`, `poster_id`, partial index on pinned posts, partial index on active (non-removed) posts.
  - Staff helper function:
    - `public.is_community_staff(c_id UUID, u_id UUID)`: `SECURITY DEFINER` function with `search_path = ''` safely determining if user is an active owner or moderator.
  - Row Level Security:
    - `SELECT`: Allowed when both the community and the underlying post are viewable by caller under RLS.
    - `INSERT`: Enforces that caller is `poster_id`, is an active member (`is_community_active_member`), and the underlying post is published and owned by the caller.
    - `UPDATE`: Strictly restricted to community staff (`is_community_staff`) for pinning and soft-removal metadata updates.
    - `DELETE`: Author can retract their shared post (`poster_id = auth.uid()`); staff can hard-delete any post in their community.
  - Server actions (`src/app/actions/community-posts.ts`):
    - `shareToCommunityAction({ communityId, postId })`: Validates membership, shares published post idempotently via upsert.
    - `getCommunityPostsAction({ communityId, page, pageSize })`: Bounded pagination, orders pinned posts first (`pinned_at DESC NULLS LAST`) then reverse-chronological (`created_at DESC`), enriches with creator profile.
    - `removeCommunityPostAction({ communityPostId, removalReason })`: Dual-path deletion — author hard retraction via DELETE, staff scoped soft-removal with audit reason via UPDATE.
    - `pinCommunityPostAction({ communityPostId, pin })`: Idempotent pin/unpin for staff moderators.
    - `getShareablePostsAction({ communityId })`: Queries published posts of caller not yet in the community.
  - Responsive UI & Discussions:
    - `/communities/[slug]`: "Discussions" tab as primary view, showing community feed with pin banners, author retraction controls, and staff moderation actions.
    - `CommunityPostCard.tsx`: Accessible post presentation with pin badge, media view, author retract CTA, and staff pin/remove prompts.
    - `ShareToCommunityModal.tsx`: Modal dialog for active members to browse and cross-post published content into the space.
- **Content Reporting & Trust Safety Foundation (Milestone 3.4)**:
  - Version-controlled migration: `supabase/migrations/20261010000000_create_content_reports.sql` applied to live database.
  - Platform staff model: `platform_staff` table (`user_id`, `role IN ('admin', 'moderator')`, `created_at`) with RLS (`platform_staff_select_own`) and `is_platform_staff(u_id UUID)` `SECURITY DEFINER` helper function (`SET search_path = ''`), strictly decoupled from community ownership.
  - Relational & polymorphic schema: `content_reports` table supporting `target_type IN ('post', 'community_post', 'profile')`, constrained `reason IN ('spam', 'harassment', 'hate_speech', 'misinformation', 'violence', 'copyright', 'other')`, `details` (<= 1,000 chars), `status IN ('open', 'in_review', 'resolved', 'dismissed')`, `reviewer_id`, `reviewed_at`, and `resolution_note` (<= 1,000 chars).
  - Explicit referential integrity strategy: Dedicated foreign key columns (`post_id REFERENCES posts(id) ON DELETE CASCADE`, `community_post_id REFERENCES community_posts(id) ON DELETE CASCADE`, `reported_profile_id REFERENCES profiles(id) ON DELETE CASCADE`, `community_id REFERENCES communities(id) ON DELETE CASCADE`) paired with `content_reports_target_ref_check` constraint and `handle_content_report_insert()` `BEFORE INSERT` trigger that validates target existence, rejects self-reporting across all target types, and automatically links foreign keys.
  - Concurrency-safe duplicate prevention: Partial unique index `idx_content_reports_unique_active` on `(reporter_id, target_type, target_id) WHERE status IN ('open', 'in_review')` blocks duplicate active reports while allowing re-submission if a prior report was dismissed or resolved.
  - Row Level Security (`content_reports`):
    - `SELECT`: Reporters can view their own reports; platform staff can view all reports; community staff (`is_community_staff`) can view reports scoped to their community (`community_id IS NOT NULL`). Reported users and ordinary community members receive 0 rows.
    - `INSERT`: Authenticated users only; `WITH CHECK` enforces `reporter_id = auth.uid()`, `status = 'open'`, and `reviewer_id IS NULL AND reviewed_at IS NULL AND resolution_note IS NULL`.
    - `UPDATE`: Strictly restricted to platform staff (global) or community staff (for reports in their community). Reporters cannot modify status or reviewer fields.
    - `DELETE`: Restricted exclusively to platform staff.
  - Server actions (`src/app/actions/reports.ts`): `submitReportAction`, `getReporterReportsAction` (strips `reviewer_id` and `resolution_note`), `getModerationQueueAction`, `updateReportStatusAction`, and `checkModerationAccessAction`.
  - UI & Protected Routes:
    - `ReportModal.tsx`: Accessible report dialog integrated into `FeedCard.tsx` and `CommunityPostCard.tsx`.
    - `/moderation`: Protected Trust & Safety review queue (`ModerationQueueView.tsx`) with status filtering, target context, and claim/resolve/dismiss workflows.
- **Moderation Enforcement & Appeals (Milestone 4.1)**:
  - Version-controlled migration: `supabase/migrations/20261010010000_create_moderation_enforcement_and_appeals.sql` applied to live database.
  - Enforcement & Audit Schema (`public.moderation_actions`):
    - Supports `action_type IN ('warning', 'content_restriction', 'account_restriction')`, `target_type IN ('post', 'community_post', 'profile')`, `status IN ('active', 'expired', 'reversed')`, bounded `duration_hours` (`1..8760` hours required for `account_restriction`), computed `expires_at`, `reversed_by`, `reversed_at`, and `reversal_reason`.
    - Explicit foreign keys (`post_id`, `community_post_id`, `target_user_id`, `community_id`, `report_id`) paired with `handle_moderation_action_insert()` `BEFORE INSERT` trigger that derives target ownership, enforces strict scope separation (`is_platform_staff` for global actions vs. `is_community_staff` for `community_post` actions), and marks linked `content_reports` rows as `resolved`.
    - Partial unique indexes `idx_moderation_actions_unique_active_restriction` (prevents duplicate active restrictions on the same target) and `idx_moderation_actions_unique_report_action` (prevents duplicate active actions per report).
    - Tamper-resistant audit trail: `DELETE` privilege on `moderation_actions` is revoked from `PUBLIC, anon, authenticated`. `handle_moderation_action_update()` strictly prohibits modifying core audit fields (`actor_id`, `target_user_id`, `target_type`, `target_id`, `action_type`, `reason`, `duration_hours`, `expires_at`, `community_id`, `created_at`), blocks self-reversals, and blocks reactivating reversed or expired records.
  - Appeals Schema (`public.moderation_appeals`):
    - Allows affected users (`appellant_id = target_user_id`) to challenge active decisions (`UNIQUE (action_id)`) with a bounded `appeal_reason` (`10..1000` chars).
    - `handle_moderation_appeal_update()` enforces reviewer scope, blocks self-review, and upon `status = 'approved'` automatically reverses the parent `moderation_actions` row (`status = 'reversed'`) and restores content/account standing without altering original audit fields.
  - Cross-Route Enforcement & Automatic Expiration:
    - `SECURITY DEFINER` helpers (`is_post_restricted`, `is_community_post_restricted`, `is_account_restricted` with `SET search_path = ''`) evaluate `status = 'active' AND (expires_at IS NULL OR expires_at > now())` in real time so temporary restrictions automatically expire without requiring a background cron job.
    - Updated RLS policies on `public.posts` and `public.community_posts` block restricted posts from feeds, community cross-posts, and `storage.objects` media downloads for all non-creators while allowing the affected author to inspect their own restricted record for appeals. Active `account_restriction` blocks new post creation, post updates, and community cross-posting.
  - Server Actions (`src/app/actions/reports.ts`) & UI (`src/components/moderation/ModerationQueueView.tsx`):
    - Added `issueModerationAction`, `reverseModerationAction`, `getUserModerationRecordsAction`, `submitAppealAction`, `getModerationAuditLogAction`, `getModerationAppealsQueueAction`, and `reviewAppealAction`.
    - Extended `/moderation` with accessible tabs and modal dialogs for issuing enforcement actions from reports, reviewing user appeals, inspecting/reversing audit log entries, and allowing affected users (`My Standing & Appeals`) to view their own restrictions and submit appeals.
- **Notifications Foundation (Milestone 3.2A)**:
  - Version-controlled migration: `supabase/migrations/20261009170000_create_notifications.sql` applied to live database.
  - Constrained notification types: `follow_request`, `follow_accepted`, `new_follower`.
  - Server-side generation: Notifications are created exclusively via the `notify_follow_event()` `SECURITY DEFINER` database trigger attached to `public.follows`.
  - Forgery prevention: Authenticated role is strictly granted `SELECT, UPDATE` — no `INSERT` grant exists for authenticated users, making direct forgery impossible at the PostgreSQL level.
  - Row Level Security:
    - `notifications_select_own`: Users can only read notifications where `recipient_id = auth.uid()`.
    - `notifications_update_own_read`: Users can only mark their own notifications as read (`WITH CHECK` strictly enforces that `recipient_id`, `actor_id`, `type`, and `follow_id` cannot be modified).
  - Block awareness: `notify_follow_event()` checks `is_blocked(recipient, actor)` before insertion, preventing notifications across blocked accounts in either direction.
  - Deduplication: Partial unique index `idx_notifications_dedup` on `(recipient_id, actor_id, type, follow_id)` prevents duplicate notifications on repeated relationship operations.
  - Cascade lifecycle: `follow_id REFERENCES public.follows(id) ON DELETE CASCADE` automatically cleans up relationship notifications when a follow is severed; `actor_id REFERENCES auth.users(id) ON DELETE SET NULL` prevents dangling references.
  - Server actions (`src/app/actions/notifications.ts`): `getNotificationsAction`, `getUnreadCountAction`, `markNotificationReadAction`, `markAllNotificationsReadAction`.
  - UI routes & components: `/notifications` with `NotificationList.tsx` (loading skeleton, empty state, safe generic error states, pagination, mark one/all read), and `NotificationBadge.tsx` unread badge in `NavShell.tsx` (desktop sidebar and mobile bottom nav).
  - Protected route: `/notifications` registered in `middleware.ts`.
- **Likes & Reliable Engagement Counters (Milestone 3.2B)**:
  - Version-controlled migration: `supabase/migrations/20261009180000_create_post_likes.sql` applied to live database.
  - Relational schema: `post_likes` table with UUID primary key, `post_id REFERENCES posts(id) ON DELETE CASCADE`, `user_id REFERENCES auth.users(id) ON DELETE CASCADE`, created_at, and `UNIQUE (post_id, user_id)`.
  - Indexes: `idx_post_likes_post_id` for fast count aggregation, and `idx_post_likes_user_id` for viewer's liked post lookups.
  - Authorization & RLS:
    - `SELECT`: Allowed only if the parent post is viewable by the caller under `posts` RLS (`EXISTS (SELECT 1 FROM public.posts p WHERE p.id = post_likes.post_id)`).
    - `INSERT`: Allowed only when `user_id = auth.uid()` AND the post is viewable under `posts` RLS (`WITH CHECK`). Ineligible posts (drafts, private posts of others, followers-only posts from non-followers, or posts blocked in either direction) cannot be liked.
    - `DELETE`: Users can only delete their own likes (`user_id = auth.uid()`).
  - Server actions (`src/app/actions/likes.ts`):
    - `likePostAction(postId)`: Idempotent upsert with `onConflict: "post_id,user_id", ignoreDuplicates: true`. Returns database-derived accurate `likeCount` and `isLiked`.
    - `unlikePostAction(postId)`: Idempotent delete. Returns database-derived accurate `likeCount` and `isLiked`.
  - Feed enrichment (`src/app/actions/feed.ts`):
    - Feed items dynamically enriched with database-verified `likeCount` and `isLikedByViewer` for both Following and ranked modes (My Mix, Focus, Explore, Quiet).
    - Enrichment is performed efficiently on the paginated slice (`pageSize`), avoiding unnecessary database round-trips for discarded candidates.
  - Accessible UI in `FeedCard.tsx`:
    - Like button control with heart indicator (`♥` / `♡`) and accurate count.
    - Optimistic UI state updates with guaranteed state rollback upon server error or network rejection.
    - Safe generic error messages without database detail leakage.

- **Collaborative Content Creation & Video Stitching (Milestone 4.2)**:
  - Version-controlled migrations applied to live database:
    - `supabase/migrations/20261010020000_create_collaborative_projects_and_stitching.sql`
    - `supabase/migrations/20261010020100_fix_collaborative_projects_rls_and_volatility.sql`
  - Collaborative Project Foundation (`public.collaborative_projects` & `public.project_participants`):
    - Supports `status IN ('draft', 'open', 'locked', 'rendering', 'completed', 'cancelled')`, `visibility IN ('public', 'private')`, `participation_mode IN ('open', 'invite_only')`, optional `community_id`, `consent_policy_version = 'v1.0-collaborative-2026'`, and `output_media_path`.
    - `handle_collaborative_project_insert()` validates session ownership, account standing (`NOT is_account_restricted`), community membership and private-community visibility inheritance, and forces `participation_mode = 'invite_only'` on private projects.
    - `handle_collaborative_project_created()` atomically enrolls the creator in `project_participants` as `role = 'owner'` and `status = 'active'`.
    - `project_participants` enforces `role IN ('owner', 'editor', 'contributor')` and `status IN ('active', 'invited', 'requested', 'declined', 'removed')` with a partial unique index `idx_project_participants_single_owner` and triggers (`handle_project_participant_insert`, `handle_project_participant_update`, `handle_project_participant_inactive`) preventing self-promotion to editor/owner or forced active enrollment without invite acceptance.
    - Private projects are completely isolated under RLS (`can_view_project`): non-participants cannot discover private projects, their participant rosters, their clips, or their storage objects.
  - Contributions & Explicit Usage Consent (`public.project_contributions`):
    - Requires `consent_granted = true` and `consent_policy_version = 'v1.0-collaborative-2026'` on insertion (`handle_project_contribution_insert`), recording server-assigned `consent_granted_at = now()`, validating storage path prefix ownership (`{contributorId}/{fileId}.{ext}`), validating video MIME types (`video/mp4`, `video/webm`, `video/quicktime`) and byte bounds, and verifying any linked `source_post_id`.
    - Consent Withdrawal & Race Protection (`handle_project_contribution_update` & `handle_project_participant_inactive`):
      - Contributors can withdraw consent at any time (`consent_granted = false`, `review_status = 'withdrawn'`, `consent_withdrawn_at = now()`, `sequence_order = NULL`).
      - Withdrawing consent on an approved clip automatically aborts any active (`queued` or `processing`) render job to `status = 'failed'`, resets `collaborative_projects.status` to `'open'`, clears `collaborative_projects.output_media_path = NULL` (even if withdrawn post-completion), and revokes `storage.objects` read access immediately.
      - Removing a participant or leaving a project (`handle_project_participant_inactive`) automatically withdraws all of that participant's active contributions.
  - Review, Ordering & Durable Video Stitching Pipeline (`public.project_render_jobs` & `src/lib/collaboration/render-provider.ts`):
    - Only authorized project editors/owners (`is_project_editor`) can approve/reject contributions or reorder sequence positions.
    - `handle_project_render_job_insert()` builds the authoritative `input_manifest` JSONB snapshot exclusively from database-verified `approved`, `consent_granted = true`, non-withdrawn contributions from active, unrestricted participants ordered by `sequence_order ASC`.
    - Partial unique index `idx_project_render_jobs_one_active` prevents concurrent duplicate active (`queued`/`processing`) jobs per project, and `UNIQUE (project_id, idempotency_key)` guarantees idempotent submission.
    - `handle_project_render_job_update()` and `validate_render_job_manifest_integrity()` re-verify that every clip in `input_manifest` still has active consent and unrestricted contributor standing before transitioning to `processing`, `completed`, or retrying (`attempt_count < max_attempts`), and enforce `timeout_seconds`.
    - Provider-neutral `VideoStitchingProvider` interface (`src/lib/collaboration/render-provider.ts`) and `ContractQueueStitchingAdapter` persist durable jobs without executing synchronous FFmpeg inside Next.js server actions.
  - Server Actions (`src/app/actions/collaboration.ts`) & UI (`src/app/collaborate/page.tsx`, `src/components/collaboration/CollaborateWorkspaceView.tsx`):
    - 17 validated server actions for project CRUD, invitations/participation, consented clip upload/submission, consent withdrawal, editor review, sequence reordering, idempotent render job dispatch/retry, and 300s signed media URLs (`getContributionMediaUrlAction`, `getProjectOutputMediaUrlAction`) with `media_path` masked as `null` in client DTOs.
    - Protected `/collaborate` workspace integrated into `middleware.ts` and `NavShell.tsx`.
- **End-to-End Video Rendering Worker (Milestone 4.2A)**:
  - Version-controlled migration applied to live database: `supabase/migrations/20261010020200_add_render_worker_claim_and_cancellation_guards.sql`.
  - Atomic Worker Claiming & Cancellation Guards:
    - `public.claim_project_render_job(p_job_id UUID DEFAULT NULL)` (`SECURITY INVOKER` using `FOR UPDATE OF rj SKIP LOCKED`) atomically claims one queued render job for an authorized project editor/owner and transitions it to `status = 'processing'`, preventing duplicate execution across concurrent workers.
    - Enhanced `validate_render_job_manifest_integrity()` verifies non-cancelled project status, live contribution `media_path` equality, `consent_policy_version`, active participant status, account standing, and bidirectional block barriers (`NOT is_blocked`) between contributors and project owner.
    - Enhanced `handle_collaborative_project_update()` automatically aborts any active (`queued`/`processing`) render job (`status = 'failed'`) and clears `output_media_path` whenever a project is cancelled (`status = 'cancelled'`).
  - Real FFmpeg & ffprobe Rendering Processor (`src/lib/collaboration/ffmpeg-worker.ts` & `scripts/run-render-worker.mts`):
    - Uses pinned static binaries (`ffmpeg-static@5.3.0`, `ffprobe-static@3.1.0`) or environment overrides (`FFMPEG_PATH`, `FFPROBE_PATH`) via `execFile` (`shell: false`, strict process timeout with `SIGKILL`) so untrusted media metadata or paths can never cause shell injection or hang the worker.
    - Downloads each clip in `input_manifest` sequence order using short-lived 60s signed URLs (`cache: "no-store"`) that enforce `storage.objects` RLS, verifying byte limits (`maxClipSizeBytes = 100 MB`, `maxTotalInputBytes = 300 MB`).
    - Probes every clip with `ffprobe` (`probeMediaFile` + `validateProbedClip`) to verify container format, video codec (`h264`, `hevc`, `vp8`, `vp9`, `av1`, `mpeg4`), dimensions (`64px–3840px`), and duration (`0.2s–180s` per clip, `600s` max total).
    - Normalizes heterogeneous clips (varying resolutions, frame rates, pixel formats, or missing audio tracks) into canonical `640x360 @ 24fps H.264 (yuv420p) + 44.1kHz stereo AAC` segments before concatenating via FFmpeg's `concat` demuxer (`-f concat -safe 0 -c copy -movflags +faststart`) and verifying the final output MP4 with `ffprobe`.
    - Re-verifies project status (`status = 'rendering'`) and live contributor consent/eligibility right before uploading the rendered MP4 to private `media` storage and committing `status = 'completed'`. If consent was withdrawn or the project was cancelled mid-render, the worker aborts, removes any uploaded storage object, and marks the job `failed` without exposing partial or unauthorized output.
    - Deterministically cleans up isolated temporary directories (`os.tmpdir()/hiha-render-{jobId}-*`) in a `finally` block across success, failure, cancellation, or timeout, plus `cleanupOrphanedRenderTempDirs()` for crash recovery.
    - Server actions in Next.js never execute FFmpeg inline; `VideoStitchingProvider` (`src/lib/collaboration/render-provider.ts`) queues durable jobs that are processed out-of-band by `npm run worker:render` (`scripts/run-render-worker.mts` supporting `--once`, `--poll`, `--job-id`, `--interval-ms`, and `--cleanup-orphans`).
- **AI Content Transparency, Provenance & Anti-Manipulation Safeguards (Milestone 4.3)**:
  - Version-controlled migration applied to live database: `supabase/migrations/20261010030000_add_ai_transparency_provenance_and_rate_limits.sql`.
  - Content Disclosure & Provenance Model (`public.posts` & `public.project_contributions`):
    - Supports `ai_disclosure_status IN ('not_declared', 'no_ai_declared', 'ai_generated', 'ai_assisted', 'material_alteration')`, optional creator-supplied `ai_disclosure_details` (max 500 chars), server-recorded `ai_disclosed_at`, and `provenance_status IN ('unverified', 'creator_declared', 'machine_verified')` (`provenance_verified_at` on `posts`).
    - Explicitly separates `'not_declared'` (default `'unverified'` origin) from `'no_ai_declared'` (`'creator_declared'` self-statement) and `'machine_verified'` so lack of a declaration is never presented as proof that content is human-created or unaltered.
    - `handle_post_authenticity_before_write()` blocks arbitrary clients from forging `provenance_status = 'machine_verified'`, enforces post/account moderation restrictions on edits, automatically downgrades `machine_verified` back to `creator_declared` (or `unverified`) whenever `caption`, `media_path`, `media_metadata`, `ai_disclosure_status`, or `ai_disclosure_details` is edited, and enforces `posts_ai_disclosure_consistency_check`.
    - `issue_post_provenance_verification(p_post_id UUID)` allows platform staff to record system-verified provenance (`machine_verified`) via a transaction-local `app.trusted_provenance_verifier` flag while keeping RLS active.
    - `handle_project_contribution_insert()` automatically inherits `ai_disclosure_status` and `ai_disclosure_details` from `source_post_id` when a contributor submits an existing published video post without overriding the disclosure.
  - Privacy-Safe Collaborative Video Output Provenance (`public.project_render_jobs` & `public.collaborative_projects`):
    - `handle_project_render_job_insert()` includes each approved, consented clip's `ai_disclosure_status` and `provenance_status` in `input_manifest`.
    - Upon job completion (`status = 'completed'`), `build_collaborative_output_provenance()` computes a privacy-safe composite `output_provenance` JSONB summary (`total_included_clips`, `has_declared_ai_or_alteration`, `has_undeclared_clips`, `disclosure_breakdown`, `included_sequences`) on both `project_render_jobs` and `collaborative_projects` without exposing private contributor user IDs, storage paths, or unapproved/withdrawn clips.
    - Withdrawing clip consent (`handle_project_contribution_update`) or cancelling a project (`handle_collaborative_project_update`) immediately clears `collaborative_projects.output_provenance = NULL` alongside `output_media_path = NULL`.
  - Narrowly Scoped Manipulated-Engagement & Ranking Safeguards:
    - Database rate-limit ledger (`public.rate_limit_events`, RLS-enabled with zero client table grants) enforced by triggers:
      - `handle_post_authenticity_before_write()`: caps post creation bursts (`<= 12` posts per 10s) and blocks rapid duplicate normalized caption spam (`<= 3` identical normalized captions per 60s).
      - `handle_post_like_safeguards()`: blocks rapid like/unlike toggling on the same post (`<= 3` like insertions on the same `post_id` per 60s, even if deleted in between) and mass-liking bursts (`<= 25` likes per 15s).
      - `handle_community_post_safeguards()`: caps rapid community cross-post flooding (`<= 8` shares per 15s).
    - Deterministic Ranking Anti-Abuse (`src/lib/recommendation/scorer.ts` & `src/app/actions/feed.ts`):
      - Deduplicates and caps evaluated interest tags per post at `MAX_EVALUATED_INTERESTS_PER_POST = 5` so tag-stuffing cannot inflate relevance scores.
      - Applies `applyCreatorVelocityDampener()` (`1.0x` for 1st/2nd post, `0.85x` for 3rd, `0.70x` for 4th+ in the ranked candidate pool) so a single creator burst cannot monopolize top feed slots.
  - Accessible UI (`AiDisclosureSelector.tsx`, `ContentAuthenticityBadge.tsx`, `CreatePostForm.tsx`, `FeedCard.tsx`, `CommunityPostCard.tsx`, `CollaborateWorkspaceView.tsx`):
    - Creators can declare or update AI/material-alteration disclosures when creating posts, editing posts on feed cards, or submitting collaborative video clips.
    - Non-accusatory, expandable `ContentAuthenticityBadge` rendered across feed cards, community posts, and collaborative contributions, plus composite provenance summaries on completed collaborative projects and render jobs.
- **Child Safety, Privacy & User Data Controls (Milestone 4.4)**:
  - Version-controlled migration applied to live database: `supabase/migrations/20261010040000_add_privacy_child_safety_and_data_controls.sql`.
  - Granular Account Privacy & Discoverability (`public.profiles`, `/settings`, `/network`, `/create`, `/profile`):
    - Extends `public.profiles` with `discoverable_in_search`, `follow_permission IN ('everyone', 'approval_required', 'nobody')`, `interaction_permission IN ('everyone', 'followers_only', 'nobody')`, `default_post_visibility IN ('public', 'followers', 'private')`, `notify_on_follow_request`, `notify_on_new_follower`, `notify_on_follow_accepted`, `age_safety_mode IN ('standard', 'teen_13_17')`, `minimum_age_attested_at`, `age_assurance_status IN ('unverified', 'self_attested', 'provider_verified')`, `privacy_policy_version`, and `deactivated_at`.
    - `handle_follow_privacy_before_insert()` enforces `follow_permission` (`'nobody'` blocks new follows; `'approval_required'`, `is_private = true`, or `age_safety_mode = 'teen_13_17'` requires `status = 'pending'`), rejects deactivated accounts, and blocks follow creation across active blocks.
    - `handle_post_like_privacy_check()` and `handle_project_participant_privacy_check()` enforce `interaction_permission` (`'followers_only'` and `'nobody'`) on post likes and collaborative project invitations.
    - `notify_follow_event()` respects recipient notification preferences (`notify_on_follow_request`, `notify_on_new_follower`, `notify_on_follow_accepted`) and suppresses notifications for deactivated accounts.
    - `getCommunityPostsAction` filters out inaccessible/blocked posts and muted creators so privacy and relationship rules apply consistently across feeds, profiles, network directory search, communities, collaborative projects, and signed media URLs.
  - Privacy-Preserving Child & Teen Safety Foundation (`src/lib/privacy/age-assurance.ts`, `src/lib/privacy/types.ts`):
    - Minimizes age-related data collection: HIHA never collects, stores, or exposes birth dates (`date_of_birth`) or government IDs.
    - `profiles_teen_safety_invariants_check` and `handle_profile_privacy_and_age_safety()` enforce protective defaults for `teen_13_17` accounts (`is_private = true`, `discoverable_in_search = false`, `follow_permission IN ('approval_required', 'nobody')`, `interaction_permission IN ('followers_only', 'nobody')`, `default_post_visibility IN ('followers', 'private')`), prevent relaxing those protections while Teen Safety Mode is active, and block clients from forging `age_assurance_status = 'provider_verified'`.
    - `handle_post_privacy_and_age_safety()` and `handle_collaborative_project_age_safety()` block `teen_13_17` accounts from publishing globally public posts or creating public collaborative projects.
    - `AgeAssuranceProvider` & `SelfAttestationAgeAdapter` explicitly separate minimum-age self-attestation (`verifiedByExternalProvider: false`) from zero-knowledge external age-bracket tokens (`ExternalAgeAssuranceTokenPayload`) without claiming self-attestation proves legal age.
  - Self-Service Personal Data Export, Account Deactivation/Deletion & Anonymized Audit Retention (`src/app/actions/privacy.ts`, `PrivacySettingsView.tsx`):
    - `export_own_personal_data()` (`SECURITY DEFINER`) and `sanitizePersonalDataExport()` generate a portable JSON archive strictly scoped to `auth.uid()`, stripping internal staff reviewer IDs (`reviewer_id`, `actor_id`, `reversed_by`) and raw storage paths.
    - `request_or_execute_account_deletion(p_mode, p_confirmation)` requires password re-verification in `deleteOrDeactivateAccountAction` and exact confirmation phrase (`DEACTIVATE MY ACCOUNT` or `DELETE MY ACCOUNT`), snapshots moderation history into `public.moderation_retention_ledger` using a salted hash (`subject_user_hash`) with zero PII, withdraws all active collaborative video contribution consents (which cascades through `handle_project_contribution_update()` to abort active render jobs and clear `output_media_path` and `output_provenance` on completed collaborative projects), unpublishes/scrubs posts, and scrubs profile PII (`display_name = 'Deactivated Account'`, `bio = NULL`, `is_private = true`, `discoverable_in_search = false`, `follow_permission = 'nobody'`, `interaction_permission = 'nobody'`, `deactivated_at = now()`).
    - `reactivate_own_account(p_display_name)` restores `deactivated_at = NULL` while preserving private/protective defaults (`is_private = true`, `discoverable_in_search = false`, `follow_permission = 'approval_required'`, `interaction_permission = 'followers_only'`, `default_post_visibility = 'private'`) so reactivation never silently restores old public settings.
    - Live Suite Check 167 Diagnosis & Fix (`scripts/verify-live-supabase.mts`): Resolved two test-fixture/RLS query issues in Check 167 (`"Data Controls: Account Deactivation Scrubbing & Consent Withdrawal"`): (1) replaced invalid `participation_mode: "open_community"` with `"open"` so the collaborative project, participant, approved contribution, and completed render job (`output_media_path`) are created properly before deactivation; and (2) queried the withdrawn contribution row via contributor `clientB` (`clipBSelfAfter`: `consent_granted = false`, `review_status = 'withdrawn'`, `consent_withdrawn_at IS NOT NULL`) while verifying that non-contributor `clientA` receives `null` (`clipBFromAAfter = null`) under `project_contributions_select_policy` RLS (`review_status <> 'withdrawn' AND consent_granted = true AND consent_withdrawn_at IS NULL`) and that hosted project output (`output_media_path`, `output_provenance`, and `storage.objects` signed URL) becomes inaccessible upon deactivation.
  - Accessible Policy & Transparency Center (`/policies`, `src/app/policies/page.tsx`):
    - Versioned (`v1.4.0`), plain-language explanations of Privacy & Data Minimization, Terms of Use & Collaborative Licensing, Child & Teen Safety Architecture, Community Guidelines, AI Content Disclosure & Provenance, Reporting/Moderation/Appeals, and explicit pre-launch legal counsel review requirements.

## Important Technical Decisions
1. **Post-Aware Storage RLS**: Storage object read authorization directly references `public.posts`, `public.project_contributions`, and `public.collaborative_projects` in its policy subquery, automatically inheriting publication status, audience visibility, accepted follower checks, active contributor consent (`consent_granted = true AND consent_withdrawn_at IS NULL AND review_status <> 'withdrawn'`), completed project status, and bidirectional block/moderation barriers without duplicating logic.
2. **Short-Lived Signed Download URLs**: Signed download URLs use a default 300-second (5-minute) TTL to minimize the window where an unfollowed, blocked, or consent-withdrawn user could retain access via an already-issued stateless HMAC token.
3. **Storage Path Shielding**: `getPostAction`, `getProjectWorkspaceAction`, and `getProjectsAction` mask raw `media_path` and `output_media_path` values for clients, requiring all media playback to go through dedicated server actions (`getPostMediaUrlAction`, `getContributionMediaUrlAction`, `getProjectOutputMediaUrlAction`) that enforce session and project/post authorization.
4. **Deterministic Recommendation Rules**: Recommendation scoring is rule-based, transparent, and deterministic. No black-box ML or clickbait optimization. Safety filtering is strictly separated as an independent binary gate.
5. **Direct-to-Storage Media Abstraction**: Uploads use signed URLs directly to private storage (`media` bucket) without proxying media bytes through server runtimes. Strict prefix checking (`{userId}/{fileId}.{ext}`) prevents arbitrary path attachment or cross-user deletions.
6. **Mute Suppression is Application-Layer**: Mutes do not alter RLS — muted creator posts are readable at the DB layer. The `getFeedAction` and `getCommunityPostsAction` server actions filter them in JavaScript after the authenticated query. This is the correct boundary: mutes are a personal preference, not a security control, so RLS enforcement is not required.
7. **Trigger-Based Notification Generation & No Client Insert**: Direct inserts into `notifications` by client connections are prevented by withholding `INSERT` privileges from `authenticated`. All notifications are minted server-side via trusted `SECURITY DEFINER` triggers that enforce block checks, notification preferences, and deduplication atomically.
8. **Reliable Database Count Strategy (No Client Trust)**: Like counts are calculated strictly via database aggregation (`post_likes` grouping and `head: true` counts) at the server layer. Client requests cannot submit or increment counters directly. Concurrent and repeated requests are idempotent via PostgreSQL `UNIQUE (post_id, user_id)` and `onConflict` clauses.
9. **Elimination of Cross-Table RLS Recursion in Communities & Collaborative Projects**: Avoided infinite recursion between parent and membership tables by encapsulating membership and role lookups inside `SECURITY DEFINER` functions with fixed `search_path = ''` (`is_community_active_member`, `get_community_member_role`, `request_community_membership`, `is_project_active_participant`, `is_project_editor`, `can_view_project`). Collaborative project helpers are marked `VOLATILE` so `INSERT ... RETURNING` and multi-table trigger cascades always observe the latest command-counter snapshot within a transaction.
10. **Atomically Guaranteed Owner Membership**: Database triggers `handle_community_created()` and `handle_collaborative_project_created()` create the initial `owner` membership record atomically whenever a community or collaborative project is created.
11. **Scoped Community Moderation & Dual-Path Removal**: Community posts support author retraction via hard `DELETE` (enforced by `poster_id = auth.uid()`) and staff moderation via soft `UPDATE` (`removed_at`, `removed_by`, `removal_reason` guarded by `is_community_staff`). This preserves audit trails for moderation decisions while allowing authors full data sovereignty over their content.
12. **Polymorphic Content Reports with Explicit Foreign-Key Cascade Integrity**: Instead of relying on unvalidated polymorphic UUIDs that could dangle after target deletion, `content_reports` pairs `(target_type, target_id)` with dedicated nullable foreign key columns (`post_id`, `community_post_id`, `reported_profile_id`, `community_id` all `ON DELETE CASCADE`) enforced by `content_reports_target_ref_check` and populated by `handle_content_report_insert()`. This guarantees database-enforced target existence, self-report rejection, and automatic cleanup when targets are deleted.
13. **Tamper-Resistant Moderation Audit Log & Real-Time Expiration**: `moderation_actions` revokes `DELETE` privileges from client roles and enforces immutability on core audit columns via `handle_moderation_action_update()`. Temporary restrictions evaluate `expires_at > now()` directly inside `is_post_restricted`, `is_community_post_restricted`, and `is_account_restricted`, guaranteeing that expired restrictions never silently become permanent even without a background worker.
14. **Authoritative Render Manifests & Consent Race Protection**: Collaborative video render jobs (`project_render_jobs`) never trust client-supplied clip lists; `handle_project_render_job_insert()` snapshots only database-verified approved and consented clips into `input_manifest`. Using `pg_trigger_depth()`, direct client updates cannot forge `collaborative_projects.status = 'completed'` or `output_media_path`, whereas a contributor withdrawing consent automatically aborts active render jobs (`status = 'failed'`) and invalidates completed project outputs (`output_media_path = NULL`).
15. **Out-of-Band Two-Stage Canonical FFmpeg Concatenation**: To prevent request-thread starvation in Next.js server actions and avoid stream incompatibility across heterogeneous contributor clips, the dedicated render worker (`src/lib/collaboration/ffmpeg-worker.ts`) claims queued jobs via `FOR UPDATE SKIP LOCKED`, validates every source file with `ffprobe`, transcodes each clip to canonical `640x360 @ 24fps H.264 (yuv420p) + 44.1kHz stereo AAC`, and concatenates them with `-f concat -c copy -movflags +faststart`.
16. **Honest Content Authenticity Taxonomy & Edit-Invalidated Provenance**: Undeclared content (`not_declared` / `unverified`) is strictly distinguished from creator self-declarations (`no_ai_declared` / `creator_declared`) and staff/cryptographic verification (`machine_verified`). Editing a post's caption, media, or disclosure automatically downgrades `machine_verified` provenance so verified status can never persist across post-verification edits.
17. **Privacy-Safe Composite Video Provenance**: While `project_render_jobs.input_manifest` retains full clip references for authorized project participants, public/viewer-facing `output_provenance` aggregates only clip counts, sequence order, and disclosure statuses (`build_collaborative_output_provenance`), preserving transparency about stitched AI/altered segments without leaking contributor user IDs or private storage paths.
18. **Data-Minimized Age Safety & Deactivation-Triggered Consent Revocation**: Age-appropriate protections (`teen_13_17`) are enforced via PostgreSQL `CHECK` constraints and triggers without collecting or storing birth dates. Deactivating or deleting an account (`request_or_execute_account_deletion`) unpublishes posts so `posts` RLS does not need to join `public.profiles` (preserving visibility of public posts from private-profile creators), withdraws collaborative video consents to invalidate stitched outputs, and archives moderation records into `moderation_retention_ledger` using a salted hash without retaining personal identifiers.

## Known Limitations
- **External Zero-Knowledge Age Assurance Provider Dependency**: HIHA's `SelfAttestationAgeAdapter` records minimum-age self-attestation and enforces protective `teen_13_17` defaults without collecting birth dates, but self-attestation does not prove legal age. Jurisdictions requiring formal age verification must integrate a certified external provider implementing `AgeAssuranceProvider` (`src/lib/privacy/age-assurance.ts`).
- **Pre-Launch Legal Counsel Review**: The `/policies` page provides clear, versioned product explanations of HIHA's technical privacy, safety, AI-disclosure, and moderation controls, not formal legal advice. Qualified legal counsel must review jurisdictional compliance (COPPA, UK Age Appropriate Design Code, EU DSA/GDPR, statutory retention windows) prior to commercial launch.
- **Absence of Automated Deepfake / Synthetic Media Classifier**: HIHA does not claim to automatically detect AI-generated media or verify human authorship from raw pixels/audio. Disclosures rely on voluntary creator declarations (`creator_declared`) or explicit platform provenance checks (`machine_verified`), and undeclared content is transparently labeled as `Origin not declared` rather than verified human-created.
- **Irreversibility of Already-Downloaded Local Copies**: When a contributor withdraws consent (or deactivates/deletes their account) after a combined video has been rendered, HIHA immediately invalidates `collaborative_projects.output_media_path` and `output_provenance`, reverts the project status from `completed` to `open`, and revokes `storage.objects` read access so no new downloads or streams of the hosted output can occur. However, no technical system can retract copies of media that authorized viewers have already downloaded to their local devices prior to consent withdrawal.
- **Stateless Token Revocation Window**: While reducing signed URL TTL to 300 seconds drastically mitigates unauthorized exposure after a block, unfollow, content restriction, or consent withdrawal, presigned HMAC tokens cannot be immediately invalidated before their expiration timestamp without rotating the storage signing secret.
- **Upload-Time vs. Render-Time Binary Inspection**: Upload intent verifies file extensions, media type matching, and path structure, while Supabase Storage checks HTTP Content-Type and byte length. Full binary container, stream, codec, dimension, and duration verification via `ffprobe` is performed by the rendering worker when processing collaborative render jobs (`probeMediaFile` + `validateProbedClip`).
- **Dedicated Worker Process Deployment Requirement**: Because FFmpeg video transcoding is CPU- and I/O-intensive and uses native binaries (`ffmpeg`, `ffprobe`), production deployments must run the render worker (`npm run worker:render -- --poll`) in a dedicated container/worker instance (e.g., Cloud Run, ECS, Fly.io, or Railway worker) rather than relying solely on stateless serverless Edge/Lambda request handlers.
- **Feed Candidate Pool Cap**: Ranked feed modes (My Mix, Focus, Explore) fetch a bounded pool of 60 candidate posts per query before JS-layer scoring. This ensures consistent latency but means very large corpora may not surface all eligible posts in a single page.
- **Media URL Round-Trip**: Signed download URLs for media cards are fetched per-card via `getPostMediaUrlAction`. Each media card adds one server round-trip; a batch media URL endpoint would reduce latency for media-dense feeds.
- **Push & Webhook Delivery**: In-app notifications are supported; external delivery channels (push, email) are deferred to future infrastructure.
- **Counter Cache Optimization**: Accurate database aggregation is used directly. At very high write scale, a transactional counter cache column with throttled background reconciliation can be introduced without breaking the existing API contract.
- **Real-Time Community Chat**: Milestone 3.3B implements asynchronous post discussions, cross-posting, and scoped moderation feeds. Ephemeral/real-time chat websockets and live room streams are deferred to dedicated real-time milestones.
- **Single Appeal Per Enforcement Action**: Each `moderation_actions` record supports one appeal (`UNIQUE (action_id)`). Escalation tiers or multi-round arbitration are deferred to future governance milestones.

## Test Commands
- Run Unit & Local FFmpeg Worker Tests: `npm run test`
- Run Type Check: `npm run typecheck`
- Run Linter: `npm run lint`
- Run Production Build: `npm run build`
- Run Live Database & End-to-End FFmpeg Verification: `npx tsx scripts/verify-live-supabase.mts`
- Run Video Render Worker (Single Pass / Poll): `npm run worker:render -- --once` or `npm run worker:render -- --poll`
- Start Production Server: `npm run start`

## Production Readiness Audit (Milestone 4.5 — Read-Only Audit Recorded)
- **Verification Baseline at Audit Time**:
  - `npm run test`: 252/252 passed (23 test suites)
  - `npm run typecheck`: passed
  - `npm run lint`: passed
  - `npm run build`: passed
  - `npx tsx scripts/verify-live-supabase.mts`: 170/170 passed
- **P0 — Critical Launch Blockers Identified**:
  1. **Missing `media-src` in Content Security Policy blocks browser `<video>` / `<audio>` playback** (`src/lib/security.ts`, `src/components/feed/FeedMediaView.tsx`, `src/components/collaboration/CollaborateWorkspaceView.tsx`): `buildContentSecurityPolicy()` sets `default-src 'self'` and `img-src 'self' blob: data: https:`, omitting `media-src`. Browsers fall back to `default-src 'self'` for `<video>` elements, blocking signed Supabase Storage playback URLs (`https://<project>.supabase.co/storage/v1/object/sign/media/...`) and `blob:` previews.
  2. **Render Worker Multi-Tenant Authorization Failure & Dev Credential Fallback** (`scripts/run-render-worker.mts`, `supabase/migrations/20261010020200_add_render_worker_claim_and_cancellation_guards.sql`, `supabase/migrations/20261010020000_create_collaborative_projects_and_stitching.sql`): `scripts/run-render-worker.mts` falls back to hardcoded test credentials (`test_user_a@hiha.internal` / `ValidPassword123!`) when `RENDER_WORKER_EMAIL` / `RENDER_WORKER_PASSWORD` are unset. More critically, `claim_project_render_job` (`SECURITY INVOKER`) and `project_render_jobs_update_policy` require `public.is_project_editor(project_id, auth.uid())`, meaning a single worker account can only claim and complete render jobs for projects where that specific account is an active owner/editor; jobs queued by any other platform user cannot be claimed (`0 rows`).
  3. **`permanent_delete` Account Mode Leaves `auth.users` Credentials and Private Storage Blobs Intact** (`src/app/actions/privacy.ts`, `supabase/migrations/20261010040000_add_privacy_child_safety_and_data_controls.sql`): `request_or_execute_account_deletion` executes identical SQL for `deactivate_and_scrub` and `permanent_delete`, and `deleteOrDeactivateAccountAction` deletes rows in `posts`, `post_likes`, `follows`, `mutes`, and `user_interests` without deleting private files in `storage.objects` (`media` bucket `{userId}/*`) or removing the `auth.users` account record.
- **P1 — High-Priority Issues Identified**:
  1. **Orphaned Storage Blobs on Account Deactivation/Deletion & Consent Withdrawal** (`src/app/actions/privacy.ts`, `supabase/migrations/20261010020000_create_collaborative_projects_and_stitching.sql`): Direct `DELETE FROM public.posts` and trigger-driven `output_media_path = NULL` updates revoke RLS access to media paths but leave raw media objects stored in `storage.objects`.
  2. **No Stale-Job Reaper for Stuck `'processing'` Render Jobs After Worker Crash/SIGKILL** (`supabase/migrations/20261010020200_add_render_worker_claim_and_cancellation_guards.sql`, `src/app/actions/collaboration.ts`): `claim_project_render_job` only claims `status = 'queued'` jobs, and `retryProjectRenderJobAction` only retries `status = 'failed'` jobs. If a worker process crashes (`SIGKILL`/OOM) after claiming a job, `project_render_jobs.status = 'processing'` and `collaborative_projects.status = 'rendering'` remain locked indefinitely unless a timeout reaper transitions stale `'processing'` jobs to `'failed'`.
  3. **Public/Anon `EXECUTE` Grants on 14 `SECURITY DEFINER` Functions (`get_advisors` security lints `0028` & `0029`)**: Live Supabase security advisor confirmed `anon` can execute trigger function `handle_community_created()` (missing `REVOKE ALL FROM PUBLIC, anon, authenticated`) and 13 `SECURITY DEFINER` helper functions (`can_join_public_community`, `can_request_community_membership`, `can_view_project`, `is_account_restricted`, `is_post_restricted`, `is_community_post_restricted`, `is_project_active_participant`, `is_project_editor`, etc.), allowing unauthenticated RPC probing of UUID restriction/membership states.
  4. **Inconsistent Deactivated-Account Write Guards Across Profile, Community, and Report Tables** (`src/app/actions/profile.ts`, `src/app/actions/communities.ts`, `src/app/actions/community-posts.ts`, `src/app/actions/reports.ts`): A deactivated user holding an existing session token can call `updateProfileAction` to overwrite `display_name = 'Deactivated Account'` without calling `reactivate_own_account`, and `communities`, `community_posts`, and `content_reports` lack `deactivated_at IS NOT NULL` write blocks.
  5. **Migration History Drift Between Local `supabase/migrations/` and Remote `supabase_migrations.schema_migrations`**: Local repository has 15 migration files (`20261009120000`–`20261010040000`), while `supabase_migrations.schema_migrations` on the live project records only 5 entries with MCP-generated timestamps (`20261012164206`–`20261013001918`).
  6. **Supabase Auth Leaked Password Protection Disabled (`auth_leaked_password_protection`)**: Compromised password checking against HaveIBeenPwned.org is currently disabled in Supabase Auth settings.
- **P2 — Important Improvements Identified**:
  1. **Rate-Limit Coverage & Ledger Pruning**: Extend rate limits beyond `posts`/`post_likes`/`community_posts` to cover `submitReportAction`, `submitModerationAppealAction`, `exportPersonalDataAction`, and follow requests, and add periodic TTL pruning for `public.rate_limit_events`.
  2. **In-Memory Counter Aggregation & Unbounded Export Queries**: Replace full-row fetches for like/member counting in `src/app/actions/feed.ts` and `src/app/actions/communities.ts` with SQL grouped counts, and bound `export_own_personal_data()` collections.
  3. **Database Performance Lints (`get_advisors`)**: Wrap bare `auth.uid()` in `(select auth.uid())` on `notifications` RLS policies (`0003_auth_rls_initplan`), consolidate permissive `SELECT` policies on `public.profiles` (`0006_multiple_permissive_policies`), and add covering indexes on foreign keys used in cascading deletes (`0001_unindexed_foreign_keys`).
  4. **Operational Health Check, Error Boundaries & Worker Telemetry**: Add `/api/health`, Next.js `src/app/error.tsx` / `src/app/global-error.tsx` boundaries, and structured JSON logging for worker jobs.
- **Unverified Deployment Assumptions (Explicitly Labeled)**:
  - **Target Hosting Topology**: Not yet provisioned in repository config (no `Dockerfile`, `fly.toml`, `railway.json`, or CI/CD workflow files exist). It is assumed that Next.js web serving and the long-running `npm run worker:render -- --poll` process will run in separate compute services or containers with local disk (`os.tmpdir()`) capacity >= 1 GB per concurrent job.
  - **Production Auth Email Delivery & Redirect URLs**: `resetPasswordAction` and `signUpAction` rely on `NEXT_PUBLIC_SITE_URL` (`http://localhost:3000` fallback) and custom SMTP configuration in Supabase Auth, which cannot be verified from repository code alone.
  - **Storage Backup & CDN Cache Eviction**: Supabase Storage physical backup retention windows after object deletion are governed by the hosting tier's infrastructure policies and have not been verified in production.

## Milestone 4.5 Remediation Progress
- **P0-1: Browser Media Content Security Policy (`src/lib/security.ts`, `tests/security.test.ts`)**:
  - Updated `buildContentSecurityPolicy()` to emit `media-src 'self' blob: https://*.supabase.co`, allowing browser `<video>` / `<audio>` elements to play signed Supabase Storage URLs and local `blob:` upload previews without falling back to `default-src 'self'`.
  - Preserved strict `script-src`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'self'` directives.
  - Added regression assertions in `tests/security.test.ts` (3 new tests). Note: real-browser (`<video>` element) playback remains unverified until an interactive/Playwright browser check is run.
- **P0-2: Secure Multi-User Render Worker (`supabase/migrations/20261013060000_secure_render_worker_authorization.sql`, `src/lib/collaboration/ffmpeg-worker.ts`, `scripts/run-render-worker.mts`, `src/lib/supabase/types.ts`, `tests/render-worker-security.test.ts`)**:
  - **Fail-Closed Worker Credential Handling**: Removed the hardcoded `"test_user_a@hiha.internal"` / `"ValidPassword123!"` fallback in `scripts/run-render-worker.mts`. Added `resolveWorkerRuntimeConfig()` in `src/lib/collaboration/ffmpeg-worker.ts` which requires explicit `RENDER_WORKER_EMAIL` (or `--email`) and `RENDER_WORKER_PASSWORD` (or `--password`) alongside valid Supabase URL/key configuration, failing closed with a non-secret error message when credentials are missing or invalid.
  - **Dedicated Least-Privilege Worker Authorization Model (`20261013060000_secure_render_worker_authorization.sql`)**:
    - Created `public.render_workers` (`user_id`, `worker_name`, `is_active`, `allow_user_uploads`) with RLS enabled and no client write grants, completely decoupled from `public.platform_staff`.
    - Added `claimed_by UUID` to `public.project_render_jobs` to bind active `'processing'` jobs to the specific worker identity that claimed them via `FOR UPDATE OF rj SKIP LOCKED`.
    - Added narrowly scoped `SECURITY DEFINER` helpers (`SET search_path = ''`, `REVOKE ALL FROM PUBLIC, anon`): `is_authorized_render_worker`, `is_dedicated_render_worker_only`, `is_worker_processing_project`, `is_contribution_in_active_worker_manifest`, `is_media_in_active_worker_manifest`, `is_canonical_render_output_path` (revoked from `PUBLIC, anon, authenticated` as an internal SQL helper), `is_active_project_participant_internal` (revoked from `PUBLIC, anon, authenticated` as an internal participant validator), `can_upload_render_output_object`, `can_cleanup_render_output_object`, and `fail_invalid_queued_render_job`.
    - **Caller-Identity Enforcement & Internal Participant Validation Separation (Finding 2 & Final Review)**:
      - Separated `public.is_active_project_participant_internal(p_id, u_id)` (`SECURITY DEFINER`, revoked from `PUBLIC, anon, authenticated`) from client/RLS-callable `public.is_project_active_participant(p_id, u_id)` (`SECURITY DEFINER`, granted to `authenticated`). Because PostgreSQL preserves session `auth.uid()` inside `SECURITY DEFINER` calls, `validate_render_job_manifest_integrity()` and `is_media_in_active_worker_manifest()` call `public.is_active_project_participant_internal(..., pc.contributor_id)` so a dedicated non-participant worker can validate contributor eligibility without failing caller-identity checks, while direct client/RLS calls to `public.is_project_active_participant(p_id, u_id)` enforce `NOT is_dedicated_render_worker_only(auth.uid())` and `(u_id = auth.uid() OR is_project_editor(p_id, auth.uid()))`.
      - Hardened `is_authorized_render_worker`, `is_dedicated_render_worker_only`, `is_worker_processing_project`, `is_contribution_in_active_worker_manifest`, `is_media_in_active_worker_manifest`, `can_upload_render_output_object`, `can_cleanup_render_output_object`, `can_view_project` (supporting both `anon` and `authenticated` via `u_id IS DISTINCT FROM (SELECT auth.uid())`), `is_project_editor`, and `is_project_active_participant` so authenticated callers cannot enumerate worker identities or probe arbitrary users/projects via RPC.
      - Kept `collaborative_projects_select_policy` (`TO PUBLIC`) calling only `public.can_view_project(id, (SELECT auth.uid()))` and moved `authenticated`-only creator/worker checks into `collaborative_projects_worker_select_policy` (`TO authenticated`) so `anon` queries on `collaborative_projects` never invoke functions revoked from `anon`.
    - **Explicit Audience-Verified Storage Media Read Policy (Finding 1)**: Replaced permissive `EXISTS` subqueries in `Users can read media objects` on `storage.objects` with explicit audience-authorization predicates for `public.posts` (`status = 'published'`, `NOT is_post_restricted`, active/unrestricted creator, `NOT is_blocked`, and `visibility = 'public'` or accepted `follows.status = 'accepted'` for `'followers'` posts), `public.project_contributions` (`can_view_project`, active consent, non-blocked, active/unrestricted contributor & project creator, and active participant check for pending clips), and `public.collaborative_projects` (`status = 'completed'`, `can_view_project`, non-blocked, active/unrestricted creator). Dedicated render workers (`is_dedicated_render_worker_only(auth.uid()) = true`) are excluded from all general user media/post/project read branches (`posts_exclude_dedicated_render_worker` restrictive policy and storage guard) and may read only media authorized by `is_media_in_active_worker_manifest`.
    - Scoped `storage.objects` `INSERT`/`DELETE`/`SELECT` and `handle_project_render_job_update()` so the worker can upload rendered outputs only to the canonical project owner path `{projectCreatorId}/stitched-{projectId}-{jobId}-{hex8}.mp4` (`buildCanonicalRenderOutputPath` / `isCanonicalRenderOutputPath`), while dedicated workers (`allow_user_uploads = false`) cannot upload arbitrary user media. Included `public.can_cleanup_render_output_object(storage.objects.name, (SELECT auth.uid()))` in `"Users can read media objects"` (`FOR SELECT` on `storage.objects`) so PostgreSQL `DELETE ... RETURNING *` via `supabase.storage.from('media').remove(...)` can locate and delete a staged canonical output object during rollback while the job is in `'processing'` or `'failed'` state.
    - Preserved project owner/editor retry (`failed -> queued`) while preventing non-editor workers from retrying failed jobs.
    - **Isolated Staging Database Verification (`hiha-staging-p02` / `jghaykojkdsslpqblrhy`)**:
      - Provisioned isolated staging database (`jghaykojkdsslpqblrhy`, PostgreSQL 17.11) and applied all 15 prerequisite migrations (`20261009120000`–`20261010040000`) plus `20261013060000_secure_render_worker_authorization.sql` in order with zero PostgreSQL errors.
      - Verified 10/10 end-to-end staging scenarios (`scripts/verify-p02-staging.mts`) against real PostgreSQL, Supabase Auth, Supabase Storage, and FFmpeg/ffprobe:
        1. Multi-user & private-project non-participant worker rendering (User A public project, User B public project, User A private invite-only project rendered by dedicated non-participant worker `render_worker_p02@hiha.internal` with `ffprobe` + RGB frame order verification).
        2. Manifest-only clip access, `RESTRICTIVE` `posts` denial (`0` rows), post media denial, pending/rejected/withdrawn/unrelated-project clip denial during `'processing'`, and immediate access revocation after job completion.
        3. Helper RPC anti-enumeration across all 10 `authenticated` helpers (`false` on cross-user/cross-worker UUIDs), `permission denied` on all 3 internal helpers (`is_active_project_participant_internal`, `validate_render_job_manifest_integrity`, `is_canonical_render_output_path`), and project-scoped editor participant checks.
        4. Unauthenticated (`anon`) public non-draft project read access (`can_view_project(id, NULL)`) and denial of private/draft projects and worker RPCs.
        5. Storage media privacy for posts (followers-only denied to non-followers & pending followers, allowed to accepted followers; draft/private denied to non-owners; blocked viewers denied).
        6. Storage media privacy for projects (private-project contribution & completed output media denied to non-participants and allowed to active participants; public-project pending clips denied to non-participants).
        7. Consent withdrawal, participant removal, owner-contributor block, contributor account deactivation (`request_or_execute_account_deletion`), mid-render project cancellation, and `input_manifest` tampering rejection with zero partial output exposure.
        8. Concurrent worker claim safety (`FOR UPDATE SKIP LOCKED` race between `render_worker_p02@hiha.internal` and `render_worker_p02b@hiha.internal`) and cross-worker isolation (non-claiming worker blocked from reading project, uploading output, or updating job).
        9. Canonical output path enforcement & rollback cleanup (`rollbackDeleted=1` for staged canonical output while blocking worker self-uploads, non-canonical paths, and mismatched job IDs).
        10. Ordinary user & project editor rejection on `claim_project_render_job`, `fail_invalid_queued_render_job`, and direct `'processing'`/`'completed'` transitions.
    - **Migration History Reconciliation Plan (Production `xkvgdnlwyirpjxtalbgr` Untouched)**:
      - Local `supabase/migrations/` contains 18 migration files (`20261009120000`–`20261013070000`); `supabase/config.toml` is not present locally.
      - Production `supabase_migrations.schema_migrations` (`xkvgdnlwyirpjxtalbgr`) currently records 5 MCP-applied versions (`20261012164206` through `20261013001918`), whose timestamps are lexicographically prior to `20261013060000`. Production also contains 2 unused legacy helper functions (`public.can_join_public_community`, `public.can_request_community_membership`) not referenced by any RLS policy.
      - Without modifying previously applied migration files (`20261009120000`–`20261010040000`):
        1. The new worker migration is chronologically timestamped after `20261013001918` (`20261013060000_secure_render_worker_authorization.sql`) and precedes P0-3 (`20261013070000_complete_permanent_account_deletion.sql`). Local history and remote history align sequentially.
        2. Optionally revoke/drop the 2 unused legacy functions (`can_join_public_community`, `can_request_community_membership`) in a dedicated cleanup migration after approval.
      - Production (`xkvgdnlwyirpjxtalbgr`) has NOT been modified and awaits explicit deployment approval.
- **P0-3: Complete Permanent Account Deletion (`supabase/migrations/20261013070000_complete_permanent_account_deletion.sql`, `src/lib/supabase/admin.ts`, `src/lib/storage/supabase-storage.ts`, `src/app/actions/privacy.ts`, `src/app/actions/collaboration.ts`, `src/components/privacy/PrivacySettingsView.tsx`, `scripts/verify-p03-staging.mts`)**:
  - **Approved Architecture & Data Lifecycle Decisions**:
    1. **Communities (Option 1B)**: Enforced manual ownership transfer before `permanent_delete` if the user owns a community with active non-owner members (`user_id <> owner_id AND status = 'active'`). Deletion preflight fails closed with error code `P0001` listing blocking communities. Solo-owned communities (where the deleting user is the sole member) are automatically deleted along with community rules, memberships, and community posts.
    2. **Collaborative Projects (Option 2A)**: Collaborative projects owned by the deleting account are permanently deleted, including project rows, render jobs, and contributions on those projects. Any rendered output binaries (`{creatorId}/stitched-...`) are deleted from Storage. Strictly preserved third-party contributors' source clips in their own `{contributorId}/*` folders in Supabase Storage.
    3. **Historical References (Option 3A)**: Changed `moderation_actions.actor_id` and `project_render_jobs.requested_by` from `NOT NULL ON DELETE RESTRICT` to nullable `ON DELETE SET NULL`. Updated triggers (`handle_project_participant_update`, `handle_project_contribution_update`, `handle_collaborative_project_update`, `handle_project_render_job_update`, `handle_moderation_action_update`, `handle_moderation_appeal_update`) to safely allow foreign-key nullification on cascade without failing or weakening core audit immutability. Moderation enforcement records are snapshotted into `public.moderation_retention_ledger` with salted hash `md5('hiha-audit-salt-v1:' || uid)` without retaining raw UUIDs or PII.
    4. **Strict Separation of Deactivation vs Permanent Deletion**:
       - `deactivate_and_scrub`: Unpublishes posts (`status = 'draft'`, `visibility = 'private'`, `caption = '[Content removed by account owner]'`), withdraws collaborative consents, cleans up invalidated output media binaries via Storage API, and **retains** the user's post rows and source media for account recovery/reactivation.
       - `permanent_delete`: Preflights communities, immediately locks down the account, inventories all user and project media paths, deletes user-owned media and invalidated output binaries via Storage API, cleans up database records via `finalize_permanent_account_deletion`, and permanently deletes `auth.users` row.
       - `reactivate_own_account`: Preserves protective private defaults, and strictly fails for permanently deleted accounts.
    5. **Server-Only Admin Client & Cross-User Storage Cleanup**: Implemented `src/lib/supabase/admin.ts` using `SUPABASE_SERVICE_ROLE_KEY` with strict runtime browser guards, URL validation, and known placeholder key rejection for admin auth and cross-user storage cleanup. Added `can_cleanup_invalidated_project_output_object` helper and updated Storage RLS delete policy on `storage.objects` to authorize deleting invalidated collaborative outputs.
  - **Isolated Staging Database Verification (`jghaykojkdsslpqblrhy`)**:
    - Applied forward migration `20261013070000_complete_permanent_account_deletion.sql` to staging database and recorded it in `supabase_migrations.schema_migrations`.
    - Executed all 14 required scenarios (`scripts/verify-p03-staging.mts`) with 100% pass:
      1. Community preflight blocks account deletion when other active members exist (`P0001` error).
      2. Solo-member community is deleted automatically without blocking account deletion.
      3. Owned collaborative project, render jobs, and contributions on that project are cleanly deleted.
      4. Other contributors' source clips in `{contributorId}/*` remain completely intact and downloadable.
      5. Historical references (`moderation_actions.actor_id` and `project_render_jobs.requested_by`) become `NULL` on user deletion without failing triggers.
      6. Moderation audit records snapshotted into `moderation_retention_ledger` with consistent ephemeral deletion identifier (`anon-del-<uuid>`, Option A) preserving intra-operation case clustering without linkability to subject UUIDs or rainbow-table susceptibility.
      7. `deactivate_and_scrub` hides posts and revokes consents while preserving user drafts and clips for recovery.
      8. Reactivation restores private profile for deactivated user with protective defaults.
      9. Reactivation is rejected for permanently deleted accounts (`Account profile not found`).
      10. Storage API deletes all user objects in `{userId}/*` and invalidated outputs.
      11. Storage RLS blocks non-owners from reading deactivated or deleted posts media.
      12. Storage RLS allows cleanup of invalidated project output objects via `can_cleanup_invalidated_project_output_object`.
      13. Full `auth.users` deletion cascades to `profiles` and invalidates auth tokens.
      14. Fault-injected Auth admin deletion recovery: account remains visibly incomplete and recoverable on retry; subsequent retry successfully purges `auth.users` and cascades `profiles`.

- **Latest Verification Results**:
  - `npm run test`: 272/272 passed (24 test suites)
  - `npm run typecheck`: passed (0 errors)
  - `npm run lint`: passed (0 errors, 0 warnings)
  - `npm run build`: passed (all 19 routes generated)
  - `npx tsx scripts/verify-p02-staging.mts`: 10/10 scenarios passed against isolated staging database (`jghaykojkdsslpqblrhy`)
  - `npx tsx scripts/verify-p03-staging.mts`: 14/14 scenarios passed against isolated staging database (`jghaykojkdsslpqblrhy`)
  - `npx tsx scripts/verify-live-supabase.mts`: 174/174 passed against live database schema (`xkvgdnlwyirpjxtalbgr`)

- **Milestone 4.5 — Full Browser E2E Verification & Screenshot Evidence Reconciliation (`artifacts/browser-audit/2026-10-13_15-02-09`)**:
  - **Reconciled Discrepancy Investigation**:
    - Reconciled all 4 reported user observations where prior audit screenshots contradicted reported results:
      1. *Notifications*: Prior screenshot showed red error banner `"Something went wrong loading notifications. Please refresh."`
      2. *Moderation Queue*: Prior screenshot showed red error banner `"Unable to load moderation queue."`
      3. *Communities Catalog*: Prior screenshot showed red error banner `"Unable to load communities. Please refresh or try again later."`
      4. *Personalized Feed*: Multiple prior screenshots showed red error banner `"Something went wrong loading your feed. Please try again."` or captured `.animate-pulse` skeletons mid-transition.
  - **Identified Root Causes**:
    1. *PostgREST Schema Cache Embedded Join Failure*: Foreign keys on `posts.creator_id`, `communities.owner_id`, `notifications.actor_id`, and `content_reports.reporter_id` originally referenced `auth.users(id)` instead of `public.profiles(id)`. PostgREST rejected embedded resource queries (`creator:profiles!posts_creator_id_fkey`, `owner:profiles!...`, `actor:profiles!...`, `reporter:profiles!...`) with schema cache lookup errors, triggering catch blocks and red error banners across the UI.
    2. *Shallow Test Assertions*: Prior assertions for `COMM-001`, `MOD-002`, `INTERACT-002`, and `FEED-001..005` checked only static headings (`h1:has-text('Communities')`), container tabs, or unconditionally marked `PASS` without verifying the absence of `.bg-red-50` error banners or presence of loaded content cards.
    3. *Asynchronous Tab Switching & Playwright Race Conditions*: Mode tab switching in `FeedList.tsx` did not synchronize with the Next.js Server Action POST response, causing Playwright to capture screenshots while `.animate-pulse` skeletons were still pulsating.
    4. *Empty Synthetic Account Data*: Fresh test accounts lacked social graph connections, category interests, published articles, notifications, or moderation reports, resulting in empty states.
  - **Remediation & Hardening on Isolated Staging (`jghaykojkdsslpqblrhy`)**:
    1. *Database Constraints & Schema Cache*: Repointed foreign key constraints to `public.profiles(id)` on staging and reloaded the PostgREST schema cache (`NOTIFY pgrst, 'reload schema'`). Embedded queries now resolve cleanly.
    2. *Hardened Assertions*: Updated `scripts/run-browser-audit.mts` to strictly assert `!page.locator(".bg-red-50").isVisible()`, wait for `.animate-pulse.first()` to detach, and assert actual content cards are loaded.
    3. *Server Action Synchronization*: Added `page.waitForResponse` synchronized with tab clicks and awaited skeleton detachment before taking screenshots.
    4. *Realistic Synthetic Data*: Staged User A interests (AI & Programming), User A following User B, published educational posts from User B, unread notifications for User A, and open moderation reports for platform staff.
  - **Audit Deliverables & Final Results**:
    - **Total Tests Planned**: 57
    - **Passed**: 57 (100.0%)
    - **Failed**: 0 (0.0%)
    - **Severity Findings**: P0: 0, P1: 0, P2: 0, P3: 0
    - **Screenshots**: 57 clean full-page evidence screenshots captured in real Playwright Chromium sessions (zero error banners, zero skeleton mid-states).
    - **Artifacts Generated**: `REPORT.md`, `test-matrix.csv`, `test-results.json`, `reproduction-steps.md`, `screenshots/` (57 images), `traces/`, `logs/`.
    - **Codebase Checks**: `npm run test` (272/272 passed), `npm run typecheck` (passed), `npm run lint` (passed), `npm run build` (all 19 routes compiled).
    - **Production Safety Boundary**: Production (`xkvgdnlwyirpjxtalbgr`) remains strictly untouched and unreferenced.

## Production Migration Reconciliation & Deployment (Milestone 4.5)
- **Deployment Status**: **Successfully Reconciled & Deployed to Production (`xkvgdnlwyirpjxtalbgr`)**
- **Pre-Deployment Backup**: Complete data snapshot preserved in `backups/production-pre-reconciliation-snapshot-20261014.json` (gitignored, 0 secrets).
- **Execution Details**:
  1. **Phase 0 — Baseline Migration Ledger Reconciliation (Zero DDL)**:
     - Formally recorded missing foundational migrations 1–11 and intermediate migrations 12–16 into `supabase_migrations.schema_migrations`.
     - Eliminated risk of out-of-order execution or duplicate relation creation.
  2. **Checkpoint 1 — PostgREST Profile Foreign-Key Alignment (`20261013050000_align_postgrest_profile_foreign_keys.sql`)**:
     - Retargeted foreign keys on `posts.creator_id`, `communities.owner_id`, `notifications.actor_id`, and `content_reports.reporter_id` to `public.profiles(id)`.
     - Verified with zero orphan records; PostgREST schema cache reloaded via `NOTIFY pgrst, 'reload schema'`.
     - Live REST verification: `GET /rest/v1/posts?select=...,creator:profiles!...` returned HTTP 200 with embedded author details.
  3. **Checkpoint 2 — Least-Privilege Render Worker Authorization (`20261013060000_secure_render_worker_authorization.sql`)**:
     - Created `public.render_workers` table, added `claimed_by UUID` to `project_render_jobs`, created partial index `idx_project_render_jobs_claimed_processing`.
     - Deployed worker authorization RPCs (`claim_project_render_job`, `is_authorized_render_worker`, `is_dedicated_render_worker_only`).
  4. **Checkpoint 3 — Complete Permanent Account Deletion Lifecycle (`20261013070000_complete_permanent_account_deletion.sql`)**:
     - Added durable lifecycle tracking columns `deletion_status` and `deletion_requested_at` to `public.profiles`.
     - Nullified blocking foreign keys on `project_render_jobs.requested_by` and `moderation_actions.actor_id` (`ON DELETE SET NULL`).
     - Deployed `request_or_execute_account_deletion` (Option 1B community preflight, Option A random audit tokens) and `finalize_permanent_account_deletion`.
  5. **Verification & Quality Gate**:
     - `npm run test`: 272/272 passing (24 test suites).
     - `npm run typecheck`: clean (0 errors).
     - `npm run lint`: clean (0 errors).
     - `npm run build`: clean (19/19 routes compiled).
     - Supabase Advisors: 0 critical errors.



