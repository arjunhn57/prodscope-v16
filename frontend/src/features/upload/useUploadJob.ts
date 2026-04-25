import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "../../lib/constants";
import { useAuthStore } from "../../stores/auth";

export type StaticInputKey = "otp" | "email_code" | "2fa" | "captcha";

export type StaticInputs = Partial<Record<StaticInputKey, string>>;

export interface UploadMeta {
  email?: string;
  credentials?: string;
  goals?: string;
  painPoints?: string;
  staticInputs?: StaticInputs;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  speedBps: number;
  etaSec: number;
}

export type UploadState = "idle" | "uploading" | "error" | "complete";

export interface UseUploadJobReturn {
  startUpload: (file: File, meta?: UploadMeta) => void;
  startFromUrl: (playStoreUrl: string, meta?: UploadMeta) => void;
  cancel: () => void;
  reset: () => void;
  state: UploadState;
  progress: UploadProgress;
  error: string | null;
  result: { jobId: string; queuePosition: number } | null;
}

interface ProgressSample {
  t: number;
  loaded: number;
}

const SAMPLE_WINDOW_MS = 1200;
const INITIAL_PROGRESS: UploadProgress = {
  loaded: 0,
  total: 0,
  percent: 0,
  speedBps: 0,
  etaSec: 0,
};

function resolveUploadUrl(): string {
  const base = API_BASE.startsWith("http")
    ? API_BASE
    : `${window.location.origin}${API_BASE.startsWith("/") ? "" : "/"}${API_BASE}`;
  return `${base.replace(/\/$/, "")}/start-job`;
}

function resolveUrlJobUrl(): string {
  const base = API_BASE.startsWith("http")
    ? API_BASE
    : `${window.location.origin}${API_BASE.startsWith("/") ? "" : "/"}${API_BASE}`;
  return `${base.replace(/\/$/, "")}/start-job-from-url`;
}

