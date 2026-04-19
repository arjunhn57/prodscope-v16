export const API_BASE = import.meta.env.VITE_API_URL || "/api/v1";

export const JOB_STATUSES = {
  queued: { label: "Queued", color: "text-info", bg: "bg-info/10", dot: "bg-info" },
  processing: { label: "Processing", color: "text-accent", bg: "bg-accent/10", dot: "bg-accent" },
  complete: { label: "Complete", color: "text-success", bg: "bg-success/10", dot: "bg-success" },
  degraded: { label: "Degraded", color: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  failed: { label: "Failed", color: "text-danger", bg: "bg-danger/10", dot: "bg-danger" },
  interrupted: { label: "Interrupted", color: "text-text-muted", bg: "bg-text-muted/10", dot: "bg-text-muted" },
} as const;

export type JobStatus = keyof typeof JOB_STATUSES;

export const POLL_INTERVALS = {
  activeJob: 3000,
  queueStatus: 10000,
  health: 30000,
} as const;
