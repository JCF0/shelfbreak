#!/usr/bin/env node
/**
 * Shelfbreak — Phase 1 Structure Test
 *
 * Runs the full pipeline on cached data. Zero API calls.
 */
import { setDevMode } from './src/cache.mjs';
import { fetchScreener, fetchFlowIntelligence } from './src/nansen.mjs';
import { fetchMarketDepth, fetchScore, fetchDCAOrders } from './src/clobr.mjs';
import { prefilterTokens } from './src/prefilter.mjs';
import { extractBuckets, computeStructureMetrics, classifyShelf, detectVoid, classifyStructure } from './src/structure.mjs';
import { computeDCA } from './src/dca.mjs';
import { scoreToken } from './src/scoring.mjs';

// Force dev mode — cache only, no live API calls
setDevMode(true);

console.log(`╔══════════════════════════════════════════════╗`);
console.log(`║  Shelfbreak — Structure Test (cached data)  ║`);
console.log(`╚══════════════════════════════════════════════╝\n`);

// Load screener from cache
const screener = await fetchScreener();
const { valid } = prefilterTokens(screener.tokens, 5);

console.log(`\nTokens: ${valid.map(t => t.token_symbol).join(', ')}\n`);

for (const token of valid) {
  const addr = token.token_address;
  const sym = token.token_symbol;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${sym} (${addr.slice(0, 12)}...)`);
  console.log(`${'═'.repeat(60)}`);

  // Load cached data
  const depthResult = await fetchMarketDepth(addr);
  const dcaResult = await fetchDCAOrders(addr);
  const nansenResult = await fetchFlowIntelligence(addr);

  if (!depthResult.data || !depthResult.data.depth_data) {
    console.log(`  ⚠ INSUFFICIENT_DATA: No CLOBr depth data`);
    continue;
  }

  const currentPrice = depthResult.data.price;
  console.log(`  Price: $${currentPrice.toFixed(6)}`);

  // Structure analysis
  const buckets = extractBuckets(depthResult.data.depth_data, currentPrice);
  console.log(`  Buckets: ${buckets.length}`);

  const metrics = computeStructureMetrics(buckets, currentPrice);
  if (metrics.insufficient) {
    console.log(`  ⚠ INSUFFICIENT_DATA: Cannot compute S1/R1`);
    continue;
  }

  const shelfQuality = classifyShelf(metrics.relative_strength, metrics.local_dominance, metrics.support_distance_pct);
  const voidStatus = detectVoid(buckets);
  const structureClass = classifyStructure(shelfQuality, voidStatus, metrics.SR_ratio, metrics.resistance_distance_pct);

  console.log(`\n  ── Structure ──`);
  console.log(`  S1: $${metrics.S1.price.toFixed(6)} (${(metrics.S1.pct_change * 100).toFixed(1)}%) strength: ${metrics.S1.strength.toFixed(0)}`);
  console.log(`  R1: $${metrics.R1.price.toFixed(6)} (+${(metrics.R1.pct_change * 100).toFixed(1)}%) strength: ${metrics.R1.strength.toFixed(0)}`);
  console.log(`  SR ratio: ${metrics.SR_ratio.toFixed(2)}`);
  console.log(`  Relative strength: ${metrics.relative_strength.toFixed(2)}`);
  console.log(`  Local dominance: ${metrics.local_dominance.toFixed(2)}`);
  console.log(`  Shelf: ${shelfQuality} | Void: ${voidStatus} | Structure: ${structureClass}`);

  // DCA
  const dca = computeDCA(dcaResult.data, currentPrice);
  console.log(`\n  ── DCA ──`);
  console.log(`  Bias: ${dca.bias} | Stack below: ${dca.stack_below} | Headwind: ${dca.headwind_above}`);
  console.log(`  Support score: ${dca.support_score}`);
  console.log(`  Buy vol: $${dca.raw.buyVolume.toFixed(0)} | Sell vol: $${dca.raw.sellVolume.toFixed(0)}`);

  // Nansen
  console.log(`\n  ── Nansen ──`);
  console.log(`  Flow bias: ${nansenResult.flow_bias} | Confluence: ${nansenResult.confluence}`);

  // Score + Decision
  const result = scoreToken({ shelfQuality, voidStatus, structureMetrics: metrics, dca, nansen: nansenResult });
  console.log(`\n  ── Scoring ──`);
  console.log(`  Structure: ${result.structureScore}/10 | DCA: ${result.dcaModifier >= 0 ? '+' : ''}${result.dcaModifier} | Nansen: ${result.nansenModifier >= 0 ? '+' : ''}${result.nansenModifier}`);
  console.log(`  Final: ${result.finalScore} → ${result.decision}`);
}

console.log(`\n\nAll results from cached data. Zero API calls made.`);
