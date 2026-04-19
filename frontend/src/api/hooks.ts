import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./client";
import { useAuthStore } from "../stores/auth";
import { POLL_INTERVALS } from "../lib/constants";
import type { JobStatus } from "../lib/constants";

// ── Types ──────────────────────────────────────────────────────────────────

export interface JobData {
  status: JobStatus;
  step: number;
  steps: string[];
  screenshots: string[];
  report: Record<string, unknown> | null;
  stopReason: string | null;
  crawlQuality: string | null;
  error: string | null;
  emailStatus: string | null;
  queuePosition: number;
}

export interface QueueStatus {
  processing: boolean;
  currentJobId: string | null;
  queueDepth: number;
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  backend: "redis" | "in-memory";
  emulators?: {
    total: number;
    idle: number;
    busy: number;
    unhealthy: number;
  };
}

export interface HealthData {
  status: "ok" | "degraded";
  uptime: number;
  queue: { processing: boolean; depth: number; currentJobId: string | null };
  db: string;
  memory: { rss: number; heap: number };
  emulators?: { total: number; idle: number; busy: number; unhealthy: number };
  metrics: {
    totalCrawls: number;
    consecutiveFailures: number;
    totalCostInr: number;
    totalScreensCaptured: number;
    totalVisionCalls: number;
  };
}

export interface RecentJob {
  jobId: string;
  status: JobStatus;
  appPackage: string | null;
  createdAt: string;
  completedAt: string | null;
  screensCaptured: number;
  stepsRun: number;
  costInr: number;
  stopReason: string | null;
  crawlQuality: string | null;
  error: string | null;
}

export interface RecentJobsPage {
  items: RecentJob[];
  nextCursor: string | null;
}

export interface SSEPayload {
  status: JobStatus;
  step: number;
  steps: string[];
  live: {
    phase: string;
    rawStep: number | null;
    maxRawSteps: number | null;
    countedUniqueScreens: number | null;
    targetUniqueScreens: number | null;
    activity: string | null;
    packageName: string | null;
    intentType: string | null;
    latestAction: { type: string; description: string } | string | null;
    captureMode: string | null;
    screenshotUnavailable: boolean;
    screenshotPath: string | null;
    message: string | null;
    reasoning: string | null;
    expectedOutcome: string | null;
    perceptionBoxes: Array<{ description: string; x: number; y: number; priority?: number }>;
    tapTarget: { x: number; y: number; element: string } | null;
    navTabs: Array<{ label: string; explored?: boolean; exhausted?: boolean }>;
  };
  stopReason: string | null;
  crawlQuality: string | null;
  error: string | null;
  emailStatus: string | null;
  report: Record<string, unknown> | null;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export function useLogin() {
  const login = useAuthStore((s) => s.login);

  return useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await api.post<ApiResponse<{ token: string; expiresIn: string }>>(
        "auth/login",
        { apiKey }
      );
      return res.data;
    },
    onSuccess: (data) => {
      login(data.token);
    },
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export function useStartJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await api.post<ApiResponse<{ jobId: string; status: string; queuePosition: number }>>(
        "start-job",
        formData
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue-status"] });
      queryClient.invalidateQueries({ queryKey: ["recent-jobs"] });
    },
  });
}

export function useRecentJobs(limit: number = 10) {
  const processing = useQueueStatus().data?.processing ?? false;

  return useQuery({
    queryKey: ["recent-jobs", limit],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RecentJobsPage>>(`jobs?limit=${limit}`);
      return res.data;
    },
    refetchInterval: processing ? POLL_INTERVALS.queueStatus : POLL_INTERVALS.health,
  });
}

export function useJobStatus(jobId: string | undefined) {
  return useQuery({
    queryKey: ["job-status", jobId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<JobData>>(`job-status/${jobId}`);
      return res.data;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return POLL_INTERVALS.activeJob;
      if (["complete", "degraded", "failed"].includes(status)) return false;
      return POLL_INTERVALS.activeJob;
    },
  });
}

// ── Shareable report (magic-link) ───────────────────────────────────────────

export interface ShareLinkData {
  jobId: string;
  token: string;
  shareUrl: string | null;
  downloadUrl: string;
}

/**
 * Authenticated — fetch a magic-link token + URL for the given job.
 * Returns null data while loading; errors if the server hasn't set
 * MAGIC_LINK_SECRET.
 */
export function useShareLink(jobId: string | undefined) {
  return useQuery({
    queryKey: ["share-link", jobId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<ShareLinkData>>(
        `report-share-link/${jobId}`
      );
      return res.data;
    },
    enabled: !!jobId,
    staleTime: 60 * 60 * 1000, // token is deterministic; cache for 1h
  });
}

export interface PublicReportData {
  status: JobStatus;
  report: Record<string, unknown> | null;
  stopReason: string | null;
  crawlQuality: string | null;
  error: string | null;
  screenshots: string[];
}

/**
 * Public — fetch a report via a magic-link token, no auth required.
 * Used by the /r/:jobId route.
 */
export function usePublicReport(jobId: string | undefined, token: string | null) {
  return useQuery({
    queryKey: ["public-report", jobId, token],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PublicReportData>>(
        `public-report/${jobId}?token=${encodeURIComponent(token ?? "")}`
      );
      return res.data;
    },
    enabled: !!jobId && !!token,
    staleTime: Infinity,
  });
}

export function useQueueStatus() {
  return useQuery({
    queryKey: ["queue-status"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<QueueStatus>>("queue-status");
      return res.data;
    },
    refetchInterval: POLL_INTERVALS.queueStatus,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<HealthData>>("../health");
      return res.data;
    },
    refetchInterval: POLL_INTERVALS.health,
  });
}
