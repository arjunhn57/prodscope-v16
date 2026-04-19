import { motion } from "framer-motion";

interface Finding {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  status: "open" | "resolved";
}

interface FindingsTableProps {
  findings: Finding[];
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string; dot: string }> = {
  critical: { color: "var(--m-danger)", bg: "var(--m-danger-bg)", dot: "var(--m-danger)" },
  high: { color: "var(--m-warning)", bg: "var(--m-warning-bg)", dot: "var(--m-warning)" },
  medium: { color: "var(--m-info)", bg: "var(--m-info-bg)", dot: "var(--m-info)" },
  low: { color: "var(--m-text-muted)", bg: "var(--m-bg-muted)", dot: "var(--m-text-muted)" },
};

export function FindingsTable({ findings }: FindingsTableProps) {
  return (
    <div
      style={{
        background: "var(--m-bg-white)",
        border: "1px solid var(--m-border)",
        borderRadius: "var(--m-radius-lg)",
        boxShadow: "var(--m-shadow-sm)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 140px 100px",
          gap: 0,
          padding: "12px 24px",
          borderBottom: "1px solid var(--m-border)",
          background: "var(--m-bg-muted)",
        }}
      >
        {["Finding", "Severity", "Category", "Status"].map((h) => (
          <span
            key={h}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--m-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {findings.map((f, i) => {
        const sev = SEVERITY_STYLES[f.severity];
        return (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3 }}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 120px 140px 100px",
              gap: 0,
              padding: "16px 24px",
              borderBottom: i < findings.length - 1 ? "1px solid var(--m-border)" : "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            className="hover:bg-[var(--m-bg-hover)]"
          >
            {/* Title */}
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--m-text)" }}>
              {f.title}
            </span>

            {/* Severity */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: sev.dot }} />
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: sev.color,
                  textTransform: "capitalize",
                }}
              >
                {f.severity}
              </span>
            </div>

            {/* Category */}
            <span
              style={{
                fontSize: 12,
                color: "var(--m-text-secondary)",
                fontWeight: 400,
              }}
            >
              {f.category}
            </span>

            {/* Status */}
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: f.status === "open" ? "var(--m-warning)" : "var(--m-success)",
              }}
            >
              {f.status === "open" ? "Open" : "Resolved"}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
