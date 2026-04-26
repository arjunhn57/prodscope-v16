"use strict";

/**
 * email-renderer.js — diligence-report email body.
 *
 * Phase C2 (2026-04-26): rewritten to be V2-first. The email is the FIRST
 * thing a design partner sees, so it gets:
 *   - Lead with the V2 verdict claim 1 (the headline)
 *   - The executive-summary's lead_sentence as supporting paragraph
 *   - Top 3 findings as bullets (critical_bugs > ux_issues sorted by severity)
 *   - Strengths count line (so it doesn't read as one-sided)
 *   - Big magenta "Open the full report" CTA → magic-link URL
 *   - Quiet footer: report ID + "ProdScope automated diligence"
 *
 * V1-only fallback path preserved for legacy / V2-suppressed runs (ships
 * a tight one-paragraph summary instead of the old kitchen-sink layout).
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function severityToken(severity) {
  switch ((severity || "").toLowerCase()) {
    case "critical":
      return { label: "Critical", color: "#9F1239", bg: "#FFE4EA" };
    case "high":
      return { label: "High", color: "#B45309", bg: "#FFFBEB" };
    case "medium":
      return { label: "Medium", color: "#A16207", bg: "#FEFCE8" };
    case "low":
      return { label: "Low", color: "#475569", bg: "#F1F5F9" };
    case "concern":
      return { label: "Concern", color: "#9F1239", bg: "#FFE4EA" };
    case "watch_item":
      return { label: "Watch", color: "#B45309", bg: "#FFFBEB" };
    default:
      return { label: "Note", color: "#475569", bg: "#F1F5F9" };
  }
}

const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Pick the top N V2 findings to feature in the email body. Critical bugs
 * outrank UX issues; within each, severity ladder; ties broken by
 * confidence (observed > inferred > hypothesis).
 *
 * @param {object} v2
 * @param {number} max
 */
function pickTopFindings(v2, max) {
  const all = [];
  for (const b of v2.critical_bugs || []) {
    all.push({ ...b, _kind: "bug" });
  }
  for (const u of v2.ux_issues || []) {
    all.push({ ...u, _kind: "ux" });
  }
  all.sort((a, b) => {
    if (a._kind !== b._kind) return a._kind === "bug" ? -1 : 1;
    const ar = SEVERITY_RANK[a.severity] ?? 99;
    const br = SEVERITY_RANK[b.severity] ?? 99;
    return ar - br;
  });
  return all.slice(0, max);
}

/**
 * Render the V2-first email body when V2 + executive summary are present.
 *
 * @param {{
 *   appName?: string,
 *   packageName?: string,
 *   jobId?: string,
 *   v2Report: object,
 *   executiveSummary?: object|null,
 *   shareUrl?: string|null,
 * }} payload
 */
