import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "../../api/client";

export type ApplicationStatus = "new" | "contacted" | "onboarded" | "declined";
export type LoiStatus = "not_asked" | "asked" | "signed" | "declined";
export type AdminRole = "public" | "design_partner" | "admin";

export interface AdminSummary {
  spend: {
    last7dUsd: number;
    lifetimeUsd: number;
    last7dJobs: number;
    totalJobs: number;
  };
  users: {
    total: number;
    designPartners: number;
    admins: number;
  };
  applications: {
    total: number;
    new: number;
    loiSigned: number;
  };
}

export interface AdminApplication {
  id: string;
  name: string;
  email: string;
  appName: string;
  playStoreUrl: string | null;
  whyNow: string | null;
  status: ApplicationStatus;
  loiStatus: LoiStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: AdminRole;
  createdAt: string;
  lastLoginAt: string | null;
  crawlCount: number;
  totalCostUsd: number;
  lastCrawlAt: string | null;
  lastStatus: string | null;
  loiStatus: LoiStatus | null;
  applicationStatus: ApplicationStatus | null;
  applicationId: string | null;
}

export interface AdminUserJob {
  jobId: string;
  status: string;
  appPackage: string | null;
  createdAt: string;
  completedAt: string | null;
  costUsd: number;
}

export function useAdminSummary() {
  return useQuery({
    queryKey: ["admin", "summary"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<AdminSummary>>("admin/summary");
      return res.data;
    },
    staleTime: 30_000,
  });
}

export function useAdminApplications() {
  return useQuery({
    queryKey: ["admin", "applications"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<{ items: AdminApplication[] }>>(
        "admin/applications"
      );
      return res.data.items;
    },
    staleTime: 10_000,
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<{ items: AdminUser[] }>>(
        "admin/users"
      );
      return res.data.items;
    },
    staleTime: 10_000,
  });
}

export function useAdminUserJobs(userId: string | null) {
  return useQuery({
    queryKey: ["admin", "users", userId, "jobs"],
    enabled: Boolean(userId),
    queryFn: async () => {
      const res = await api.get<ApiResponse<{ items: AdminUserJob[] }>>(
        `admin/users/${userId}/jobs`
      );
      return res.data.items;
    },
    staleTime: 10_000,
  });
}

interface ApplicationPatch {
  status?: ApplicationStatus;
  loiStatus?: LoiStatus;
}

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: ApplicationPatch;
    }) => {
      const res = await api.patch<
        ApiResponse<{ id: string; status: ApplicationStatus; loiStatus: LoiStatus }>
      >(`admin/applications/${id}`, patch);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "applications"] });
      qc.invalidateQueries({ queryKey: ["admin", "summary"] });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AdminRole }) => {
      const res = await api.patch<
        ApiResponse<{ id: string; email: string; role: AdminRole }>
      >(`admin/users/${id}/role`, { role });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "summary"] });
    },
  });
}
