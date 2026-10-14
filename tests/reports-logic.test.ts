import { describe, it, expect } from "vitest";
import {
  submitReportSchema,
  updateReportStatusSchema,
  moderationQueueFilterSchema,
  REPORT_REASONS,
  type ReportStatus,
  type ReportTargetType,
} from "@/lib/reports/types";

describe("Content Reporting & Trust Safety Foundation Logic", () => {
  describe("Zod Validation Schemas", () => {
    it("accepts valid submit report payloads for all target types", () => {
      const validTargets: ReportTargetType[] = ["post", "community_post", "profile"];
      for (const targetType of validTargets) {
        const res = submitReportSchema.safeParse({
          targetType,
          targetId: "a0000000-0000-4000-8000-000000000001",
          reason: "spam",
          details: "Appears to be automated bot activity.",
        });
        expect(res.success).toBe(true);
      }
    });

    it("accepts all constrained reason categories", () => {
      for (const reason of REPORT_REASONS) {
        const res = submitReportSchema.safeParse({
          targetType: "post",
          targetId: "a0000000-0000-4000-8000-000000000001",
          reason,
        });
        expect(res.success).toBe(true);
      }
    });

    it("rejects unconstrained or invalid reason categories", () => {
      const res = submitReportSchema.safeParse({
        targetType: "post",
        targetId: "a0000000-0000-4000-8000-000000000001",
        reason: "i_dont_like_this",
      });
      expect(res.success).toBe(false);
    });

    it("enforces maximum length of 1,000 characters on user details", () => {
      const validDetails = "a".repeat(1000);
      const resValid = submitReportSchema.safeParse({
        targetType: "post",
        targetId: "a0000000-0000-4000-8000-000000000001",
        reason: "harassment",
        details: validDetails,
      });
      expect(resValid.success).toBe(true);

      const invalidDetails = "a".repeat(1001);
      const resInvalid = submitReportSchema.safeParse({
        targetType: "post",
        targetId: "a0000000-0000-4000-8000-000000000001",
        reason: "harassment",
        details: invalidDetails,
      });
      expect(resInvalid.success).toBe(false);
    });

    it("validates updateReportStatusSchema correctly", () => {
      const res = updateReportStatusSchema.safeParse({
        reportId: "a0000000-0000-4000-8000-000000000001",
        status: "resolved",
        resolutionNote: "Content reviewed and determined safe.",
      });
      expect(res.success).toBe(true);
    });

    it("rejects resolution note exceeding 1,000 characters", () => {
      const res = updateReportStatusSchema.safeParse({
        reportId: "a0000000-0000-4000-8000-000000000001",
        status: "dismissed",
        resolutionNote: "x".repeat(1001),
      });
      expect(res.success).toBe(false);
    });

    it("applies sensible pagination defaults in moderationQueueFilterSchema", () => {
      const res = moderationQueueFilterSchema.safeParse({});
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.page).toBe(1);
        expect(res.data.pageSize).toBe(20);
      }
    });
  });

  describe("Self-Reporting Invariants", () => {
    function canSubmitReport(
      reporterId: string,
      targetType: ReportTargetType,
      targetAuthorId: string
    ): { allowed: boolean; reason?: string } {
      if (targetAuthorId === reporterId) {
        return { allowed: false, reason: `Cannot report your own ${targetType}.` };
      }
      return { allowed: true };
    }

    it("rejects user reporting their own profile", () => {
      const res = canSubmitReport("user-1", "profile", "user-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cannot report your own");
    });

    it("rejects user reporting their own post", () => {
      const res = canSubmitReport("user-1", "post", "user-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cannot report your own");
    });

    it("rejects user reporting their own community post", () => {
      const res = canSubmitReport("user-1", "community_post", "user-1");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("Cannot report your own");
    });

    it("permits user reporting content by another creator", () => {
      const res = canSubmitReport("user-1", "post", "user-2");
      expect(res.allowed).toBe(true);
    });
  });

  describe("Deduplication & Re-submission Invariants", () => {
    interface ActiveReportRecord {
      reporterId: string;
      targetType: ReportTargetType;
      targetId: string;
      status: ReportStatus;
    }

    function canCreateReportGivenExisting(
      existingReports: ActiveReportRecord[],
      newReport: { reporterId: string; targetType: ReportTargetType; targetId: string }
    ): boolean {
      const hasActive = existingReports.some(
        (r) =>
          r.reporterId === newReport.reporterId &&
          r.targetType === newReport.targetType &&
          r.targetId === newReport.targetId &&
          (r.status === "open" || r.status === "in_review")
      );
      return !hasActive;
    }

    it("blocks duplicate report if previous report is open", () => {
      const existing: ActiveReportRecord[] = [
        {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
          status: "open",
        },
      ];
      expect(
        canCreateReportGivenExisting(existing, {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
        })
      ).toBe(false);
    });

    it("blocks duplicate report if previous report is in_review", () => {
      const existing: ActiveReportRecord[] = [
        {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
          status: "in_review",
        },
      ];
      expect(
        canCreateReportGivenExisting(existing, {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
        })
      ).toBe(false);
    });

    it("permits new report after previous report has been dismissed", () => {
      const existing: ActiveReportRecord[] = [
        {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
          status: "dismissed",
        },
      ];
      expect(
        canCreateReportGivenExisting(existing, {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
        })
      ).toBe(true);
    });

    it("permits new report after previous report has been resolved", () => {
      const existing: ActiveReportRecord[] = [
        {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
          status: "resolved",
        },
      ];
      expect(
        canCreateReportGivenExisting(existing, {
          reporterId: "user-1",
          targetType: "post",
          targetId: "post-1",
        })
      ).toBe(true);
    });
  });

  describe("Status Transition State Machine", () => {
    function isValidStatusTransition(
      currentStatus: ReportStatus,
      nextStatus: ReportStatus
    ): boolean {
      if (currentStatus === "resolved" || currentStatus === "dismissed") {
        return false; // Finalized reports cannot be transitioned
      }
      if (currentStatus === "open") {
        return nextStatus === "in_review" || nextStatus === "resolved" || nextStatus === "dismissed";
      }
      if (currentStatus === "in_review") {
        return nextStatus === "resolved" || nextStatus === "dismissed";
      }
      return false;
    }

    it("permits claiming open report to in_review", () => {
      expect(isValidStatusTransition("open", "in_review")).toBe(true);
    });

    it("permits resolving open report directly", () => {
      expect(isValidStatusTransition("open", "resolved")).toBe(true);
    });

    it("permits dismissing open report directly", () => {
      expect(isValidStatusTransition("open", "dismissed")).toBe(true);
    });

    it("permits resolving in_review report", () => {
      expect(isValidStatusTransition("in_review", "resolved")).toBe(true);
    });

    it("permits dismissing in_review report", () => {
      expect(isValidStatusTransition("in_review", "dismissed")).toBe(true);
    });

    it("denies reopening resolved reports", () => {
      expect(isValidStatusTransition("resolved", "open")).toBe(false);
      expect(isValidStatusTransition("resolved", "in_review")).toBe(false);
    });

    it("denies reopening dismissed reports", () => {
      expect(isValidStatusTransition("dismissed", "open")).toBe(false);
      expect(isValidStatusTransition("dismissed", "in_review")).toBe(false);
    });
  });

  describe("Moderation Queue Scope & Authorization", () => {
    interface Caller {
      id: string;
      isPlatformStaff: boolean;
      communityStaffIds: string[]; // communities where caller is owner/mod
    }

    interface Report {
      id: string;
      communityId: string | null;
    }

    function canModerateReport(caller: Caller, report: Report): boolean {
      if (caller.isPlatformStaff) return true;
      if (report.communityId && caller.communityStaffIds.includes(report.communityId)) {
        return true;
      }
      return false;
    }

    it("allows platform staff to moderate global reports", () => {
      const staff: Caller = { id: "admin-1", isPlatformStaff: true, communityStaffIds: [] };
      const globalReport: Report = { id: "rep-1", communityId: null };
      expect(canModerateReport(staff, globalReport)).toBe(true);
    });

    it("allows platform staff to moderate any community report", () => {
      const staff: Caller = { id: "admin-1", isPlatformStaff: true, communityStaffIds: [] };
      const commReport: Report = { id: "rep-2", communityId: "comm-abc" };
      expect(canModerateReport(staff, commReport)).toBe(true);
    });

    it("allows community moderator to moderate reports in their community", () => {
      const mod: Caller = { id: "mod-1", isPlatformStaff: false, communityStaffIds: ["comm-100"] };
      const commReport: Report = { id: "rep-3", communityId: "comm-100" };
      expect(canModerateReport(mod, commReport)).toBe(true);
    });

    it("denies community moderator from moderating reports of other communities", () => {
      const mod: Caller = { id: "mod-1", isPlatformStaff: false, communityStaffIds: ["comm-100"] };
      const otherReport: Report = { id: "rep-4", communityId: "comm-200" };
      expect(canModerateReport(mod, otherReport)).toBe(false);
    });

    it("denies community moderator from moderating global platform reports", () => {
      const mod: Caller = { id: "mod-1", isPlatformStaff: false, communityStaffIds: ["comm-100"] };
      const globalReport: Report = { id: "rep-5", communityId: null };
      expect(canModerateReport(mod, globalReport)).toBe(false);
    });

    it("denies ordinary members from moderating any reports", () => {
      const member: Caller = { id: "member-1", isPlatformStaff: false, communityStaffIds: [] };
      const commReport: Report = { id: "rep-6", communityId: "comm-100" };
      expect(canModerateReport(member, commReport)).toBe(false);
    });
  });

  describe("Data Sanitization for Reporters", () => {
    interface RawDbReport {
      id: string;
      reporter_id: string;
      target_type: ReportTargetType;
      target_id: string;
      reason: string;
      details: string | null;
      status: ReportStatus;
      reviewer_id: string | null;
      reviewed_at: string | null;
      resolution_note: string | null;
      created_at: string;
      updated_at: string;
    }

    function sanitizeForReporter(raw: RawDbReport) {
      return {
        id: raw.id,
        target_type: raw.target_type,
        target_id: raw.target_id,
        reason: raw.reason,
        details: raw.details,
        status: raw.status,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
      };
    }

    it("strips reviewer identity and private resolution note from reporter view", () => {
      const raw: RawDbReport = {
        id: "rep-1",
        reporter_id: "user-1",
        target_type: "post",
        target_id: "post-1",
        reason: "spam",
        details: "Bot link",
        status: "resolved",
        reviewer_id: "staff-99",
        reviewed_at: "2026-10-10T00:00:00Z",
        resolution_note: "Private internal note: user flagged for investigation",
        created_at: "2026-10-09T23:00:00Z",
        updated_at: "2026-10-10T00:00:00Z",
      };

      const sanitized = sanitizeForReporter(raw);
      expect("reviewer_id" in sanitized).toBe(false);
      expect("resolution_note" in sanitized).toBe(false);
      expect(sanitized.id).toBe("rep-1");
      expect(sanitized.status).toBe("resolved");
    });
  });
});
