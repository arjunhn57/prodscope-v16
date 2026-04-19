import "./mockup-tokens.css";
import { motion } from "framer-motion";
import {
  Bug,
  Shield,
  Smartphone,
  TrendingUp,
  Download,
  ArrowLeft,
  BarChart3,
  FileText,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import { StatCard } from "./components/StatCard";
import { FindingsTable } from "./components/FindingsTable";
import { PremiumButton } from "./components/PremiumButton";
import { ScoreRing } from "./components/ScoreRing";

// ── Fake Data ─────────────────────────────────────────────────────────────

const STATS = [
  { label: "Screens Analyzed", value: "47", change: "+12%", trend: "up" as const, icon: <Smartphone size={18} /> },
  { label: "Bugs Found", value: "23", change: "+3", trend: "up" as const, icon: <Bug size={18} /> },
  { label: "Test Coverage", value: "84%", change: "+6%", trend: "up" as const, icon: <Shield size={18} /> },
  { label: "Crash Rate", value: "0.2%", change: "-0.5%", trend: "down" as const, icon: <TrendingUp size={18} /> },
];

const FINDINGS = [
  { id: "1", title: "Login button unresponsive on Android 14", severity: "critical" as const, category: "Interaction", status: "open" as const },
  { id: "2", title: "Missing alt text on profile images", severity: "high" as const, category: "Accessibility", status: "open" as const },
  { id: "3", title: "Slow transition on settings page", severity: "medium" as const, category: "Performance", status: "resolved" as const },
  { id: "4", title: "Keyboard overlaps input on signup", severity: "high" as const, category: "UX", status: "open" as const },
  { id: "5", title: "Dark mode toggle has no animation", severity: "low" as const, category: "Polish", status: "resolved" as const },
  { id: "6", title: "Back gesture exits app from home", severity: "critical" as const, category: "Navigation", status: "open" as const },
];

const SCORE_AXES = [
  { label: "UX Quality", value: 82 },
  { label: "Accessibility", value: 69 },
  { label: "Stability", value: 91 },
  { label: "Performance", value: 75 },
  { label: "Navigation", value: 88 },
];

const RECOMMENDATIONS = [
  { title: "Fix critical navigation bugs", desc: "Back gesture and login button issues affect core user flow.", effort: "Quick Win" },
  { title: "Add accessibility labels", desc: "12 screens are missing required alt text and ARIA labels.", effort: "Medium" },
  { title: "Optimize settings transition", desc: "Replace heavy animation with lightweight CSS transition.", effort: "Quick Win" },
];

const ANIM = (delay: number) => ({
  initial: { opacity: 0, y: 20 } as const,
  animate: { opacity: 1, y: 0 } as const,
  transition: { delay, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } as const,
});

// ── Section wrapper ───────────────────────────────────────────────────────

function Section({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: "var(--m-bg-white)",
        border: "1px solid var(--m-border)",
        borderRadius: "var(--m-radius-lg)",
        boxShadow: "var(--m-shadow-sm)",
        padding: 28,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: "var(--m-text-secondary)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 20,
        letterSpacing: "0.01em",
      }}
    >
      <span style={{ color: "var(--m-text-muted)", display: "flex" }}>{icon}</span>
      {children}
    </h3>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export function ThemePreview() {
  return (
    <div className="mockup-shell" style={{ minHeight: "100dvh" }}>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <motion.div
          {...ANIM(0)}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 40,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--m-radius-sm)",
                  background: "var(--m-bg-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "var(--m-text-secondary)",
                }}
              >
                <ArrowLeft size={16} />
              </div>
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "var(--m-text)",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                Instagram
              </h1>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--m-success)",
                  background: "var(--m-success-bg)",
                  padding: "3px 10px",
                  borderRadius: 6,
                }}
              >
                Completed
              </span>
            </div>
            <p style={{ fontSize: 13, color: "var(--m-text-muted)", marginTop: 6 }}>
              Analysis Report &middot; Job a1b2c3d4 &middot; 12 min ago
            </p>
          </div>

          <ScoreRing score={78} size={130} />
        </motion.div>

        {/* ── Stat Cards ───────────────────────────────────────────────── */}
        <motion.div
          {...ANIM(0.08)}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {STATS.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </motion.div>

        {/* ── Executive Summary ─────────────────────────────────────────── */}
        <motion.div {...ANIM(0.14)} style={{ marginBottom: 32 }}>
          <Section>
            <SectionTitle icon={<FileText size={16} />}>Executive Summary</SectionTitle>
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: "var(--m-text-secondary)",
                maxWidth: 720,
              }}
            >
              ProdScope explored 47 unique screens across Instagram&apos;s core user flows including
              feed, stories, reels, direct messages, and profile management. The analysis identified
              23 issues across 6 categories, with 2 critical navigation bugs that impact the primary
              user journey. Overall app quality scored 78/100 with strong stability but accessibility
              gaps that should be addressed before the next release.
            </p>
          </Section>
        </motion.div>

        {/* ── Score Breakdown ──────────────────────────────────────────── */}
        <motion.div {...ANIM(0.18)} style={{ marginBottom: 32 }}>
          <Section>
            <SectionTitle icon={<BarChart3 size={16} />}>Score Breakdown</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {SCORE_AXES.map((axis) => (
                <div key={axis.label} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--m-text-secondary)",
                      width: 120,
                      flexShrink: 0,
                    }}
                  >
                    {axis.label}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      background: "var(--m-bg-muted)",
                      overflow: "hidden",
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${axis.value}%` }}
                      transition={{ duration: 1, delay: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        background: axis.value >= 80 ? "var(--m-success)" : axis.value >= 60 ? "var(--m-accent)" : "var(--m-warning)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--m-text)",
                      width: 36,
                      textAlign: "right",
                    }}
                  >
                    {axis.value}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* ── Findings ─────────────────────────────────────────────────── */}
        <motion.div {...ANIM(0.22)} style={{ marginBottom: 32 }}>
          <div style={{ marginBottom: 16 }}>
            <SectionTitle icon={<Bug size={16} />}>
              Findings
              <span style={{ fontWeight: 400, color: "var(--m-text-muted)", marginLeft: 6 }}>
                ({FINDINGS.length} total)
              </span>
            </SectionTitle>
          </div>
          <FindingsTable findings={FINDINGS} />
        </motion.div>

        {/* ── Recommendations ──────────────────────────────────────────── */}
        <motion.div {...ANIM(0.26)} style={{ marginBottom: 32 }}>
          <Section>
            <SectionTitle icon={<Lightbulb size={16} />}>Recommendations</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {RECOMMENDATIONS.map((rec) => (
                <div
                  key={rec.title}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    padding: "16px 20px",
                    borderRadius: "var(--m-radius-md)",
                    background: "var(--m-bg-muted)",
                    transition: "background 0.15s ease",
                  }}
                >
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--m-text)", marginBottom: 4 }}>
                      {rec.title}
                    </p>
                    <p style={{ fontSize: 13, color: "var(--m-text-secondary)", lineHeight: 1.5 }}>
                      {rec.desc}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--m-accent)",
                      background: "var(--m-accent-light)",
                      padding: "4px 10px",
                      borderRadius: 6,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {rec.effort}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* ── Footer Actions ───────────────────────────────────────────── */}
        <motion.div
          {...ANIM(0.3)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 24px",
            background: "var(--m-bg-white)",
            border: "1px solid var(--m-border)",
            borderRadius: "var(--m-radius-lg)",
            boxShadow: "var(--m-shadow-sm)",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <PremiumButton variant="secondary" icon={<Download size={14} />}>
              PDF
            </PremiumButton>
            <PremiumButton variant="secondary" icon={<Download size={14} />}>
              JSON
            </PremiumButton>
            <PremiumButton variant="secondary" icon={<Download size={14} />}>
              CSV
            </PremiumButton>
          </div>
          <PremiumButton icon={<RefreshCw size={14} />}>
            Run Again
          </PremiumButton>
        </motion.div>

        {/* ── Mockup Label ─────────────────────────────────────────────── */}
        <div
          style={{
            textAlign: "center",
            marginTop: 48,
            padding: "16px",
            borderTop: "1px solid var(--m-border)",
          }}
        >
          <p style={{ fontSize: 12, color: "var(--m-text-muted)", fontWeight: 500 }}>
            DESIGN PREVIEW &middot; This is an isolated mockup using the new light theme tokens
          </p>
          <p style={{ fontSize: 11, color: "var(--m-text-muted)", marginTop: 4 }}>
            Plus Jakarta Sans &middot; Navy + Blue accent &middot; No glass/blur/glow
          </p>
        </div>
      </div>
    </div>
  );
}
