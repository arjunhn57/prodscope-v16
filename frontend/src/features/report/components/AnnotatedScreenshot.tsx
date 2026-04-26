import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../../../lib/constants";

/**
 * AnnotatedScreenshot — render a screenshot with the V2 annotation
 * overlay drawn at view time as inline SVG. The visual grammar mirrors
 * the backend annotator (output/annotator/style.js): single magenta
 * accent, severity-as-halo-intensity, confidence-as-halo-width,
 * numbered badges anchored at the top-left of each box.
 *
 * Falls back gracefully:
 *   - 404 on annotations.json -> renders the screenshot alone
 *   - SVG render fails -> shows the baked PNG via <img>
 *
 * Toggle on/off via the corner button so a reader can compare the
 * raw screen vs. the annotated view.
 */

// Mirrors the backend annotator's style.js — keep these in sync.
const ACCENT = "#D62B4D";
const STRENGTH_HALO = "#16A34A";
const SEVERITY_HALO_ALPHA: Record<string, number> = {
  concern: 0.55,
  watch_item: 0.32,
  strength: 0.22,
};
const CONFIDENCE_HALO_PX: Record<string, number> = {
  observed: 8,
  inferred: 5,
  hypothesis: 3,
};
const STROKE_PX = 2;
const BADGE_RADIUS = 14;

type Severity = "concern" | "watch_item" | "strength";
type Confidence = "observed" | "inferred" | "hypothesis";

interface ElementEntry {
  bounds: [number, number, number, number];
  label?: string;
}

interface ElementAnnotation {
  mode: "element";
  elementIndex: number;
  callout: string;
}

interface RegionAnnotation {
  mode: "region";
  bounds: { x1: number; y1: number; x2: number; y2: number };
  justification: string;
  callout: string;
}

interface WholeScreenAnnotation {
  mode: "whole_screen";
  callout: string;
}

interface AnnotatedFinding {
  screenId: string;
  finding: string;
  severity: Severity;
  confidence: Confidence;
  annotation: ElementAnnotation | RegionAnnotation | WholeScreenAnnotation;
}

interface ScreenAnnotations {
  screenId: string;
  width: number;
  height: number;
  elements: ElementEntry[];
  findings: AnnotatedFinding[];
}

interface AnnotatedScreenshotProps {
  jobId: string;
  screenId: string;
  screenshotUrl: string;
  alt?: string;
  className?: string;
  /** Initial state of the annotation toggle. Defaults to true. */
  initialAnnotated?: boolean;
  /**
   * Phase B3: when rendered as an atlas thumbnail, hide the toggle
   * button (no room for it) and shrink the annotation overlay so
   * marks remain readable at ~180px wide. The screenshot itself
   * stays full quality.
   */
  compact?: boolean;
}

function buildAnnotationsUrl(jobId: string, screenId: string): string {
  const base = API_BASE.startsWith("http")
    ? API_BASE
    : `${window.location.origin}${API_BASE.startsWith("/") ? "" : "/"}${API_BASE}`;
  return `${base.replace(/\/$/, "")}/jobs/${jobId}/annotations/${screenId}`;
}

function haloColorFor(severity: Severity): string {
  return severity === "strength" ? STRENGTH_HALO : ACCENT;
}

