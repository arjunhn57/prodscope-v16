import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";
import { API_BASE } from "../lib/constants";
import type { SSEPayload } from "./hooks";

export type SSEConnectionStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface SSEConnectionState {
  status: SSEConnectionStatus;
  retryAt: number | null;
  attempt: number;
}

/**
 * Hook that connects to the job SSE stream and updates TanStack Query cache.
 * Automatically reconnects on error with exponential backoff.
 * Returns current connection state for surfacing SSE-error UI.
 */
export function useJobSSE(jobId: string | undefined): SSEConnectionState {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const esRef = useRef<EventSource | null>(null);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<SSEConnectionState>({
    status: "idle",
    retryAt: null,
    attempt: 0,
  });

  const connect = useCallback(() => {
    if (!jobId || !token) return;

    setState((prev) => ({ ...prev, status: "connecting", retryAt: null }));

    const url = `${API_BASE}/job-sse/${jobId}?api_key=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      retriesRef.current = 0;
      setState({ status: "connected", retryAt: null, attempt: 0 });
    };

    es.onmessage = (event) => {
      try {
        const payload: SSEPayload = JSON.parse(event.data);
        retriesRef.current = 0;

        queryClient.setQueryData(["job-status", jobId], (old: unknown) => ({
          ...(typeof old === "object" && old !== null ? old : {}),
          ...payload,
        }));

        queryClient.setQueryData(["job-sse", jobId], payload);
        setState((prev) => (prev.status === "connected" ? prev : { status: "connected", retryAt: null, attempt: 0 }));
      } catch {
        // Ignore parse errors from keepalive pings
      }
    };

    es.addEventListener("done", () => {
      es.close();
      esRef.current = null;
      setState({ status: "closed", retryAt: null, attempt: 0 });
      queryClient.invalidateQueries({ queryKey: ["job-status", jobId] });
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      const attempt = retriesRef.current;
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      retriesRef.current = attempt + 1;
      const retryAt = Date.now() + delay;
      setState({ status: "error", retryAt, attempt: attempt + 1 });
      retryTimerRef.current = window.setTimeout(connect, delay);
    };
  }, [jobId, token, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [connect]);

  return state;
}
