"use strict";

/**
 * dedup.js — Flow and screen deduplication
 *
 * Decides whether a screen/flow is a meaningful new variation or a duplicate
 * of something already explored, using fuzzy fingerprints and structural
 * similarity.
 */

class FlowDeduplicator {
  constructor() {
    // feature → Set of flow fingerprints
    this.seenFlowFingerprints = {};
    // feature → { seenLabels: Set, hasVideo: bool, avgInputCount: number }
    this.featureProfiles = {};
  }

  /**
   * Register a completed flow so future duplicates can be skipped.
   */
  registerFlow(flow) {
    const feature = flow.feature || "unknown";

    if (!this.seenFlowFingerprints[feature]) {
      this.seenFlowFingerprints[feature] = new Set();
    }
    if (flow.fingerprint) {
      this.seenFlowFingerprints[feature].add(flow.fingerprint);
    }
  }

  /**
   * Check if a flow fingerprint has already been seen for this feature.
   */
  isFlowDuplicate(feature, flowFingerprint) {
    const seen = this.seenFlowFingerprints[feature];
    return seen ? seen.has(flowFingerprint) : false;
  }

  /**
   * Decide whether we should skip exploring from this screen.
   * Uses fuzzy fingerprint comparison against known screens in the same
   * feature category.
   *
   * @param {string} feature - Feature category
   * @param {string} fuzzyFp - Fuzzy fingerprint of current screen
   * @param {Set} seenFuzzyFps - Set of fuzzy fps already seen in this feature
   * @param {string} xml - Raw XML for meaningful-difference checks
   * @returns {{ skip: boolean, reason: string }}
   */
  shouldSkipScreen(feature, fuzzyFp, seenFuzzyFps, xml) {
    if (!seenFuzzyFps || seenFuzzyFps.size === 0) {
      return { skip: false, reason: "new_feature" };
    }

    // Exact fuzzy match = same structure, different content (e.g. two product pages)
    if (seenFuzzyFps.has(fuzzyFp)) {
      // Check for meaningful variation
      const diff = this._findMeaningfulDifferences(feature, xml);
      if (diff.hasMeaningfulDifference) {
        return { skip: false, reason: "meaningful_variation" };
      }
      return { skip: true, reason: "fuzzy_duplicate" };
    }

    return { skip: false, reason: "new_structure" };
  }

  /**
   * Update the feature profile with new information from a screen.
   */
  updateFeatureProfile(feature, xml) {
    if (!this.featureProfiles[feature]) {
      this.featureProfiles[feature] = {
        seenLabels: new Set(),
        hasVideo: false,
        inputCounts: [],
      };
    }

    const profile = this.featureProfiles[feature];

    // Extract labels from XML
    const labels = xml.match(/text="([^"]+)"/gi);
    if (labels) {
      for (const l of labels) {
        const m = l.match(/text="([^"]+)"/i);
        if (m) profile.seenLabels.add(m[1].toLowerCase());
      }
    }

    if (/video|reel|clip/i.test(xml)) profile.hasVideo = true;

    const editTexts = xml.match(/class="android\.widget\.EditText"/gi);
    profile.inputCounts.push(editTexts ? editTexts.length : 0);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _findMeaningfulDifferences(feature, xml) {
    const profile = this.featureProfiles[feature];
    if (!profile) return { hasMeaningfulDifference: true };

    // Check for new action labels not seen before in this feature
    const currentLabels = [];
    const labelMatches = xml.match(/text="([^"]+)"/gi);
    if (labelMatches) {
      for (const l of labelMatches) {
        const m = l.match(/text="([^"]+)"/i);
        if (m) currentLabels.push(m[1].toLowerCase());
      }
    }

    const newLabels = currentLabels.filter((l) => !profile.seenLabels.has(l));
    const hasNewActionTypes = newLabels.length > 3;

    // Check for video content not previously seen
    const hasNewMediaType = /video|reel|clip/i.test(xml) && !profile.hasVideo;

    // Check for different number of input fields
    const editTexts = xml.match(/class="android\.widget\.EditText"/gi);
    const currentInputCount = editTexts ? editTexts.length : 0;
    const avgInputCount =
      profile.inputCounts.length > 0
        ? profile.inputCounts.reduce((a, b) => a + b, 0) / profile.inputCounts.length
        : 0;
    const hasNewInputFields = Math.abs(currentInputCount - avgInputCount) >= 2;

    return {
      hasMeaningfulDifference: hasNewActionTypes || hasNewMediaType || hasNewInputFields,
      hasNewActionTypes,
      hasNewMediaType,
      hasNewInputFields,
    };
  }
}

module.exports = { FlowDeduplicator };
