export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          bio: string | null;
          avatar_url: string | null;
          is_private: boolean;
          discoverable_in_search: boolean;
          follow_permission: "everyone" | "approval_required" | "nobody";
          interaction_permission: "everyone" | "followers_only" | "nobody";
          default_post_visibility: "public" | "followers" | "private";
          notify_on_follow_request: boolean;
          notify_on_new_follower: boolean;
          notify_on_follow_accepted: boolean;
          age_safety_mode: "standard" | "teen_13_17";
          minimum_age_attested_at: string | null;
          age_assurance_status: "unverified" | "self_attested" | "provider_verified";
          privacy_policy_version: string;
          deactivated_at: string | null;
          deletion_status: "active" | "deactivated" | "deletion_pending" | "permanently_deleted";
          deletion_requested_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          bio?: string | null;
          avatar_url?: string | null;
          is_private?: boolean;
          discoverable_in_search?: boolean;
          follow_permission?: "everyone" | "approval_required" | "nobody";
          interaction_permission?: "everyone" | "followers_only" | "nobody";
          default_post_visibility?: "public" | "followers" | "private";
          notify_on_follow_request?: boolean;
          notify_on_new_follower?: boolean;
          notify_on_follow_accepted?: boolean;
          age_safety_mode?: "standard" | "teen_13_17";
          minimum_age_attested_at?: string | null;
          age_assurance_status?: "unverified" | "self_attested" | "provider_verified";
          privacy_policy_version?: string;
          deactivated_at?: string | null;
          deletion_status?: "active" | "deactivated" | "deletion_pending" | "permanently_deleted";
          deletion_requested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          bio?: string | null;
          avatar_url?: string | null;
          is_private?: boolean;
          discoverable_in_search?: boolean;
          follow_permission?: "everyone" | "approval_required" | "nobody";
          interaction_permission?: "everyone" | "followers_only" | "nobody";
          default_post_visibility?: "public" | "followers" | "private";
          notify_on_follow_request?: boolean;
          notify_on_new_follower?: boolean;
          notify_on_follow_accepted?: boolean;
          age_safety_mode?: "standard" | "teen_13_17";
          minimum_age_attested_at?: string | null;
          age_assurance_status?: "unverified" | "self_attested" | "provider_verified";
          privacy_policy_version?: string;
          deactivated_at?: string | null;
          deletion_status?: "active" | "deactivated" | "deletion_pending" | "permanently_deleted";
          deletion_requested_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      interests: {
        Row: {
          id: string;
          slug: string;
          name: string;
          category: string;
          description: string | null;
          is_custom: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          category: string;
          description?: string | null;
          is_custom?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: string;
          category?: string;
          description?: string | null;
          is_custom?: boolean;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      user_interests: {
        Row: {
          id: string;
          user_id: string;
          interest_id: string;
          priority: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          interest_id: string;
          priority?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          interest_id?: string;
          priority?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_interests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_interests_interest_id_fkey";
            columns: ["interest_id"];
            isOneToOne: false;
            referencedRelation: "interests";
            referencedColumns: ["id"];
          },
        ];
      };
      follows: {
        Row: {
          id: string;
          follower_id: string;
          following_id: string;
          status: "pending" | "accepted";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          follower_id: string;
          following_id: string;
          status?: "pending" | "accepted";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          follower_id?: string;
          following_id?: string;
          status?: "pending" | "accepted";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follows_following_id_fkey";
            columns: ["following_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      blocks: {
        Row: {
          id: string;
          blocker_id: string;
          blocked_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          blocker_id: string;
          blocked_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          blocker_id?: string;
          blocked_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      mutes: {
        Row: {
          id: string;
          muter_id: string;
          muted_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          muter_id: string;
          muted_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          muter_id?: string;
          muted_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mutes_muter_id_fkey";
            columns: ["muter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mutes_muted_id_fkey";
            columns: ["muted_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          id: string;
          creator_id: string;
          content_type: "text" | "image" | "short_video" | "long_video";
          caption: string | null;
          media_path: string | null;
          media_metadata: Json | null;
          status: "draft" | "published";
          visibility: "public" | "followers" | "private";
          category: string | null;
          ai_disclosure_status:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details: string | null;
          ai_disclosed_at: string | null;
          provenance_status: "unverified" | "creator_declared" | "machine_verified";
          provenance_verified_at: string | null;
          created_at: string;
          updated_at: string;
          published_at: string | null;
        };
        Insert: {
          id?: string;
          creator_id: string;
          content_type: "text" | "image" | "short_video" | "long_video";
          caption?: string | null;
          media_path?: string | null;
          media_metadata?: Json | null;
          status?: "draft" | "published";
          visibility?: "public" | "followers" | "private";
          category?: string | null;
          ai_disclosure_status?:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details?: string | null;
          ai_disclosed_at?: string | null;
          provenance_status?: "unverified" | "creator_declared" | "machine_verified";
          provenance_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
        };
        Update: {
          id?: string;
          creator_id?: string;
          content_type?: "text" | "image" | "short_video" | "long_video";
          caption?: string | null;
          media_path?: string | null;
          media_metadata?: Json | null;
          status?: "draft" | "published";
          visibility?: "public" | "followers" | "private";
          category?: string | null;
          ai_disclosure_status?:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details?: string | null;
          ai_disclosed_at?: string | null;
          provenance_status?: "unverified" | "creator_declared" | "machine_verified";
          provenance_verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
          published_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "posts_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      post_interests: {
        Row: {
          id: string;
          post_id: string;
          interest_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          interest_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          interest_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_interests_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_interests_interest_id_fkey";
            columns: ["interest_id"];
            isOneToOne: false;
            referencedRelation: "interests";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          recipient_id: string;
          actor_id: string | null;
          type: "follow_request" | "follow_accepted" | "new_follower";
          follow_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          recipient_id: string;
          actor_id?: string | null;
          type: "follow_request" | "follow_accepted" | "new_follower";
          follow_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          recipient_id?: string;
          actor_id?: string | null;
          type?: "follow_request" | "follow_accepted" | "new_follower";
          follow_id?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_follow_id_fkey";
            columns: ["follow_id"];
            isOneToOne: false;
            referencedRelation: "follows";
            referencedColumns: ["id"];
          },
        ];
      };
      post_likes: {
        Row: {
          id: string;
          post_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          post_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          post_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "post_likes_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "post_likes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      communities: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          slug: string;
          description: string | null;
          visibility: "public" | "private";
          interest_id: string | null;
          category: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          slug: string;
          description?: string | null;
          visibility?: "public" | "private";
          interest_id?: string | null;
          category?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          visibility?: "public" | "private";
          interest_id?: string | null;
          category?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "communities_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "communities_interest_id_fkey";
            columns: ["interest_id"];
            isOneToOne: false;
            referencedRelation: "interests";
            referencedColumns: ["id"];
          },
        ];
      };
      community_members: {
        Row: {
          id: string;
          community_id: string;
          user_id: string;
          role: "owner" | "moderator" | "member";
          status: "active" | "pending" | "rejected" | "banned";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          community_id: string;
          user_id: string;
          role?: "owner" | "moderator" | "member";
          status?: "active" | "pending" | "rejected" | "banned";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          community_id?: string;
          user_id?: string;
          role?: "owner" | "moderator" | "member";
          status?: "active" | "pending" | "rejected" | "banned";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_members_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      community_posts: {
        Row: {
          id: string;
          community_id: string;
          post_id: string;
          poster_id: string;
          pinned_at: string | null;
          removed_at: string | null;
          removed_by: string | null;
          removal_reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          community_id: string;
          post_id: string;
          poster_id: string;
          pinned_at?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          removal_reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          community_id?: string;
          post_id?: string;
          poster_id?: string;
          pinned_at?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          removal_reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "community_posts_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_posts_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "community_posts_poster_id_fkey";
            columns: ["poster_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_staff: {
        Row: {
          user_id: string;
          role: "admin" | "moderator";
          created_at: string;
        };
        Insert: {
          user_id: string;
          role?: "admin" | "moderator";
          created_at?: string;
        };
        Update: {
          user_id?: string;
          role?: "admin" | "moderator";
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_staff_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      content_reports: {
        Row: {
          id: string;
          reporter_id: string;
          target_type: "post" | "community_post" | "profile";
          target_id: string;
          post_id: string | null;
          community_post_id: string | null;
          reported_profile_id: string | null;
          community_id: string | null;
          reason: "spam" | "harassment" | "hate_speech" | "misinformation" | "violence" | "copyright" | "other";
          details: string | null;
          status: "open" | "in_review" | "resolved" | "dismissed";
          reviewer_id: string | null;
          reviewed_at: string | null;
          resolution_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          target_type: "post" | "community_post" | "profile";
          target_id: string;
          post_id?: string | null;
          community_post_id?: string | null;
          reported_profile_id?: string | null;
          community_id?: string | null;
          reason: "spam" | "harassment" | "hate_speech" | "misinformation" | "violence" | "copyright" | "other";
          details?: string | null;
          status?: "open" | "in_review" | "resolved" | "dismissed";
          reviewer_id?: string | null;
          reviewed_at?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          target_type?: "post" | "community_post" | "profile";
          target_id?: string;
          post_id?: string | null;
          community_post_id?: string | null;
          reported_profile_id?: string | null;
          community_id?: string | null;
          reason?: "spam" | "harassment" | "hate_speech" | "misinformation" | "violence" | "copyright" | "other";
          details?: string | null;
          status?: "open" | "in_review" | "resolved" | "dismissed";
          reviewer_id?: string | null;
          reviewed_at?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_community_post_id_fkey";
            columns: ["community_post_id"];
            isOneToOne: false;
            referencedRelation: "community_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_reported_profile_id_fkey";
            columns: ["reported_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_reports_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_actions: {
        Row: {
          id: string;
          actor_id: string | null;
          target_user_id: string;
          target_type: "post" | "community_post" | "profile";
          target_id: string;
          post_id: string | null;
          community_post_id: string | null;
          reported_profile_id: string | null;
          community_id: string | null;
          report_id: string | null;
          action_type: "warning" | "content_restriction" | "account_restriction";
          reason: string;
          duration_hours: number | null;
          expires_at: string | null;
          status: "active" | "reversed" | "expired";
          reversed_at: string | null;
          reversed_by: string | null;
          reversal_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          target_user_id: string;
          target_type: "post" | "community_post" | "profile";
          target_id: string;
          post_id?: string | null;
          community_post_id?: string | null;
          reported_profile_id?: string | null;
          community_id?: string | null;
          report_id?: string | null;
          action_type: "warning" | "content_restriction" | "account_restriction";
          reason: string;
          duration_hours?: number | null;
          expires_at?: string | null;
          status?: "active" | "reversed" | "expired";
          reversed_at?: string | null;
          reversed_by?: string | null;
          reversal_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          target_user_id?: string;
          target_type?: "post" | "community_post" | "profile";
          target_id?: string;
          post_id?: string | null;
          community_post_id?: string | null;
          reported_profile_id?: string | null;
          community_id?: string | null;
          report_id?: string | null;
          action_type?: "warning" | "content_restriction" | "account_restriction";
          reason?: string;
          duration_hours?: number | null;
          expires_at?: string | null;
          status?: "active" | "reversed" | "expired";
          reversed_at?: string | null;
          reversed_by?: string | null;
          reversal_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_actions_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_target_user_id_fkey";
            columns: ["target_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_community_post_id_fkey";
            columns: ["community_post_id"];
            isOneToOne: false;
            referencedRelation: "community_posts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_reported_profile_id_fkey";
            columns: ["reported_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "content_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_appeals: {
        Row: {
          id: string;
          moderation_action_id: string;
          appellant_id: string;
          reason: string;
          status: "pending" | "under_review" | "approved" | "rejected";
          reviewer_id: string | null;
          reviewed_at: string | null;
          resolution_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          moderation_action_id: string;
          appellant_id: string;
          reason: string;
          status?: "pending" | "under_review" | "approved" | "rejected";
          reviewer_id?: string | null;
          reviewed_at?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          moderation_action_id?: string;
          appellant_id?: string;
          reason?: string;
          status?: "pending" | "under_review" | "approved" | "rejected";
          reviewer_id?: string | null;
          reviewed_at?: string | null;
          resolution_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_appeals_moderation_action_id_fkey";
            columns: ["moderation_action_id"];
            isOneToOne: true;
            referencedRelation: "moderation_actions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_appeals_appellant_id_fkey";
            columns: ["appellant_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      collaborative_projects: {
        Row: {
          id: string;
          creator_id: string;
          community_id: string | null;
          title: string;
          description: string | null;
          status: "draft" | "open" | "locked" | "rendering" | "completed" | "cancelled";
          visibility: "public" | "private";
          participation_mode: "open" | "invite_only";
          consent_policy_version: string;
          output_media_path: string | null;
          output_provenance: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          community_id?: string | null;
          title: string;
          description?: string | null;
          status?: "draft" | "open" | "locked" | "rendering" | "completed" | "cancelled";
          visibility?: "public" | "private";
          participation_mode?: "open" | "invite_only";
          consent_policy_version?: string;
          output_media_path?: string | null;
          output_provenance?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          creator_id?: string;
          community_id?: string | null;
          title?: string;
          description?: string | null;
          status?: "draft" | "open" | "locked" | "rendering" | "completed" | "cancelled";
          visibility?: "public" | "private";
          participation_mode?: "open" | "invite_only";
          consent_policy_version?: string;
          output_media_path?: string | null;
          output_provenance?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collaborative_projects_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collaborative_projects_community_id_fkey";
            columns: ["community_id"];
            isOneToOne: false;
            referencedRelation: "communities";
            referencedColumns: ["id"];
          },
        ];
      };
      project_participants: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          role: "owner" | "editor" | "contributor";
          status: "invited" | "requested" | "active" | "declined" | "removed";
          invited_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          role?: "owner" | "editor" | "contributor";
          status?: "invited" | "requested" | "active" | "declined" | "removed";
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          role?: "owner" | "editor" | "contributor";
          status?: "invited" | "requested" | "active" | "declined" | "removed";
          invited_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_participants_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "collaborative_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_participants_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      project_contributions: {
        Row: {
          id: string;
          project_id: string;
          contributor_id: string;
          source_post_id: string | null;
          media_path: string;
          media_type: "short_video" | "long_video";
          media_metadata: {
            mimeType: string;
            sizeBytes: number;
            width?: number;
            height?: number;
            durationSeconds?: number;
          };
          caption: string | null;
          ai_disclosure_status:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details: string | null;
          ai_disclosed_at: string | null;
          provenance_status: "unverified" | "creator_declared" | "machine_verified";
          consent_granted: boolean;
          consent_granted_at: string | null;
          consent_policy_version: string;
          consent_withdrawn_at: string | null;
          withdrawal_reason: string | null;
          review_status: "pending" | "approved" | "rejected" | "withdrawn";
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          sequence_order: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          contributor_id: string;
          source_post_id?: string | null;
          media_path: string;
          media_type?: "short_video" | "long_video";
          media_metadata: {
            mimeType: string;
            sizeBytes: number;
            width?: number;
            height?: number;
            durationSeconds?: number;
          };
          caption?: string | null;
          ai_disclosure_status?:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details?: string | null;
          ai_disclosed_at?: string | null;
          provenance_status?: "unverified" | "creator_declared" | "machine_verified";
          consent_granted: boolean;
          consent_granted_at?: string | null;
          consent_policy_version: string;
          consent_withdrawn_at?: string | null;
          withdrawal_reason?: string | null;
          review_status?: "pending" | "approved" | "rejected" | "withdrawn";
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          sequence_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          contributor_id?: string;
          source_post_id?: string | null;
          media_path?: string;
          media_type?: "short_video" | "long_video";
          media_metadata?: {
            mimeType: string;
            sizeBytes: number;
            width?: number;
            height?: number;
            durationSeconds?: number;
          };
          caption?: string | null;
          ai_disclosure_status?:
            | "not_declared"
            | "no_ai_declared"
            | "ai_generated"
            | "ai_assisted"
            | "material_alteration";
          ai_disclosure_details?: string | null;
          ai_disclosed_at?: string | null;
          provenance_status?: "unverified" | "creator_declared" | "machine_verified";
          consent_granted?: boolean;
          consent_granted_at?: string | null;
          consent_policy_version?: string;
          consent_withdrawn_at?: string | null;
          withdrawal_reason?: string | null;
          review_status?: "pending" | "approved" | "rejected" | "withdrawn";
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          sequence_order?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_contributions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "collaborative_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_contributions_contributor_id_fkey";
            columns: ["contributor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_contributions_source_post_id_fkey";
            columns: ["source_post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      project_render_jobs: {
        Row: {
          id: string;
          project_id: string;
          requested_by: string | null;
          idempotency_key: string;
          status: "queued" | "processing" | "completed" | "failed";
          input_manifest: Array<{
            contribution_id: string;
            contributor_id: string;
            media_path: string;
            media_type: "short_video" | "long_video";
            sequence_order: number;
            consent_granted_at: string;
            consent_policy_version: string;
            ai_disclosure_status?:
              | "not_declared"
              | "no_ai_declared"
              | "ai_generated"
              | "ai_assisted"
              | "material_alteration";
          }>;
          output_media_path: string | null;
          output_provenance: Json | null;
          claimed_by?: string | null;
          attempt_count: number;
          max_attempts: number;
          timeout_seconds: number;
          failure_reason: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          requested_by?: string | null;
          idempotency_key: string;
          status?: "queued" | "processing" | "completed" | "failed";
          input_manifest?: Array<{
            contribution_id: string;
            contributor_id: string;
            media_path: string;
            media_type: "short_video" | "long_video";
            sequence_order: number;
            consent_granted_at: string;
            consent_policy_version: string;
            ai_disclosure_status?:
              | "not_declared"
              | "no_ai_declared"
              | "ai_generated"
              | "ai_assisted"
              | "material_alteration";
          }>;
          output_media_path?: string | null;
          output_provenance?: Json | null;
          claimed_by?: string | null;
          attempt_count?: number;
          max_attempts?: number;
          timeout_seconds?: number;
          failure_reason?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          requested_by?: string | null;
          idempotency_key?: string;
          status?: "queued" | "processing" | "completed" | "failed";
          input_manifest?: Array<{
            contribution_id: string;
            contributor_id: string;
            media_path: string;
            media_type: "short_video" | "long_video";
            sequence_order: number;
            consent_granted_at: string;
            consent_policy_version: string;
            ai_disclosure_status?:
              | "not_declared"
              | "no_ai_declared"
              | "ai_generated"
              | "ai_assisted"
              | "material_alteration";
          }>;
          output_media_path?: string | null;
          output_provenance?: Json | null;
          claimed_by?: string | null;
          attempt_count?: number;
          max_attempts?: number;
          timeout_seconds?: number;
          failure_reason?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_render_jobs_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "collaborative_projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_render_jobs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "project_render_jobs_claimed_by_fkey";
            columns: ["claimed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      render_workers: {
        Row: {
          user_id: string;
          worker_name: string;
          is_active: boolean;
          allow_user_uploads: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          worker_name?: string;
          is_active?: boolean;
          allow_user_uploads?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          worker_name?: string;
          is_active?: boolean;
          allow_user_uploads?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "render_workers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_events: {
        Row: {
          id: string;
          user_id: string;
          action_type: "like_post" | "create_post" | "share_community_post";
          target_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          action_type: "like_post" | "create_post" | "share_community_post";
          target_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          action_type?: "like_post" | "create_post" | "share_community_post";
          target_key?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rate_limit_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_retention_ledger: {
        Row: {
          id: string;
          original_action_id: string;
          subject_user_hash: string;
          action_type: "warning" | "content_restriction" | "account_restriction";
          target_type: "post" | "community_post" | "profile";
          reason: string;
          status: string;
          duration_hours: number | null;
          expires_at: string | null;
          original_created_at: string;
          retained_at: string;
          retention_reason: string;
        };
        Insert: {
          id?: string;
          original_action_id: string;
          subject_user_hash: string;
          action_type: "warning" | "content_restriction" | "account_restriction";
          target_type: "post" | "community_post" | "profile";
          reason: string;
          status: string;
          duration_hours?: number | null;
          expires_at?: string | null;
          original_created_at: string;
          retained_at?: string;
          retention_reason?: string;
        };
        Update: {
          id?: string;
          original_action_id?: string;
          subject_user_hash?: string;
          action_type?: "warning" | "content_restriction" | "account_restriction";
          target_type?: "post" | "community_post" | "profile";
          reason?: string;
          status?: string;
          duration_hours?: number | null;
          expires_at?: string | null;
          original_created_at?: string;
          retained_at?: string;
          retention_reason?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_blocked: {
        Args: { user_a: string; user_b: string };
        Returns: boolean;
      };
      is_community_active_member: {
        Args: { c_id: string; u_id: string };
        Returns: boolean;
      };
      get_community_member_role: {
        Args: { c_id: string; u_id: string };
        Returns: string | null;
      };
      is_community_staff: {
        Args: { c_id: string; u_id: string };
        Returns: boolean;
      };
      is_platform_staff: {
        Args: { u_id: string };
        Returns: boolean;
      };
      is_post_restricted: {
        Args: { p_id: string };
        Returns: boolean;
      };
      is_community_post_restricted: {
        Args: { cp_id: string };
        Returns: boolean;
      };
      is_account_restricted: {
        Args: { u_id: string };
        Returns: boolean;
      };
      is_project_active_participant: {
        Args: { p_id: string; u_id: string };
        Returns: boolean;
      };
      is_project_editor: {
        Args: { p_id: string; u_id: string };
        Returns: boolean;
      };
      can_view_project: {
        Args: { p_id: string; u_id: string };
        Returns: boolean;
      };
      is_authorized_render_worker: {
        Args: { u_id: string };
        Returns: boolean;
      };
      is_dedicated_render_worker_only: {
        Args: { u_id: string };
        Returns: boolean;
      };
      is_worker_processing_project: {
        Args: { p_project_id: string; p_worker_id: string };
        Returns: boolean;
      };
      is_contribution_in_active_worker_manifest: {
        Args: {
          p_project_id: string;
          p_contribution_id: string;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      is_media_in_active_worker_manifest: {
        Args: { p_media_path: string; p_worker_id: string };
        Returns: boolean;
      };
      can_upload_render_output_object: {
        Args: { p_object_name: string; p_worker_id: string };
        Returns: boolean;
      };
      can_cleanup_render_output_object: {
        Args: { p_object_name: string; p_worker_id: string };
        Returns: boolean;
      };
      claim_project_render_job: {
        Args: { p_job_id?: string | null };
        Returns: Array<Database["public"]["Tables"]["project_render_jobs"]["Row"]>;
      };
      fail_invalid_queued_render_job: {
        Args: { p_job_id: string; p_failure_reason?: string | null };
        Returns: boolean;
      };
      issue_post_provenance_verification: {
        Args: { p_post_id: string };
        Returns: Database["public"]["Tables"]["posts"]["Row"];
      };
      export_own_personal_data: {
        Args: Record<string, never>;
        Returns: Json;
      };
      request_or_execute_account_deletion: {
        Args: { p_mode: string; p_confirmation: string };
        Returns: Json;
      };
      finalize_permanent_account_deletion: {
        Args: { p_delete_auth_user?: boolean };
        Returns: Json;
      };
      can_cleanup_invalidated_project_output_object: {
        Args: { p_object_name: string; p_user_id: string };
        Returns: boolean;
      };
      reactivate_own_account: {
        Args: { p_display_name?: string | null };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
export type Interest = Database["public"]["Tables"]["interests"]["Row"];
export type UserInterest = Database["public"]["Tables"]["user_interests"]["Row"];
export type Follow = Database["public"]["Tables"]["follows"]["Row"];
export type Block = Database["public"]["Tables"]["blocks"]["Row"];
export type Mute = Database["public"]["Tables"]["mutes"]["Row"];
export type Post = Database["public"]["Tables"]["posts"]["Row"];
export type PostInsert = Database["public"]["Tables"]["posts"]["Insert"];
export type PostUpdate = Database["public"]["Tables"]["posts"]["Update"];
export type PostInterest = Database["public"]["Tables"]["post_interests"]["Row"];
export type DbNotification = Database["public"]["Tables"]["notifications"]["Row"];
export type PostLike = Database["public"]["Tables"]["post_likes"]["Row"];
export type Community = Database["public"]["Tables"]["communities"]["Row"];
export type CommunityInsert = Database["public"]["Tables"]["communities"]["Insert"];
export type CommunityUpdate = Database["public"]["Tables"]["communities"]["Update"];
export type CommunityMember = Database["public"]["Tables"]["community_members"]["Row"];
export type CommunityMemberInsert = Database["public"]["Tables"]["community_members"]["Insert"];
export type CommunityMemberUpdate = Database["public"]["Tables"]["community_members"]["Update"];
export type CommunityPost = Database["public"]["Tables"]["community_posts"]["Row"];
export type CommunityPostInsert = Database["public"]["Tables"]["community_posts"]["Insert"];
export type CommunityPostUpdate = Database["public"]["Tables"]["community_posts"]["Update"];
export type PlatformStaff = Database["public"]["Tables"]["platform_staff"]["Row"];
export type ContentReport = Database["public"]["Tables"]["content_reports"]["Row"];
export type ContentReportInsert = Database["public"]["Tables"]["content_reports"]["Insert"];
export type ContentReportUpdate = Database["public"]["Tables"]["content_reports"]["Update"];
export type ModerationAction = Database["public"]["Tables"]["moderation_actions"]["Row"];
export type ModerationActionInsert = Database["public"]["Tables"]["moderation_actions"]["Insert"];
export type ModerationActionUpdate = Database["public"]["Tables"]["moderation_actions"]["Update"];
export type ModerationAppeal = Database["public"]["Tables"]["moderation_appeals"]["Row"];
export type ModerationAppealInsert = Database["public"]["Tables"]["moderation_appeals"]["Insert"];
export type ModerationAppealUpdate = Database["public"]["Tables"]["moderation_appeals"]["Update"];
export type CollaborativeProject = Database["public"]["Tables"]["collaborative_projects"]["Row"];
export type CollaborativeProjectInsert = Database["public"]["Tables"]["collaborative_projects"]["Insert"];
export type CollaborativeProjectUpdate = Database["public"]["Tables"]["collaborative_projects"]["Update"];
export type ProjectParticipant = Database["public"]["Tables"]["project_participants"]["Row"];
export type ProjectParticipantInsert = Database["public"]["Tables"]["project_participants"]["Insert"];
export type ProjectParticipantUpdate = Database["public"]["Tables"]["project_participants"]["Update"];
export type ProjectContribution = Database["public"]["Tables"]["project_contributions"]["Row"];
export type ProjectContributionInsert = Database["public"]["Tables"]["project_contributions"]["Insert"];
export type ProjectContributionUpdate = Database["public"]["Tables"]["project_contributions"]["Update"];
export type ProjectRenderJob = Database["public"]["Tables"]["project_render_jobs"]["Row"];
export type ProjectRenderJobInsert = Database["public"]["Tables"]["project_render_jobs"]["Insert"];
export type ProjectRenderJobUpdate = Database["public"]["Tables"]["project_render_jobs"]["Update"];
export type RenderWorker = Database["public"]["Tables"]["render_workers"]["Row"];
export type RenderWorkerInsert = Database["public"]["Tables"]["render_workers"]["Insert"];
export type RenderWorkerUpdate = Database["public"]["Tables"]["render_workers"]["Update"];

export interface UserInterestWithDetails extends UserInterest {
  interest: Interest;
}

export interface FollowWithProfile extends Follow {
  profile: Profile;
}

export interface PostWithDetails extends Post {
  creator: Profile;
  interests?: Interest[];
}



