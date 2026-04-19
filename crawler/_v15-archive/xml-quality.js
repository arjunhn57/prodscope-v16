"use strict";

/**
 * xml-quality.js — Assess XML dump reliability for the current step.
 *
 * Returns a quality score (0.0–1.0) indicating how much to trust
 * XML-based fingerprinting and action extraction vs. vision-based.
 *
 * Score < 0.4 → vision-primary mode (use screenshot FP, always call vision)
 * Score >= 0.4 → XML-primary mode (use XML FP, vision only on low confidence)
 */

/**
 * @param {string|null} xml - Raw XML dump
 * @param {{ type: string, confidence: number, framework?: string }} classification - Screen classification result
 * @param {number} actionCount - Number of actions extracted from XML
 * @returns {{ score: number, reasons: string[], visionPrimary: boolean }}
 */
function assessXmlQuality(xml, classification, actionCount) {
  let score = 1.0;
  const reasons = [];

  if (!xml || xml.length < 50) {
    return { score: 0.0, reasons: ["no_xml"], visionPrimary: true };
  }

  // Count meaningful nodes (elements with bounds)
  const nodeCount = (xml.match(/bounds="/g) || []).length;
  if (nodeCount < 10) {
    score -= 0.3;
    reasons.push(`low_node_count:${nodeCount}`);
  }

  // Detect obfuscated frameworks — check both XML patterns and classifier's framework flag
  let frameworkDetected = false;
  const classifiedFw = classification && classification.framework;
  const isNonNativeClassified = classifiedFw && classifiedFw !== 'native' && classifiedFw !== 'unknown';
  if (isNonNativeClassified) {
    // Screen-classifier already detected a non-native framework
    frameworkDetected = true;
    reasons.push(`framework:${classifiedFw}`);
  } else {
    const isCompose = xml.includes("ComposeView") ||
      (xml.match(/class="android\.view\.View"/g) || []).length > nodeCount * 0.5;
    const isFlutter = xml.includes("io.flutter") ||
      (xml.match(/class="android\.view\.View"/g) || []).length > nodeCount * 0.6;
    const isRN = xml.includes("com.facebook.react") ||
      xml.includes("com.horcrux.svg");
    if (isCompose || isFlutter || isRN) {
      frameworkDetected = true;
      const fw = isCompose ? "compose" : isFlutter ? "flutter" : "react_native";
      reasons.push(`framework:${fw}`);
    }
  }
  if (frameworkDetected) score -= 0.4;

  // Few extractable actions
  if (actionCount < 3) {
    score -= 0.2;
    reasons.push(`low_actions:${actionCount}`);
  }

  // Low classifier confidence (strong signal for non-native apps)
  if (classification && classification.confidence < 0.3) {
    score -= 0.2;
    reasons.push(`low_confidence:${classification.confidence}`);
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    reasons,
    visionPrimary: score <= 0.4,
  };
}

module.exports = { assessXmlQuality };
