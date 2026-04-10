/**
 * Shelfbreak — Structure Engine (Phase 1)
 *
 * Extracts support/resistance from CLOBr market-depth buckets,
 * computes structure metrics, classifies shelf quality, detects voids.
 */
import {
  SUPPORT_WINDOW, RESISTANCE_WINDOW, NEAR_ZONE,
  RELATIVE_STRONG, RELATIVE_GOOD,
  LOCAL_DOM_STRONG, LOCAL_DOM_GOOD,
  VOID_CLEAR, VOID_MILD,
  SUPPORT_CLOSE, SUPPORT_MAX,
  RESISTANCE_NEAR,
} from './config.mjs';

// ═══════════════════════════════════════════════════════════════
// 5.1 extractBuckets
// ═══════════════════════════════════════════════════════════════

/**
 * Convert raw depth_data to enriched buckets with pct_change from current price.
 * @param {object[]} depthData - Raw CLOBr depth_data array
 * @param {number} currentPrice - Current token price
 * @returns {object[]} Enriched buckets
 */
export function extractBuckets(depthData, currentPrice) {
  if (!depthData || !Array.isArray(depthData) || currentPrice <= 0) return [];

  return depthData.map(d => ({
    price: d.price,
    pct_change: (d.price - currentPrice) / currentPrice,
    supportTotal: (d.support ?? 0) + (d.constant_product ?? 0),
    resistanceTotal: (d.resistance ?? 0) + (d.constant_product ?? 0),
    raw_support: d.support ?? 0,
    raw_resistance: d.resistance ?? 0,
    constant_product: d.constant_product ?? 0,
  }));
}

// ═══════════════════════════════════════════════════════════════
// 5.2 findShelf
// ═══════════════════════════════════════════════════════════════

/**
 * Find the strongest shelf (support or resistance) within a price window.
 * @param {object[]} buckets - Enriched buckets from extractBuckets
 * @param {number[]} window - [low_pct, high_pct] range
 * @param {'support'|'resistance'} type - Which side to maximize
 * @returns {object|null} Best bucket or null if none in window
 */
export function findShelf(buckets, window, type) {
  const [lo, hi] = window;
  const inWindow = buckets.filter(b => b.pct_change >= lo && b.pct_change <= hi);

  if (inWindow.length === 0) return null;

  const key = type === 'support' ? 'supportTotal' : 'resistanceTotal';
  let best = inWindow[0];
  for (const b of inWindow) {
    if (b[key] > best[key]) best = b;
  }

  return best;
}

// ═══════════════════════════════════════════════════════════════
// 5.3 computeStructureMetrics
// ═══════════════════════════════════════════════════════════════

/**
 * Compute full structure metrics from enriched buckets.
 * @param {object[]} buckets - Enriched buckets
 * @param {number} currentPrice - P0
 * @returns {object} Structure metrics
 */
