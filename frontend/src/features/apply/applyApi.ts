import { useMutation } from "@tanstack/react-query";
import { api, type ApiResponse } from "../../api/client";

export interface ApplicationInput {
  name: string;
  email: string;
  appName: string;
  playStoreUrl?: string;
  whyNow?: string;
  /** Honeypot — must stay empty. */
  website?: string;
}

interface ApplicationResponse {
  id: string;
  notification: "sent" | "failed" | "not_configured" | "skipped";
}

export function useSubmitApplication() {
  return useMutation({
    mutationFn: async (input: ApplicationInput) => {
      const res = await api.post<ApiResponse<ApplicationResponse>>(
        "apply",
        input
      );
      return res.data;
    },
  });
}
