"use strict";

/**
 * email-renderer.js — Professional HTML email report renderer
 *
 * Converts structured JSON report (from report-builder.js) into a polished,
 * responsive HTML email with: app metadata, score, summary, coverage breakdown,
 * deterministic findings, AI findings, suggestions, and crawl health stats.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// -------------------------------------------------------------------------
// Reusable rendering helpers
// -------------------------------------------------------------------------

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;font-size:14px;">None found</p>';
  }
  return (
    '<ul style="margin:8px 0 0 18px;padding:0;color:#111827;">' +
    items.map((item) => `<li style="margin:6px 0;line-height:1.5;">${escapeHtml(item)}</li>`).join("") +
    "</ul>"
  );
}

function renderCard(item, colors) {
  if (typeof item === "string") {
    return `<div style="border:1px solid ${colors.border};border-radius:10px;padding:12px 16px;margin:8px 0;background:${colors.bg};">
      <div style="color:#111827;line-height:1.6;font-size:14px;">${escapeHtml(item)}</div>
    </div>`;
  }

  const title = item.title || item.category || item.id || "Finding";
  const severity = item.severity
    ? `<span style="display:inline-block;background:${severityColor(item.severity)};color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;margin-left:8px;">${escapeHtml(item.severity).toUpperCase()}</span>`
    : "";
  const confidence = item.confidence
    ? `<span style="font-size:11px;color:#6b7280;margin-left:6px;">(${Math.round(item.confidence * 100)}% confidence)</span>`
    : "";
  const desc = item.description
    ? `<div style="margin-top:6px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(item.description)}</div>`
    : "";
  const detail = item.detail
    ? `<div style="margin-top:6px;color:#374151;line-height:1.5;font-size:14px;">${escapeHtml(item.detail)}</div>`
    : "";
  const impact = item.impact
    ? `<div style="margin-top:4px;font-size:12px;color:#6b7280;">Impact: ${escapeHtml(item.impact)}</div>`
    : "";
  const items = Array.isArray(item.items) ? renderList(item.items) : "";
  const recommendations = Array.isArray(item.recommendations) ? renderList(item.recommendations) : "";
  const fixes = Array.isArray(item.fixes) ? renderList(item.fixes) : "";
  const issues = Array.isArray(item.issues) ? renderList(item.issues) : "";

  return `<div style="border:1px solid ${colors.border};border-radius:10px;padding:12px 16px;margin:8px 0;background:${colors.bg};">
    <div style="font-weight:700;color:#111827;font-size:14px;">${escapeHtml(title)}${severity}${confidence}</div>
    ${desc}${detail}${issues}${recommendations}${fixes}${items}${impact}
  </div>`;
}

function renderCards(items, colors) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;font-size:14px;">None found</p>';
  }
  return items.map((item) => renderCard(item, colors)).join("");
}

function severityColor(severity) {
  const s = (severity || "").toLowerCase();
  if (s === "critical") return "#dc2626";
  if (s === "high") return "#ea580c";
  if (s === "medium") return "#d97706";
  if (s === "low") return "#2563eb";
  return "#6b7280";
}

function scoreColor(score) {
  if (score >= 80) return { bg: "#f0fdf4", text: "#15803d", border: "#bbf7d0" };
  if (score >= 60) return { bg: "#fefce8", text: "#a16207", border: "#fde68a" };
  if (score >= 40) return { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa" };
  return { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" };
}

// -------------------------------------------------------------------------
// Coverage summary renderer
// -------------------------------------------------------------------------

function renderCoverage(coverage) {
  if (!coverage) return "";

  const summary = coverage.summary || coverage;
  if (typeof summary !== "object") return "";

  const entries = Object.entries(summary);
  if (entries.length === 0) return "";

  const rows = entries.map(([feature, data]) => {
    const status = (data.status || "unknown").toLowerCase();
    const statusColor = status === "saturated" ? "#15803d" : status === "covered" ? "#2563eb" : status === "exploring" ? "#d97706" : "#6b7280";
    const screens = data.uniqueScreens || 0;
    const visits = data.visitCount || 0;

    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;">${escapeHtml(feature)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${screens}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;">${visits}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;"><span style="color:${statusColor};font-weight:600;">${escapeHtml(status)}</span></td>
    </tr>`;
  }).join("");

  return `
    <div style="margin:0 0 24px;">
      <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Coverage Breakdown</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;">Feature</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Screens</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Visits</th>
            <th style="padding:8px 12px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// -------------------------------------------------------------------------
// Deterministic findings renderer
// -------------------------------------------------------------------------

function renderDeterministicFindings(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return "";

  return `
    <div style="margin:0 0 24px;">
      <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Automated Findings</h2>
      <p style="margin:0 0 10px;color:#6b7280;font-size:13px;">Detected automatically during crawl — zero AI tokens used</p>
      ${renderCards(findings, { bg: "#fef2f2", border: "#fecaca" })}
    </div>
  `;
}

// -------------------------------------------------------------------------
// Main renderer
// -------------------------------------------------------------------------

function renderShareCta(shareUrl) {
  if (!shareUrl) return "";
  const safe = escapeHtml(shareUrl);
  return `
        <div style="margin:0 0 20px;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">
          <div style="font-size:13px;color:#1e3a8a;margin-bottom:8px;font-weight:600;">Full interactive report</div>
          <a href="${safe}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">View full report online &rarr;</a>
          <div style="font-size:12px;color:#475569;margin-top:10px;line-height:1.5;">Forward this link to teammates — no login required. Keep it private.</div>
        </div>`;
}

function renderReportEmail(reportText, analysesCount, options = {}) {
  const shareUrl = options && options.shareUrl ? options.shareUrl : null;
  let report;
  const cleanedReportText = String(reportText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    report = JSON.parse(cleanedReportText);
  } catch (e) {
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
          <h1 style="margin:0 0 8px;font-size:24px;">ProdScope QA Report</h1>
          <p style="margin:0 0 16px;color:#6b7280;">Could not format structured report. Raw output below.</p>
          ${renderShareCta(shareUrl)}
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.5;">${escapeHtml(cleanedReportText)}</div>
        </div>
      </div>
    `;
  }

  // Extract metadata
  const score = report.overall_score;
  const sc = scoreColor(typeof score === "number" ? score : 0);
  const health = report.crawl_health || {};
  const stats = report.crawl_stats || {};
  const tokenUsage = report.token_usage || {};
  const pkgName = report.package_name || report.packageName || "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;">

        <!-- Header -->
        <div style="margin:0 0 20px;">
          <h1 style="margin:0 0 4px;font-size:24px;color:#111827;">ProdScope QA Report</h1>
          ${pkgName ? `<p style="margin:0;color:#6b7280;font-size:14px;">${escapeHtml(pkgName)}</p>` : ""}
        </div>

        ${renderShareCta(shareUrl)}

        <!-- Stats bar -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin:0 0 20px;">
          <div style="background:${sc.bg};border:1px solid ${sc.border};border-radius:10px;padding:12px 18px;text-align:center;min-width:100px;">
            <div style="font-size:28px;font-weight:800;color:${sc.text};">${typeof score === "number" ? score : "N/A"}</div>
            <div style="font-size:11px;color:${sc.text};font-weight:600;">SCORE</div>
          </div>
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;text-align:center;min-width:80px;">
            <div style="font-size:22px;font-weight:700;color:#111827;">${stats.totalSteps || health.totalSteps || "?"}</div>
            <div style="font-size:11px;color:#6b7280;font-weight:600;">STEPS</div>
          </div>
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;text-align:center;min-width:80px;">
            <div style="font-size:22px;font-weight:700;color:#111827;">${stats.uniqueStates || health.uniqueStates || "?"}</div>
            <div style="font-size:11px;color:#6b7280;font-weight:600;">SCREENS</div>
          </div>
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;text-align:center;min-width:80px;">
            <div style="font-size:22px;font-weight:700;color:#111827;">${analysesCount || health.aiScreensAnalyzed || 0}</div>
            <div style="font-size:11px;color:#6b7280;font-weight:600;">AI ANALYZED</div>
          </div>
        </div>

        <!-- Summary -->
        <div style="margin:0 0 24px;padding:16px;background:#f3f4f6;border-radius:12px;">
          <h2 style="margin:0 0 8px;font-size:18px;color:#111827;">Summary</h2>
          <div style="color:#374151;line-height:1.7;font-size:14px;">${escapeHtml(report.summary || "No summary available.")}</div>
        </div>

        <!-- Critical Bugs -->
        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Critical Bugs</h2>
          ${renderCards(report.critical_bugs || [], { bg: "#fef2f2", border: "#fecaca" })}
        </div>

        <!-- UX Issues -->
        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">UX Issues</h2>
          ${renderCards(report.ux_issues || [], { bg: "#eff6ff", border: "#bfdbfe" })}
        </div>

        <!-- Suggestions -->
        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Suggestions</h2>
          ${renderCards(report.suggestions || [], { bg: "#eff6ff", border: "#bfdbfe" })}
        </div>

        <!-- Quick Wins -->
        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;color:#111827;">Quick Wins</h2>
          ${renderCards(report.quick_wins || [], { bg: "#f0fdf4", border: "#bbf7d0" })}
        </div>

        <!-- Deterministic Findings (oracle) -->
        ${renderDeterministicFindings(report.deterministic_findings)}

        <!-- Coverage Breakdown -->
        ${renderCoverage(report.coverage)}

        <!-- Crawl Health -->
        <div style="margin:0 0 20px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
          <h2 style="margin:0 0 8px;font-size:16px;color:#111827;">Crawl Health</h2>
          <div style="font-size:13px;color:#374151;line-height:1.8;">
            Stop reason: <strong>${escapeHtml(health.stopReason || stats.stopReason || "unknown")}</strong><br>
            ${health.oracleFindingsCount != null ? `Oracle findings: <strong>${health.oracleFindingsCount}</strong><br>` : ""}
            ${health.aiScreensAnalyzed != null ? `AI screens analyzed: <strong>${health.aiScreensAnalyzed}</strong> (${health.aiScreensSkipped || 0} skipped by triage)<br>` : ""}
          </div>
        </div>

        <!-- Footer -->
        <div style="margin:20px 0 0;padding:14px 0 0;border-top:1px solid #e5e7eb;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.6;">
            Generated by ProdScope automated app testing<br>
            ${tokenUsage.input_tokens ? `Tokens used: ${(tokenUsage.input_tokens || 0) + (tokenUsage.output_tokens || 0)} (${tokenUsage.input_tokens} in / ${tokenUsage.output_tokens} out)` : ""}
          </div>
        </div>

      </div>
    </div>
  `;
}

module.exports = { renderReportEmail };