function renderV2EmailBody(payload) {
  const {
    appName,
    packageName,
    jobId,
    v2Report,
    executiveSummary,
    shareUrl,
  } = payload;

  const verdictClaim =
    v2Report?.verdict?.claims?.[0]?.claim ||
    "Diligence-grade analysis of this build is ready.";

  const leadSentence =
    executiveSummary?.lead_sentence ||
    `ProdScope explored ${
      v2Report?.coverage_summary?.screens_reached ?? "the available"
    } unique screens and surfaced ${
      (v2Report?.critical_bugs?.length || 0) +
      (v2Report?.ux_issues?.length || 0) +
      (v2Report?.diligence_flags?.length || 0)
    } findings.`;

  const topFindings = pickTopFindings(v2Report, 3);
  const strengthCount = (v2Report?.diligence_flags || []).filter(
    (f) => f.severity === "strength"
  ).length;

  const findingsHtml = topFindings.length
    ? topFindings
        .map((f) => {
          const tok = severityToken(f.severity);
          const evidence = (f.evidence_screen_ids || [])[0] || "";
          const evidenceTag = evidence
            ? `<span style="display:inline-block;margin-left:8px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;color:#94A3B8;">${escapeHtml(
                evidence
              )}</span>`
            : "";
          return `
        <li style="margin:0 0 14px;padding:0;list-style:none;">
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
            <span style="display:inline-block;background:${tok.bg};color:${tok.color};border-radius:9999px;padding:2px 9px;font-size:10.5px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">
              ${escapeHtml(tok.label)}
            </span>
            <span style="font-size:14px;font-weight:600;color:#0F172A;line-height:1.45;">${escapeHtml(
              f.title || (f.claim || "").slice(0, 60)
            )}</span>
            ${evidenceTag}
          </div>
          <div style="margin-top:6px;font-size:13.5px;line-height:1.55;color:#475569;">
            ${escapeHtml(f.claim)}
          </div>
        </li>`;
        })
        .join("")
    : `<li style="margin:0;color:#475569;font-size:14px;list-style:none;">
          No material findings surfaced in this run.
        </li>`;

  const strengthsLine =
    strengthCount > 0
      ? `<div style="margin:18px 0 0;padding:10px 14px;background:#F0FDFA;border:1px solid rgba(20,184,166,0.22);border-radius:10px;font-size:13px;color:#0F766E;">
          <strong>${strengthCount} ${
        strengthCount === 1 ? "strength" : "strengths"
      } cited</strong> — areas where the build demonstrates craft worth highlighting in the full report.
        </div>`
      : "";

  const ctaBlock = shareUrl
    ? `<div style="margin:28px 0 8px;text-align:center;">
        <a href="${escapeHtml(shareUrl)}"
           style="display:inline-block;background:linear-gradient(120deg,#6C47FF 0%,#D62B4D 100%);color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:9999px;font-size:14.5px;font-weight:600;letter-spacing:-0.01em;box-shadow:0 4px 12px rgba(214,43,77,0.20);">
          Open the full report →
        </a>
        <div style="margin-top:10px;font-size:11.5px;color:#94A3B8;line-height:1.5;">
          Annotated screenshots, founder questions, and the full screen atlas live in the interactive report.
          <br>Forward this link to teammates — no login required. Keep it private.
        </div>
      </div>`
    : "";

  const heading = appName || packageName || "Your build";
  const subhead = packageName && appName ? packageName : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#FAFAFA;color:#0F172A;">
      <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:18px;padding:32px 28px;box-shadow:0 1px 3px rgba(15,23,42,0.04),0 8px 24px -12px rgba(15,23,42,0.08);">

        <!-- Header -->
        <div style="margin:0 0 6px;font-size:10.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#94A3B8;">
          ProdScope · Diligence Report
        </div>
        <h1 style="margin:6px 0 4px;font-size:26px;font-weight:600;color:#0F172A;line-height:1.2;letter-spacing:-0.02em;">
          ${escapeHtml(heading)}
        </h1>
        ${
          subhead
            ? `<div style="margin:0 0 18px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;color:#94A3B8;">${escapeHtml(
                subhead
              )}</div>`
            : `<div style="height:18px;"></div>`
        }

        <!-- Verdict -->
        <p style="margin:0 0 14px;font-size:17px;line-height:1.55;color:#0F172A;font-weight:500;letter-spacing:-0.01em;">
          ${escapeHtml(verdictClaim)}
        </p>
        <p style="margin:0 0 22px;font-size:14px;line-height:1.65;color:#475569;">
          ${escapeHtml(leadSentence)}
        </p>

        <!-- Top findings -->
        <div style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#94A3B8;">
          Top findings
        </div>
        <ul style="margin:8px 0 0;padding:0;">
          ${findingsHtml}
        </ul>

        ${strengthsLine}

        ${ctaBlock}

        <!-- Quiet footer -->
        <div style="margin:28px 0 0;padding:14px 0 0;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;line-height:1.6;">
          ${
            jobId
              ? `Report ID: <span style="font-family:ui-monospace,SFMono-Regular,monospace;">${escapeHtml(
                  jobId.slice(0, 12)
                )}</span><br>`
              : ""
          }
          Generated by ProdScope · automated mobile-app diligence.
        </div>

      </div>
    </div>
  `;
}

/**
 * V1-only fallback. Tight version — the old kitchen-sink layout was
 * removed because design-partner runs always have V2.
 *
 * @param {object} report  V1 report (parsed)
 * @param {object} options
 */
function renderV1FallbackBody(report, options = {}) {
  const shareUrl = options.shareUrl || null;
  const summary = report?.summary || "Analysis complete.";
  const score = report?.overall_score;
  const stats = report?.crawl_stats || report?.crawl_health || {};

  const ctaBlock = shareUrl
    ? `<div style="margin:24px 0 8px;text-align:center;">
        <a href="${escapeHtml(shareUrl)}"
           style="display:inline-block;background:linear-gradient(120deg,#6C47FF 0%,#D62B4D 100%);color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:600;">
          Open the full report →
        </a>
      </div>`
    : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;background:#FAFAFA;color:#0F172A;">
      <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:18px;padding:28px 24px;">
        <div style="margin:0 0 6px;font-size:10.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#94A3B8;">
          ProdScope · Report Ready
        </div>
        <h1 style="margin:6px 0 14px;font-size:22px;font-weight:600;color:#0F172A;line-height:1.25;">
          ${escapeHtml(report?.package_name || "Your build")}
        </h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:#475569;">
          ${escapeHtml(summary)}
        </p>
        ${
          typeof score === "number"
            ? `<div style="margin:0 0 14px;font-size:13px;color:#475569;">
                Overall quality: <strong style="color:#0F172A;">${score}/100</strong> · Steps: <strong>${
                stats.totalSteps || "?"
              }</strong> · Unique screens: <strong>${
                stats.uniqueStates || "?"
              }</strong>
              </div>`
            : ""
        }
        ${ctaBlock}
      </div>
    </div>
  `;
}

/**
 * Top-level renderer. Routes between V2 and V1-fallback based on payload
 * shape.
 *
 * Backward-compat: `renderReportEmail(reportText, analysesCount, options)`
 * still works (legacy V1 call sites).
 *
 * Modern path: `renderReportEmail({ v2Report, executiveSummary, appName,
 * packageName, jobId, report, shareUrl })`.
 */
function renderReportEmail(arg1, arg2, arg3) {
  // Modern path: single payload object.
  if (arg1 && typeof arg1 === "object" && (arg1.v2Report || arg1.executiveSummary || arg1.appName || arg1.report)) {
    if (arg1.v2Report) {
      return renderV2EmailBody({
        appName: arg1.appName,
        packageName: arg1.packageName,
        jobId: arg1.jobId,
        v2Report: arg1.v2Report,
        executiveSummary: arg1.executiveSummary || null,
        shareUrl: arg1.shareUrl || null,
      });
    }
    return renderV1FallbackBody(arg1.report, { shareUrl: arg1.shareUrl });
  }

  // Legacy path: stringified V1 report.
  const reportText = arg1;
  const options = arg3 || {};
  let report;
  const cleaned = String(reportText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    report = JSON.parse(cleaned);
  } catch {
    report = { summary: cleaned || "Report ready." };
  }
  return renderV1FallbackBody(report, { shareUrl: options.shareUrl });
}

module.exports = { renderReportEmail };
