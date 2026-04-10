#!/usr/bin/env node
/**
 * Shelfbreak — Inspect CLI (presentation-ready)
 *
 * Usage:
 *   node inspect.mjs <TOKEN> [--dev]
 */
import { setDevMode } from './src/cache.mjs';
import { fetchScreener, fetchFlowIntelligence } from './src/nansen.mjs';
import { fetchMarketDepth, fetchDCAOrders } from './src/clobr.mjs';
import { prefilterTokens } from './src/prefilter.mjs';
import { extractBuckets, computeStructureMetrics, classifyShelf, detectVoid, classifyStructure } from './src/structure.mjs';
import { computeDCA } from './src/dca.mjs';
import { scoreToken } from './src/scoring.mjs';

const args = process.argv.slice(2);
if (args.includes('--dev')) setDevMode(true);
const targetSymbol = args.find(a => !a.startsWith('--'));

if (!targetSymbol) {
  console.log('Usage: node inspect.mjs <TOKEN> [--dev]');
  process.exit(1);
}

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m', red: '\x1b[31m', white: '\x1b[37m',
};

function dc(d) {
  return d === 'ALIGNED' ? c.green : d === 'SUPPORTED' ? c.cyan : d === 'CAPPED' ? c.yellow : d === 'FRAGILE' ? c.orange : d === 'AVOID' ? c.red : c.white;
}
function fU(v) { if (v == null) return '—'; const a = Math.abs(v); const s = v < 0 ? '-' : ''; return a >= 1e6 ? `${s}$${(a/1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a/1e3).toFixed(1)}K` : `${s}$${a.toFixed(0)}`; }
function fP(v) { return v == null ? '—' : `${(v*100).toFixed(1)}%`; }
function fD(v) { if (v == null) return '—'; if (v === Infinity) return 'extreme'; if (v >= 50) return `extreme (${v.toFixed(0)}x)`; if (v >= 10) return `very strong (${v.toFixed(1)}x)`; return `${v.toFixed(2)}x`; }

function section(title) {
  console.log();
  console.log(`  ${c.cyan}${c.bold}${title}${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(52)}${c.reset}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Load ──
process.stderr.write(`${c.dim}Loading ${targetSymbol}...${c.reset}`);

const screener = await fetchScreener();
const { valid } = prefilterTokens(screener.tokens, 25);
const token = valid.find(t => t.token_symbol.toUpperCase() === targetSymbol.toUpperCase());

if (!token) { console.log(`\n${c.red}  ${targetSymbol} not found in filtered candidates.${c.reset}`); process.exit(1); }

const addr = token.token_address;
const sym = token.token_symbol;

const depthResult = await fetchMarketDepth(addr);
await sleep(500);
const dcaResult = await fetchDCAOrders(addr);
const nansenResult = await fetchFlowIntelligence(addr);

if (!depthResult.data?.depth_data) { console.log(`\n${c.red}  No CLOBr depth data for ${sym}.${c.reset}`); process.exit(1); }

const P0 = depthResult.data.price;
const buckets = extractBuckets(depthResult.data.depth_data, P0);
const metrics = computeStructureMetrics(buckets, P0);

if (metrics.insufficient) { console.log(`\n${c.red}  Insufficient depth data for ${sym}.${c.reset}`); process.exit(1); }

const shelfQuality = classifyShelf(metrics.relative_strength, metrics.local_dominance, metrics.support_distance_pct);
const voidStatus = detectVoid(buckets);
const structureClass = classifyStructure(shelfQuality, voidStatus, metrics.SR_ratio, metrics.resistance_distance_pct);
const dca = computeDCA(dcaResult.data, P0);
const scored = scoreToken({ shelfQuality, voidStatus, structureMetrics: metrics, dca, nansen: nansenResult });

process.stderr.write(` done\n`);

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

const D = dc(scored.decision);

// 1. Header: TOKEN — DECISION
console.log();
console.log(`  ${c.bold}${c.cyan}${sym}${c.reset}  ${c.dim}—${c.reset}  ${D}${c.bold}${scored.decision}${c.reset}`);
console.log();

// 2. One-line summary
console.log(`  ${c.dim}${generateSummary()}${c.reset}`);
console.log();

// Score line
console.log(`  ${c.bold}$${P0.toFixed(6)}${c.reset}   Score ${c.bold}${scored.finalScore}${c.reset}  ${c.dim}( STR ${scored.structureScore}   DCA ${scored.dcaModifier >= 0 ? '+' : ''}${scored.dcaModifier}   FLOW ${scored.nansenModifier >= 0 ? '+' : ''}${scored.nansenModifier} )${c.reset}`);

// 3. STRUCTURE
section('STRUCTURE');
const s1c = shelfQuality === 'strong' ? c.green : shelfQuality === 'good' ? c.cyan : shelfQuality === 'weak' ? c.yellow : c.dim;
console.log();
console.log(`  S1   $${metrics.S1.price.toFixed(6)}    ${c.dim}${fP(metrics.S1.pct_change)} below${c.reset}     ${fU(metrics.S1.strength)}`);
console.log(`  R1   $${metrics.R1.price.toFixed(6)}   ${c.dim}+${fP(metrics.R1.pct_change)} above${c.reset}     ${fU(metrics.R1.strength)}`);
console.log();
console.log(`  SR ratio           ${metrics.SR_ratio.toFixed(2)}${metrics.SR_ratio < 0.8 ? `   ${c.yellow}resistance-heavy${c.reset}` : metrics.SR_ratio > 1.5 ? `   ${c.green}support-dominant${c.reset}` : ''}`);
console.log(`  Relative strength  ${metrics.relative_strength.toFixed(2)}x`);
console.log(`  Local dominance    ${fD(metrics.local_dominance)}`);
console.log(`  Void               ${voidStatus === 'clear' ? `${c.red}clear${c.reset}` : voidStatus === 'mild' ? `${c.yellow}mild${c.reset}` : `${c.green}none${c.reset}`}`);
console.log(`  Shelf              ${s1c}${c.bold}${shelfQuality}${c.reset}  →  ${D}${c.bold}${structureClass}${c.reset}`);

// 4. DCA
section('DCA');
if (dca.raw.orderCount === 0) {
  console.log(`  ${c.dim}No DCA orders found.${c.reset}`);
} else {
  const bc = dca.bias === 'bullish' ? c.green : dca.bias === 'bearish' ? c.red : c.dim;
  console.log();
  console.log(`  Bias               ${bc}${c.bold}${dca.bias}${c.reset}     ${c.dim}buy ${fU(dca.raw.buyVolume)}  /  sell ${fU(dca.raw.sellVolume)}${c.reset}`);
  console.log(`  Stack below        ${dca.stack_below ? `${c.green}yes${c.reset}` : `${c.dim}no${c.reset}`}`);
  console.log(`  Headwind above     ${dca.headwind_above ? `${c.red}yes${c.reset}` : `${c.dim}no${c.reset}`}`);
  console.log(`  Support score      ${dca.support_score === 'helpful' ? `${c.green}helpful${c.reset}` : dca.support_score === 'opposing' ? `${c.red}opposing${c.reset}` : `${c.dim}neutral${c.reset}`}     ${c.dim}${dca.raw.orderCount} orders${c.reset}`);
}

// 5. NANSEN
section('NANSEN');
const fb = nansenResult.flow_bias;
const cf = nansenResult.confluence;
console.log();
console.log(`  Flow bias          ${fb === 'strong' ? c.green : fb === 'weak' ? c.red : c.dim}${c.bold}${fb}${c.reset}`);
console.log(`  Confluence         ${cf === 'supportive' ? c.green : cf === 'conflicting' ? c.red : c.dim}${c.bold}${cf}${c.reset}`);
if (nansenResult.raw) {
  const r = nansenResult.raw;
  const parts = [];
  if (r.smFlow !== 0) parts.push(`SM ${fU(r.smFlow)}`);
  if (r.whaleFlow !== 0) parts.push(`Whale ${fU(r.whaleFlow)}`);
  if (r.topPnlFlow !== 0) parts.push(`Top PnL ${fU(r.topPnlFlow)}`);
  if (parts.length > 0) console.log(`  ${c.dim}${parts.join('   •   ')}${c.reset}`);
}

// 6. VENUE CONTEXT
section('VENUE CONTEXT');
console.log();
console.log(`  Venue              Solana (CLOBr)`);
console.log(`  Coverage           ${c.dim}Partial — aggregated DEX liquidity${c.reset}`);
console.log(`  ${c.dim}Price discovery may occur off-venue.${c.reset}`);

// 7. DECISION
section('DECISION');
console.log();
console.log(`    ${D}${c.bold}${scored.decision}${c.reset}`);
console.log();

const reasons = buildReasons();
for (const r of reasons) {
  console.log(`    ${r.positive ? `${c.green}+${c.reset}` : `${c.red}−${c.reset}`}  ${c.dim}${r.text}${c.reset}`);
}
console.log();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function generateSummary() {
  const parts = [];
  if (shelfQuality === 'strong' || shelfQuality === 'good') {
    parts.push(`${shelfQuality} support shelf at ${fP(metrics.support_distance_pct)} below`);
  } else {
    parts.push('no reliable support shelf');
  }
  if (voidStatus === 'clear') parts.push('support void below');
  else if (metrics.SR_ratio < 0.8) parts.push(`resistance outweighs support (SR ${metrics.SR_ratio.toFixed(2)})`);
  else if (metrics.resistance_distance_pct < 0.08) parts.push(`resistance close at +${fP(metrics.resistance_distance_pct)}`);
  if (dca.bias === 'bullish' && dca.stack_below) parts.push('DCA stacking below');
  else if (dca.bias === 'bearish') parts.push('DCA pressure bearish');
  if (nansenResult.flow_bias === 'strong') parts.push('Nansen flow supportive');
  else if (nansenResult.flow_bias === 'weak' && nansenResult.confluence === 'conflicting') parts.push('Nansen flow weak');
  return parts.join('. ') + '.';
}

function buildReasons() {
  const R = [];
  if (shelfQuality === 'strong') R.push({ positive: true, text: `Strong support shelf at ${fP(metrics.support_distance_pct)} below` });
  else if (shelfQuality === 'good') R.push({ positive: true, text: `Good support shelf at ${fP(metrics.support_distance_pct)} below` });
  if (metrics.SR_ratio > 1.2) R.push({ positive: true, text: `Support-dominant SR ratio (${metrics.SR_ratio.toFixed(2)})` });
  if (voidStatus === 'none') R.push({ positive: true, text: 'No support void' });
  if (dca.bias === 'bullish') R.push({ positive: true, text: 'DCA bias bullish' });
  if (dca.stack_below) R.push({ positive: true, text: 'DCA stacking below price' });
  if (nansenResult.flow_bias === 'strong') R.push({ positive: true, text: 'Nansen quality flow positive' });
  if (nansenResult.confluence === 'supportive') R.push({ positive: true, text: 'Nansen cohorts aligned' });
  if (shelfQuality === 'weak' || shelfQuality === 'none') R.push({ positive: false, text: `${shelfQuality === 'none' ? 'No' : 'Weak'} support shelf` });
  if (voidStatus === 'clear') R.push({ positive: false, text: 'Support void — price could slip' });
  else if (voidStatus === 'mild') R.push({ positive: false, text: 'Mild support gap in near zone' });
  if (metrics.SR_ratio < 0.8) R.push({ positive: false, text: `Resistance-heavy (SR ${metrics.SR_ratio.toFixed(2)})` });
  if (metrics.resistance_distance_pct < 0.08) R.push({ positive: false, text: `Resistance nearby at +${fP(metrics.resistance_distance_pct)}` });
  if (dca.bias === 'bearish') R.push({ positive: false, text: 'DCA bias bearish' });
  if (dca.headwind_above) R.push({ positive: false, text: 'DCA sell headwind above' });
  if (nansenResult.flow_bias === 'weak') R.push({ positive: false, text: 'Nansen quality flow weak' });
  if (nansenResult.confluence === 'conflicting') R.push({ positive: false, text: 'Nansen cohorts conflicting' });
  return R;
}
