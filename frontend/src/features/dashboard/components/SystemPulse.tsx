import { motion, useReducedMotion } from "framer-motion";
import { Server, Database, Cpu, HardDrive, type LucideIcon } from "lucide-react";
import type { HealthData, QueueStatus } from "../../../api/hooks";
import { EDITORIAL_EASE, REPORT_GRADIENTS } from "../../report/tokens";
import { formatDuration } from "../../../lib/format";

interface SystemPulseProps {
  health: HealthData | undefined;
  queue: QueueStatus | undefined;
}

interface Row {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  ok: boolean;
}

export function SystemPulse({ health, queue }: SystemPulseProps) {
  const reduceMotion = useReducedMotion();

  const rows: Row[] = health
    ? [
        {
          icon: Server,
          label: "Backend",
          value: health.status === "ok" ? "Healthy" : "Degraded",
          detail: `Uptime ${formatDuration(health.uptime * 1000)}`,
          ok: health.status === "ok",
        },
        {
          icon: Database,
          label: "Database",
          value: health.db === "ok" ? "Connected" : "Error",
          detail: "SQLite WAL",
          ok: health.db === "ok",
        },
        {
          icon: Cpu,
          label: "Emulators",
          value: health.emulators
            ? `${health.emulators.idle} idle / ${health.emulators.total}`
            : "N/A",
          detail: health.emulators?.unhealthy
            ? `${health.emulators.unhealthy} unhealthy`
            : "All healthy",
          ok: !health.emulators?.unhealthy,
        },
        {
          icon: HardDrive,
          label: "Queue",
          value: queue ? `${queue.queueDepth} pending` : "—",
          detail: queue?.backend === "redis" ? "Redis-backed" : "In-memory fallback",
          ok: queue?.backend === "redis",
        },
      ]
    : [];

  return (
    <motion.section
      id="system-pulse"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: EDITORIAL_EASE, delay: reduceMotion ? 0 : 0.06 }}
      className="relative w-full rounded-[24px] p-5 md:p-6"
      style={{
        background: REPORT_GRADIENTS.auroraTile,
        border: "1px solid rgba(108,71,255,0.22)",
        boxShadow:
          "0 1px 3px rgba(15,23,42,0.04), 0 20px 40px -24px rgba(15,23,42,0.12)",
      }}
    >
      <header className="flex items-center justify-between mb-4">
        <h3
          className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-muted)]"
          style={{ fontFamily: "var(--font-label)" }}
        >
          System pulse
        </h3>
        {health && (
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                health.status === "ok" ? "bg-[#10B981]" : "bg-[#F59E0B]"
              } ${health.status === "ok" ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span
              className="text-[11px] text-[var(--color-text-secondary)] capitalize"
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {health.status}
            </span>
          </div>
        )}
      </header>

      {!health ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[50px] rounded-xl bg-[rgba(226,232,240,0.5)] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <motion.li
              key={row.label}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.35,
                ease: EDITORIAL_EASE,
                delay: reduceMotion ? 0 : 0.08 + i * 0.05,
              }}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-white/70 border border-[rgba(226,232,240,0.55)]"
            >
              <div
                className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                  row.ok ? "bg-[#ECFDF5]" : "bg-[#FFFBEB]"
                }`}
              >
                <row.icon
                  className={`w-4 h-4 ${row.ok ? "text-[#047857]" : "text-[#B45309]"}`}
                  strokeWidth={2}
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[13px] font-semibold text-[var(--color-text-primary)]"
                    style={{ fontFamily: "var(--font-sans)" }}
                  >
                    {row.label}
                  </span>
                  <span
                    className="text-[11.5px] text-[var(--color-text-secondary)] tabular-nums"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {row.value}
                  </span>
                </div>
                <span
                  className="text-[11px] text-[var(--color-text-muted)]"
                  style={{ fontFamily: "var(--font-sans)" }}
                >
                  {row.detail}
                </span>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </motion.section>
  );
}