export function AnnotatedScreenshot({
  jobId,
  screenId,
  screenshotUrl,
  alt,
  className,
  initialAnnotated = true,
  compact = false,
}: AnnotatedScreenshotProps) {
  const [annotations, setAnnotations] = useState<ScreenAnnotations | null>(null);
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ready" | "missing" | "error">(
    "idle",
  );
  const [showAnnotations, setShowAnnotations] = useState(initialAnnotated);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [renderedSize, setRenderedSize] = useState<{ width: number; height: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch annotations once on mount / when jobId or screenId changes.
  useEffect(() => {
    let cancelled = false;
    setLoadStatus("loading");
    setAnnotations(null);
    fetch(buildAnnotationsUrl(jobId, screenId))
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setLoadStatus("missing");
          return;
        }
        if (!res.ok) {
          setLoadStatus("error");
          return;
        }
        const json = (await res.json()) as ScreenAnnotations;
        setAnnotations(json);
        setLoadStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, screenId]);

  // Track rendered image size for SVG viewBox -> CSS pixel mapping.
  // ResizeObserver keeps the overlay aligned across container resizes.
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!imgRef.current) return;
      const w = imgRef.current.clientWidth;
      const h = imgRef.current.clientHeight;
      if (w > 0 && h > 0) setRenderedSize({ width: w, height: h });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Split findings into bounded vs. whole-screen for layout — the
  // bounded ones are SVG overlays, the whole-screen ones are caption rows.
  const { bounded, wholeScreen } = useMemo<{
    bounded: Array<{ finding: AnnotatedFinding; index: number }>;
    wholeScreen: Array<{ finding: AnnotatedFinding; index: number }>;
  }>(() => {
    if (!annotations) return { bounded: [], wholeScreen: [] };
    const b: Array<{ finding: AnnotatedFinding; index: number }> = [];
    const ws: Array<{ finding: AnnotatedFinding; index: number }> = [];
    annotations.findings.forEach((f, i) => {
      if (f.annotation.mode === "whole_screen") ws.push({ finding: f, index: i });
      else b.push({ finding: f, index: i });
    });
    return { bounded: b, wholeScreen: ws };
  }, [annotations]);

  const showOverlay = showAnnotations && loadStatus === "ready" && annotations !== null;

  return (
    <div ref={containerRef} className={className} style={{ position: "relative", display: "inline-block" }}>
      <img
        ref={imgRef}
        src={screenshotUrl}
        alt={alt || `Screenshot ${screenId}`}
        onLoad={(e) => {
          const img = e.currentTarget;
          setRenderedSize({ width: img.clientWidth, height: img.clientHeight });
        }}
        style={{ display: "block", maxWidth: "100%", height: "auto" }}
        draggable={false}
      />

      {showOverlay && annotations && renderedSize && (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${annotations.width} ${annotations.height}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: renderedSize.width,
            height: renderedSize.height,
            pointerEvents: "none",
          }}
        >
          {bounded.map(({ finding, index }) => (
            <AnnotationOverlay
              key={index}
              finding={finding}
              elements={annotations.elements}
              imageWidth={annotations.width}
              imageHeight={annotations.height}
              badgeNumber={index + 1}
              hovered={hoveredIdx === index}
            />
          ))}
        </svg>
      )}

      {/* Tooltip + click targets are HTML overlays so they get pointer events */}
      {showOverlay && annotations && renderedSize && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: renderedSize.width,
            height: renderedSize.height,
            pointerEvents: "none",
          }}
        >
          {bounded.map(({ finding, index }) => (
            <BadgeHotspot
              key={index}
              finding={finding}
              elements={annotations.elements}
              imageWidth={annotations.width}
              imageHeight={annotations.height}
              renderedWidth={renderedSize.width}
              renderedHeight={renderedSize.height}
              badgeNumber={index + 1}
              onHover={(h) => setHoveredIdx(h ? index : null)}
              isHovered={hoveredIdx === index}
            />
          ))}
        </div>
      )}

      {/* Whole-screen captions strip */}
      {showOverlay && wholeScreen.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(15, 23, 42, 0.92)",
            color: "#F8FAFC",
            padding: "8px 10px",
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 12,
            lineHeight: 1.45,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {wholeScreen.map(({ finding, index }) => (
            <div key={index}>
              <span style={{ fontWeight: 600 }}>({index + 1})</span> {finding.annotation.callout}
            </div>
          ))}
        </div>
      )}

      {/* Toggle button (top-right corner) — only when annotations are ready
          and not in compact mode (atlas thumbnails don't have room). */}
      {!compact && loadStatus === "ready" && annotations && (
        <button
          type="button"
          onClick={() => setShowAnnotations((s) => !s)}
          aria-pressed={showAnnotations}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "4px 10px",
            borderRadius: 999,
            border: "1px solid rgba(15, 23, 42, 0.12)",
            background: showAnnotations ? "#0F172A" : "rgba(255,255,255,0.92)",
            color: showAnnotations ? "#F8FAFC" : "#0F172A",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            cursor: "pointer",
            backdropFilter: "blur(4px)",
            boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
          }}
        >
          {showAnnotations ? "Hide annotations" : "Show annotations"}
        </button>
      )}
    </div>
  );
}