export function computeStructureMetrics(buckets, currentPrice) {
  const S1 = findShelf(buckets, SUPPORT_WINDOW, 'support');
  const R1 = findShelf(buckets, RESISTANCE_WINDOW, 'resistance');

  if (!S1 || !R1) {
    return {
      S1: null, R1: null,
      support_distance_pct: null,
      resistance_distance_pct: null,
      SR_ratio: null,
      relative_strength: null,
      local_dominance: null,
      insufficient: true,
    };
  }

  const support_distance_pct = Math.abs(S1.pct_change);
  const resistance_distance_pct = Math.abs(R1.pct_change);
  const SR_ratio = R1.resistanceTotal > 0 ? S1.supportTotal / R1.resistanceTotal : Infinity;

  // Relative strength: S1 support vs median support in the support window
  const supportBuckets = buckets.filter(b => b.pct_change >= SUPPORT_WINDOW[0] && b.pct_change <= SUPPORT_WINDOW[1]);
  const supportValues = supportBuckets.map(b => b.supportTotal).sort((a, b) => a - b);
  const medianSupport = supportValues.length > 0 ? supportValues[Math.floor(supportValues.length / 2)] : 0;
  const relative_strength = medianSupport > 0 ? S1.supportTotal / medianSupport : 0;

  // Local dominance: S1 support vs average resistance in the near zone
  const nearBuckets = buckets.filter(b => b.pct_change >= NEAR_ZONE[0] && b.pct_change <= NEAR_ZONE[1]);
  const nearResistanceAvg = nearBuckets.length > 0
    ? nearBuckets.reduce((s, b) => s + b.resistanceTotal, 0) / nearBuckets.length
    : 0;
  const local_dominance = nearResistanceAvg > 0 ? S1.supportTotal / nearResistanceAvg : Infinity;

  return {
    S1: {
      price: S1.price,
      strength: S1.supportTotal,
      distance_pct: support_distance_pct,
      pct_change: S1.pct_change,
    },
    R1: {
      price: R1.price,
      strength: R1.resistanceTotal,
      distance_pct: resistance_distance_pct,
      pct_change: R1.pct_change,
    },
    support_distance_pct,
    resistance_distance_pct,
    SR_ratio,
    relative_strength,
    local_dominance,
    insufficient: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// 5.4 classifyShelf
// ═══════════════════════════════════════════════════════════════

/**
 * Classify the quality of the support shelf.
 * @param {number} relative - Relative strength
 * @param {number} dominance - Local dominance
 * @param {number} distance - Support distance from current price (%)
 * @returns {'strong'|'good'|'weak'|'none'}
 */
export function classifyShelf(relative, dominance, distance) {
  if (relative >= RELATIVE_STRONG && dominance >= LOCAL_DOM_STRONG && distance <= SUPPORT_CLOSE + 0.01) return 'strong';
  if (relative >= RELATIVE_GOOD && dominance >= LOCAL_DOM_GOOD && distance <= SUPPORT_MAX) return 'good';
  if (relative >= 1.2) return 'weak';
  return 'none';
}

// ═══════════════════════════════════════════════════════════════
// 5.5 detectVoid
// ═══════════════════════════════════════════════════════════════

/**
 * Detect a support void in the near zone.
 * @param {object[]} buckets - Enriched buckets
 * @returns {'clear'|'mild'|'none'}
 */
export function detectVoid(buckets) {
  const nearBuckets = buckets.filter(b => b.pct_change >= NEAR_ZONE[0] && b.pct_change <= NEAR_ZONE[1]);
  const windowBuckets = buckets.filter(b => b.pct_change >= SUPPORT_WINDOW[0] && b.pct_change <= SUPPORT_WINDOW[1]);

  if (nearBuckets.length === 0 || windowBuckets.length === 0) return 'clear'; // no data = assume void

  const nearAvg = nearBuckets.reduce((s, b) => s + b.supportTotal, 0) / nearBuckets.length;

  // Median of support window
  const windowValues = windowBuckets.map(b => b.supportTotal).sort((a, b) => a - b);
  const windowMedian = windowValues[Math.floor(windowValues.length / 2)];

  if (windowMedian <= 0) return 'none'; // can't compute ratio

  const voidRatio = nearAvg / windowMedian;

  if (voidRatio < VOID_CLEAR) return 'clear';
  if (voidRatio < VOID_MILD) return 'mild';
  return 'none';
}

// ═══════════════════════════════════════════════════════════════
// 5.7 classifyStructure
// ═══════════════════════════════════════════════════════════════

/**
 * Final structure classification.
 * @param {string} shelfQuality - 'strong'|'good'|'weak'|'none'
 * @param {string} voidStatus - 'clear'|'mild'|'none'
 * @param {number} SR_ratio
 * @param {number} resistance_distance_pct
 * @returns {'supportive'|'capped'|'fragile'}
 */
export function classifyStructure(shelfQuality, voidStatus, SR_ratio, resistance_distance_pct) {
  if (voidStatus === 'clear') return 'fragile';

  if (shelfQuality === 'strong' || shelfQuality === 'good') {
    if (SR_ratio < 0.8 || resistance_distance_pct < RESISTANCE_NEAR) return 'capped';
    return 'supportive';
  }

  return 'fragile';
}
