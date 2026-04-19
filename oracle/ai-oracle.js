"use strict";

/**
 * ai-oracle.js — Gated LLM analysis on flagged screens only
 *
 * Replaces the per-screenshot LLM loop. Only screens that pass triage
 * get sent to Claude Haiku (vision). Uses compressed context from
 * brain/context-builder.js.
 */

const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { logger } = require("../lib/logger");
const log = logger.child({ component: "ai-oracle" });
const { ANALYSIS_MODEL } = require("../config/defaults");
const { buildScreenAnalysisPrompt } = require("../brain/context-builder");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Run deep AI analysis on a single screen (vision).
 * ~800 tokens input, ~300 tokens output.
 *
 * @param {Object} screen - Screen object with path, xml, screenType, activity, feature
 * @param {Object} context - Compressed context from context-builder
 * @returns {{ bugs: Array, ux_issues: Array, suggestions: Array, accessibility: Array, tokenUsage: Object }}
 */
async function deepCheck(screen, context) {
  const fallback = {
    bugs: [],
    ux_issues: [],
    suggestions: [],
    accessibility: [],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
  };

  if (!screen.path || !fs.existsSync(screen.path)) {
    return fallback;
  }

  try {
    const imgData = fs.readFileSync(screen.path).toString("base64");
    const prompt = buildScreenAnalysisPrompt(screen, context);

    const response = await anthropic.messages.create({
      model: ANALYSIS_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: imgData,
              },
            },
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
    });

    const raw = response.content[0].text;
    const tokenUsage = {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    };

    // Parse response
    let parsed;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // If JSON parse fails, wrap raw text as a single finding
      parsed = {
        bugs: [],
        ux_issues: [{ desc: raw.substring(0, 500), severity: "medium" }],
        suggestions: [],
        accessibility: [],
      };
    }

    return {
      bugs: parsed.bugs || [],
      ux_issues: parsed.ux_issues || [],
      suggestions: parsed.suggestions || [],
      accessibility: parsed.accessibility || [],
      tokenUsage,
    };
  } catch (e) {
    log.error({ err: e, step: screen.step }, "Analysis failed");
    return {
      ...fallback,
      ux_issues: [{ desc: `AI analysis failed: ${e.message}`, severity: "unknown" }],
    };
  }
}

/**
 * Analyze multiple triaged screens.
 *
 * @param {Array} screens - Screens selected by triage
 * @param {Object} contextData - Shared context (coverage, flows, plan)
 * @returns {{ analyses: Array, totalTokens: { input_tokens: number, output_tokens: number } }}
 */
async function analyzeTriagedScreens(screens, contextData) {
  const analyses = [];
  const totalTokens = { input_tokens: 0, output_tokens: 0 };

  for (const screen of screens) {
    log.info({ step: screen.step, screenType: screen.screenType }, "Analyzing step");

    const result = await deepCheck(screen, contextData);
    analyses.push({
      step: screen.step,
      screenType: screen.screenType,
      feature: screen.feature,
      ...result,
    });

    totalTokens.input_tokens += result.tokenUsage.input_tokens;
    totalTokens.output_tokens += result.tokenUsage.output_tokens;
  }

  log.info({ screensAnalyzed: analyses.length, inputTokens: totalTokens.input_tokens, outputTokens: totalTokens.output_tokens }, "Analysis complete");

  return { analyses, totalTokens };
}

module.exports = { deepCheck, analyzeTriagedScreens };
