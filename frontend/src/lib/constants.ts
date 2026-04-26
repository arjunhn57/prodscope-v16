// Production fallback is the direct VM HTTPS endpoint (Caddy fronting :8080),
// NOT the Vercel-proxied /api/v1, because Vercel rewrites cap at 4.5 MB and
// reject all real-world .xapk uploads. If VITE_API_URL is set in the build
// environment it wins; otherwise we fall back to the absolute URL in prod
// and the Vite dev-server proxy in dev.
const PROD_FALLBACK = "https://34-10-240-173.nip.io/api/v1";
const DEV_FALLBACK = "/api/v1";

const envApi = (import.meta.env.VITE_API_URL ?? "").trim();
export const API_BASE = envApi || (import.meta.env.PROD ? PROD_FALLBACK : DEV_FALLBACK);

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
