/**
 * Shelfbreak — Scoring Engine (Sections 6 & 7)
 *
 * StructureScore (0-10) + DCAModifier (-2 to +2) + NansenModifier (-1 to +1)
 * = FinalScore → Decision
 */
import { RESISTANCE_NEAR } from './config.mjs';

// ═══════════════════════════════════════════════════════════════
// Structure Score (0-10)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute structure score from metrics.
 * @param {string} shelfQuality - 'strong'|'good'|'weak'|'none'
 * @param {string} voidStatus - 'clear'|'mild'|'none'
 * @param {object} metrics - Structure metrics from computeStructureMetrics
 * @returns {number} 0-10
 */
export function computeStructureScore(shelfQuality, voidStatus, metrics) {
  if (metrics.insufficient) return 0;

  let score = 0;

  // Shelf quality base
  switch (shelfQuality) {
    case 'strong': score = 8; break;
    case 'good':   score = 6; break;
    case 'weak':   score = 3; break;
    case 'none':   score = 1; break;
  }

  // Void penalty
  if (voidStatus === 'clear') score = Math.min(score, 2);
  else if (voidStatus === 'mild') score = Math.max(0, score - 1);

  // SR ratio bonus/penalty
  if (metrics.SR_ratio >= 1.5) score = Math.min(10, score + 1);
  else if (metrics.SR_ratio < 0.5) score = Math.max(0, score - 1);

  // Distance bonus: closer support is better
  if (metrics.support_distance_pct <= 0.04) score = Math.min(10, score + 1);

  return Math.max(0, Math.min(10, score));
}

// ═══════════════════════════════════════════════════════════════
// DCA Modifier (-2 to +2)
// ═══════════════════════════════════════════════════════════════

/**
 * @param {object} dca - DCA classification from computeDCA
 * @returns {number} -2 to +2
 */
export function computeDCAModifier(dca) {
  if (!dca) return 0;

  let mod = 0;

  // Bias
  if (dca.bias === 'bullish') mod += 1;
  else if (dca.bias === 'bearish') mod -= 1;

  // Stack below = additional support
  if (dca.stack_below) mod += 1;

  // Headwind above = resistance pressure
  if (dca.headwind_above) mod -= 1;

  return Math.max(-2, Math.min(2, mod));
}

// ═══════════════════════════════════════════════════════════════
// Nansen Modifier (-1 to +1)
// ═══════════════════════════════════════════════════════════════

/**
 * @param {object} nansen - { flow_bias, confluence }
 * @returns {number} -1 to +1
 */
export function computeNansenModifier(nansen) {
  if (!nansen) return 0;

  if (nansen.flow_bias === 'strong' && nansen.confluence === 'supportive') return 1;
  if (nansen.flow_bias === 'strong') return 1;
  if (nansen.flow_bias === 'weak' && nansen.confluence === 'conflicting') return -1;
  if (nansen.flow_bias === 'weak') return -1;

  return 0;
}

// ═══════════════════════════════════════════════════════════════
// Decision Logic (Section 7 — PRIORITY ORDER)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute final decision.
 * @param {number} finalScore
 * @param {number} structureScore
 * @param {number} dcaModifier
 * @param {string} voidStatus
 * @param {number} resistance_distance_pct
 * @param {number} SR_ratio
 * @param {boolean} dca_headwind_above
 * @returns {string} ALIGNED | SUPPORTED | CAPPED | FRAGILE | AVOID
 */
export function computeDecision(finalScore, structureScore, dcaModifier, voidStatus, resistance_distance_pct, SR_ratio, dca_headwind_above) {
  // Priority 1: AVOID
  if (structureScore < 3 || (structureScore <= 5 && dcaModifier <= -1)) {
    return 'AVOID';
  }

  // Priority 2: FRAGILE
  if (structureScore <= 5 || voidStatus === 'clear') {
    return 'FRAGILE';
  }

  // Priority 3: CAPPED
  if (
    structureScore >= 5 &&
    (resistance_distance_pct < RESISTANCE_NEAR || SR_ratio < 0.8 || dca_headwind_above)
  ) {
    return 'CAPPED';
  }

  // Priority 4: ALIGNED
  if (
    finalScore >= 9 &&
    structureScore >= 7 &&
    voidStatus === 'none'
  ) {
    return 'ALIGNED';
  }

  // Default: SUPPORTED
  return 'SUPPORTED';
}

// ═══════════════════════════════════════════════════════════════
// Full scoring pipeline
// ═══════════════════════════════════════════════════════════════

/**
 * Run full scoring for a token.
 * @param {object} params
 * @returns {object} Complete scoring result
 */
export function scoreToken({
  shelfQuality,
  voidStatus,
  structureMetrics,
  dca,
  nansen,
}) {
  const structureScore = computeStructureScore(shelfQuality, voidStatus, structureMetrics);
  const dcaModifier = computeDCAModifier(dca);
  const nansenModifier = computeNansenModifier(nansen);
  const finalScore = structureScore + dcaModifier + nansenModifier;

  const decision = computeDecision(
    finalScore,
    structureScore,
    dcaModifier,
    voidStatus,
    structureMetrics.resistance_distance_pct ?? 1,
    structureMetrics.SR_ratio ?? 1,
    dca?.headwind_above ?? false,
  );

  return {
    structureScore,
    dcaModifier,
    nansenModifier,
    finalScore,
    decision,
    components: {
      shelfQuality,
      voidStatus,
      SR_ratio: structureMetrics.SR_ratio,
      support_distance_pct: structureMetrics.support_distance_pct,
      resistance_distance_pct: structureMetrics.resistance_distance_pct,
      relative_strength: structureMetrics.relative_strength,
      local_dominance: structureMetrics.local_dominance,
    },
  };
}