export function useUploadJob(): UseUploadJobReturn {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const logout = useAuthStore((s) => s.logout);
  const setCredits = useAuthStore((s) => s.setCredits);

  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState<UploadProgress>(INITIAL_PROGRESS);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UseUploadJobReturn["result"]>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const samplesRef = useRef<ProgressSample[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    samplesRef.current = [];
    if (!mountedRef.current) return;
    setState("idle");
    setProgress(INITIAL_PROGRESS);
    setError(null);
    setResult(null);
  }, []);

  const reset = useCallback(() => {
    cancel();
  }, [cancel]);

  const startUpload = useCallback(
    (file: File, meta: UploadMeta = {}) => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      samplesRef.current = [];

      if (mountedRef.current) {
        setState("uploading");
        setError(null);
        setResult(null);
        setProgress({
          loaded: 0,
          total: file.size,
          percent: 0,
          speedBps: 0,
          etaSec: 0,
        });
      }

      const formData = new FormData();
      formData.append("apk", file);
      if (meta.email) formData.append("email", meta.email);
      if (meta.credentials) formData.append("credentials", meta.credentials);
      if (meta.goals) formData.append("goals", meta.goals);
      if (meta.painPoints) formData.append("painPoints", meta.painPoints);

      if (meta.staticInputs) {
        const cleaned: Record<string, string> = {};
        for (const [key, value] of Object.entries(meta.staticInputs)) {
          if (typeof value === "string" && value.trim().length > 0) {
            cleaned[key] = value.trim();
          }
        }
        if (Object.keys(cleaned).length > 0) {
          formData.append("staticInputs", JSON.stringify(cleaned));
        }
      }

      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", resolveUploadUrl());
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.addEventListener("progress", (evt) => {
        if (!evt.lengthComputable) return;
        if (!mountedRef.current) return;

        const now = performance.now();
        const samples = samplesRef.current;
        samples.push({ t: now, loaded: evt.loaded });
        while (samples.length > 2 && now - samples[0].t > SAMPLE_WINDOW_MS) {
          samples.shift();
        }

        let speedBps = 0;
        if (samples.length >= 2) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dt = (last.t - first.t) / 1000;
          const dl = last.loaded - first.loaded;
          if (dt > 0) speedBps = Math.max(0, dl / dt);
        }

        const total = evt.total || file.size;
        const percent = total > 0 ? Math.min(100, (evt.loaded / total) * 100) : 0;
        const remaining = Math.max(0, total - evt.loaded);
        const etaSec = speedBps > 0 ? remaining / speedBps : 0;

        setProgress({
          loaded: evt.loaded,
          total,
          percent,
          speedBps,
          etaSec,
        });
      });

      xhr.addEventListener("load", () => {
        xhrRef.current = null;
        if (!mountedRef.current) return;

        if (xhr.status === 401) {
          logout();
          setState("error");
          setError("Your session expired. Sign in to retry.");
          return;
        }

        let parsed:
          | {
              success: boolean;
              data?: {
                jobId: string;
                queuePosition: number;
                creditBalanceAfter?: number | null;
              };
              error?: string;
            }
          | null = null;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = null;
        }

        if (xhr.status >= 200 && xhr.status < 300 && parsed?.success && parsed.data?.jobId) {
          setProgress((prev) => ({
            ...prev,
            loaded: prev.total,
            percent: 100,
            speedBps: 0,
            etaSec: 0,
          }));
          setState("complete");
          setResult({
            jobId: parsed.data.jobId,
            queuePosition: parsed.data.queuePosition ?? 0,
          });
          if (typeof parsed.data.creditBalanceAfter === "number") {
            setCredits(parsed.data.creditBalanceAfter);
          }
          queryClient.invalidateQueries({ queryKey: ["queue-status"] });
        } else if (xhr.status === 402) {
          setState("error");
          setError(
            parsed?.error ||
              "You've used your free report. Upgrade to run another.",
          );
        } else {
          setState("error");
          setError(parsed?.error || `Upload failed (${xhr.status || "network"})`);
        }
      });

      xhr.addEventListener("error", () => {
        xhrRef.current = null;
        if (!mountedRef.current) return;
        setState("error");
        setError("Network error — couldn't reach the server.");
      });

      xhr.addEventListener("abort", () => {
        xhrRef.current = null;
      });

      xhr.addEventListener("timeout", () => {
        xhrRef.current = null;
        if (!mountedRef.current) return;
        setState("error");
        setError("Upload timed out. Try again.");
      });

      xhr.send(formData);
    },
    [queryClient, token, logout, setCredits]
  );

  // 2026-04-26 (Item #3): URL-paste path. The backend fetches the APK
  // from a public mirror server-side, so we don't track upload progress;
  // the request body is small JSON. Same {jobId, queuePosition} response
  // shape so downstream code (state machine, navigation) doesn't care
  // how the job was started.
  const startFromUrl = useCallback(
    (playStoreUrl: string, meta: UploadMeta = {}) => {
      if (xhrRef.current) {
        xhrRef.current.abort();
        xhrRef.current = null;
      }
      samplesRef.current = [];

      if (mountedRef.current) {
        setState("uploading");
        setError(null);
        setResult(null);
        // No real progress to report on a server-side fetch — show 0
        // and let the UI display a generic "fetching" hint.
        setProgress({ loaded: 0, total: 0, percent: 0, speedBps: 0, etaSec: 0 });
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const body: Record<string, unknown> = { playStoreUrl };
      if (meta.email) body.email = meta.email;
      if (meta.credentials) body.credentials = meta.credentials;
      if (meta.goals) body.goals = meta.goals;
      if (meta.painPoints) body.painPoints = meta.painPoints;
      if (meta.staticInputs) {
        const cleaned: Record<string, string> = {};
        for (const [key, value] of Object.entries(meta.staticInputs)) {
          if (typeof value === "string" && value.trim().length > 0) {
            cleaned[key] = value.trim();
          }
        }
        if (Object.keys(cleaned).length > 0) {
          body.staticInputs = JSON.stringify(cleaned);
        }
      }

      type StartJobResponse = {
        success?: boolean;
        data?: {
          jobId: string;
          queuePosition: number;
          creditBalanceAfter?: number | null;
        };
        error?: string;
      };

      fetch(resolveUrlJobUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (!mountedRef.current) return;
          if (res.status === 401) {
            logout();
            setState("error");
            setError("Your session expired. Sign in to retry.");
            return;
          }
          let parsed: StartJobResponse | null = null;
          try {
            parsed = (await res.json()) as StartJobResponse;
          } catch {
            parsed = null;
          }
          if (res.ok && parsed?.success && parsed.data?.jobId) {
            setProgress({ loaded: 1, total: 1, percent: 100, speedBps: 0, etaSec: 0 });
            setState("complete");
            setResult({
              jobId: parsed.data.jobId,
              queuePosition: parsed.data.queuePosition ?? 0,
            });
            if (typeof parsed.data.creditBalanceAfter === "number") {
              setCredits(parsed.data.creditBalanceAfter);
            }
            queryClient.invalidateQueries({ queryKey: ["queue-status"] });
          } else if (res.status === 402) {
            setState("error");
            setError(
              parsed?.error ||
                "You've used your free report. Upgrade to run another.",
            );
          } else {
            setState("error");
            setError(
              parsed?.error ||
                "We couldn't fetch this APK from the Play Store mirror. Try uploading the APK directly.",
            );
          }
        })
        .catch(() => {
          if (!mountedRef.current) return;
          setState("error");
          setError("Network error — couldn't reach the server.");
        });
    },
    [queryClient, token, logout, setCredits],
  );

  return {
    startUpload,
    startFromUrl,
    cancel,
    reset,
    state,
    progress,
    error,
    result,
  };
}