interface OverlayProps {
  finding: AnnotatedFinding;
  elements: ElementEntry[];
  imageWidth: number;
  imageHeight: number;
  badgeNumber: number;
  hovered: boolean;
}

function AnnotationOverlay({
  finding,
  elements,
  imageWidth,
  imageHeight,
  badgeNumber: _badgeNumber,
  hovered,
}: OverlayProps) {
  const box = resolveBox(finding, elements, imageWidth, imageHeight);
  if (!box) return null;
  const { x, y, w, h } = box;
  const dashed = finding.annotation.mode === "region";
  const haloColor = haloColorFor(finding.severity);
  const haloAlpha = SEVERITY_HALO_ALPHA[finding.severity] ?? SEVERITY_HALO_ALPHA.watch_item;
  const haloPx = CONFIDENCE_HALO_PX[finding.confidence] ?? CONFIDENCE_HALO_PX.inferred;
  const baseStroke = STROKE_PX;
  const haloStroke = baseStroke + haloPx;

  return (
    <g opacity={hovered ? 1 : 0.95}>
      {/* Halo */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={haloColor}
        strokeWidth={haloStroke}
        strokeLinejoin="round"
        opacity={haloAlpha}
      />
      {/* Main stroke */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={ACCENT}
        strokeWidth={baseStroke}
        strokeDasharray={dashed ? "10 6" : undefined}
      />
    </g>
  );
}

interface HotspotProps {
  finding: AnnotatedFinding;
  elements: ElementEntry[];
  imageWidth: number;
  imageHeight: number;
  renderedWidth: number;
  renderedHeight: number;
  badgeNumber: number;
  onHover: (hovered: boolean) => void;
  isHovered: boolean;
}

function BadgeHotspot({
  finding,
  elements,
  imageWidth,
  imageHeight,
  renderedWidth,
  renderedHeight,
  badgeNumber,
  onHover,
  isHovered,
}: HotspotProps) {
  const box = resolveBox(finding, elements, imageWidth, imageHeight);
  if (!box) return null;
  const sx = renderedWidth / imageWidth;
  const sy = renderedHeight / imageHeight;
  // Badge anchors at the top-left of the box, half-outside.
  const cx = box.x * sx;
  const cy = box.y * sy;
  const r = BADGE_RADIUS;

  return (
    <div
      style={{
        position: "absolute",
        left: cx - r,
        top: cy - r,
        width: r * 2,
        height: r * 2,
        pointerEvents: "auto",
      }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <button
        type="button"
        aria-label={`Annotation ${badgeNumber}: ${finding.finding}`}
        style={{
          width: r * 2,
          height: r * 2,
          borderRadius: "50%",
          background: ACCENT,
          color: "#FFFFFF",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          border: "2px solid #FFFFFF",
          boxShadow: "0 1px 3px rgba(15,23,42,0.25)",
          cursor: "default",
          padding: 0,
          lineHeight: 1,
        }}
      >
        {badgeNumber}
      </button>

      {isHovered && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: r * 2 + 6,
            left: 0,
            minWidth: 220,
            maxWidth: 360,
            padding: "8px 10px",
            background: "rgba(15, 23, 42, 0.96)",
            color: "#F8FAFC",
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 12,
            lineHeight: 1.45,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(15, 23, 42, 0.35)",
            pointerEvents: "none",
            zIndex: 10,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {finding.annotation.callout}
          </div>
          <div style={{ opacity: 0.9 }}>{finding.finding}</div>
          <div style={{ marginTop: 6, fontSize: 10.5, opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {finding.severity.replace("_", " ")} · {finding.confidence}
          </div>
        </div>
      )}
    </div>
  );
}

function resolveBox(
  finding: AnnotatedFinding,
  elements: ElementEntry[],
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; w: number; h: number } | null {
  if (finding.annotation.mode === "element") {
    const el = elements[finding.annotation.elementIndex];
    if (!el) return null;
    const [x1, y1, x2, y2] = el.bounds;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  if (finding.annotation.mode === "region") {
    const b = finding.annotation.bounds;
    return {
      x: b.x1 * imageWidth,
      y: b.y1 * imageHeight,
      w: (b.x2 - b.x1) * imageWidth,
      h: (b.y2 - b.y1) * imageHeight,
    };
  }
  return null;
}
