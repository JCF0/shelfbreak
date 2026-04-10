#!/usr/bin/env node
/**
 * Shelfbreak — Scan CLI (presentation-ready)
 *
 * Usage:
 *   node scan.mjs [--dev] [--debug]
 */
import { setDevMode } from './src/cache.mjs';
import { CONFIG } from './src/config.mjs';
import { fetchScreener, fetchFlowIntelligence } from './src/nansen.mjs';
import { fetchMarketDepth, fetchDCAOrders } from './src/clobr.mjs';
import { prefilterTokens } from './src/prefilter.mjs';
import { extractBuckets, computeStructureMetrics, classifyShelf, detectVoid } from './src/structure.mjs';
import { computeDCA } from './src/dca.mjs';
import { scoreToken } from './src/scoring.mjs';

const args = process.argv.slice(2);
const debug = args.includes('--debug');
if (args.includes('--dev')) setDevMode(true);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  orange: '\x1b[38;5;208m', red: '\x1b[31m', white: '\x1b[37m',
};

function dc(d) {
  return d === 'ALIGNED' ? c.green : d === 'SUPPORTED' ? c.cyan : d === 'CAPPED' ? c.yellow : d === 'FRAGILE' ? c.orange : d === 'AVOID' ? c.red : c.white;
}

// ── Pipeline (silent except progress) ──
process.stderr.write(`${c.dim}Scanning...${c.reset}`);

const screener = await fetchScreener();
const { valid: prefiltered } = prefilterTokens(screener.tokens, CONFIG.nansen.nansenEnrichLimit);
process.stderr.write(`${c.dim} ${prefiltered.length} candidates${c.reset}`);

const nansenScored = [];
for (const token of prefiltered) {
  const n = await fetchFlowIntelligence(token.token_address);
  nansenScored.push({ ...token, _nansen: n });
  await sleep(CONFIG.apiDelayMs);
}

const nansenRank = (n) => {
  let s = 0;
  if (n.flow_bias === 'strong') s += 2; else if (n.flow_bias === 'neutral') s += 1;
  if (n.confluence === 'supportive') s += 2; else if (n.confluence === 'neutral') s += 1;
  return s;
};
nansenScored.sort((a, b) => nansenRank(b._nansen) - nansenRank(a._nansen));

const valid = nansenScored.slice(0, CONFIG.nansen.clobrDepthLimit);
process.stderr.write(`${c.dim} → ${valid.length} for CLOBr${c.reset}`);

const results = [];
for (const token of valid) {
  const addr = token.token_address;
  const sym = token.token_symbol;
  const nansenResult = token._nansen;

  const depthResult = await fetchMarketDepth(addr);
  await sleep(CONFIG.apiDelayMs);
  const dcaResult = await fetchDCAOrders(addr);
  await sleep(CONFIG.apiDelayMs);

  if (!depthResult.data?.depth_data) {
    results.push({ symbol: sym, decision: 'INSUFFICIENT_DATA', structureScore: null, dcaModifier: null, nansenModifier: null, finalScore: null });
    continue;
  }

  const P0 = depthResult.data.price;
  const buckets = extractBuckets(depthResult.data.depth_data, P0);
  const metrics = computeStructureMetrics(buckets, P0);

  if (metrics.insufficient) {
    results.push({ symbol: sym, decision: 'INSUFFICIENT_DATA', structureScore: null, dcaModifier: null, nansenModifier: null, finalScore: null });
    continue;
  }

  const shelfQuality = classifyShelf(metrics.relative_strength, metrics.local_dominance, metrics.support_distance_pct);
  const voidStatus = detectVoid(buckets);
  const dca = computeDCA(dcaResult.data, P0);
  const scored = scoreToken({ shelfQuality, voidStatus, structureMetrics: metrics, dca, nansen: nansenResult });

  results.push({
    symbol: sym, ...scored,
    _debug: debug ? { shelfQuality, voidStatus, metrics, dca, nansen: nansenResult } : null,
  });
}

process.stderr.write(` done\n`);

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

// Header — two lines
console.log();
console.log(`  ${c.bold}${c.cyan}SHELFBREAK${c.reset}`);
console.log(`  ${c.dim}Liquidity Structure (CLOBr) + Flow (Nansen)${c.reset}`);
console.log(`  ${c.dim}${now} UTC  •  Solana  •  ${results.length} tokens${c.reset}`);
console.log();

// Table header
const H = `  ${c.dim}${'TOKEN'.padEnd(14)} ${'STR'.padStart(4)}   ${'DCA'.padStart(3)}   ${'FLOW'.padStart(4)}   ${'SCORE'.padStart(5)}   DECISION${c.reset}`;
const SEP = `  ${c.dim}${'─'.repeat(62)}${c.reset}`;
console.log(H);
console.log(SEP);

// Rows — fixed-width columns
for (const r of results) {
  const sym = r.symbol.padEnd(14);
  const str = r.structureScore != null ? String(r.structureScore).padStart(4) : '   -';
  const dmod = r.dcaModifier != null ? (r.dcaModifier > 0 ? `${c.green}+${r.dcaModifier}${c.reset}` : r.dcaModifier < 0 ? `${c.red}${r.dcaModifier}${c.reset}` : `${c.dim} 0${c.reset}`) : `${c.dim} -${c.reset}`;
  const fmod = r.nansenModifier != null ? (r.nansenModifier > 0 ? `${c.green}+${r.nansenModifier}${c.reset}` : r.nansenModifier < 0 ? `${c.red}${r.nansenModifier}${c.reset}` : `${c.dim} 0${c.reset}`) : `${c.dim} -${c.reset}`;
  const score = r.finalScore != null ? String(r.finalScore).padStart(5) : '    -';
  const dec = `${dc(r.decision)}${c.bold}${r.decision}${c.reset}`;

  // Fixed spacing: each modifier takes 2 visible chars + padding
  console.log(`  ${c.bold}${sym}${c.reset} ${str}    ${dmod}     ${fmod}   ${score}   ${dec}`);
}

// Summary
const counts = {};
for (const r of results) counts[r.decision] = (counts[r.decision] || 0) + 1;
const parts = Object.entries(counts).map(([d, n]) => `${dc(d)}${n} ${d.toLowerCase()}${c.reset}`);
console.log();
console.log(`  ${c.dim}${results.length} tokens${c.reset}  •  ${parts.join(`  ${c.dim}•${c.reset}  `)}`);

// Legend
console.log();
console.log(`  ${c.dim}STR  Structure 0–10   DCA  Modifier ±2   FLOW  Nansen ±1${c.reset}`);
console.log(`  ${c.green}■${c.reset}${c.dim} ALIGNED${c.reset}  ${c.cyan}■${c.reset}${c.dim} SUPPORTED${c.reset}  ${c.yellow}■${c.reset}${c.dim} CAPPED${c.reset}  ${c.orange}■${c.reset}${c.dim} FRAGILE${c.reset}  ${c.red}■${c.reset}${c.dim} AVOID${c.reset}`);
console.log();

// Debug (only with --debug flag)
if (debug) {
  console.log(`${c.dim}── Debug ──${c.reset}`);
  for (const r of results) {
    if (!r._debug) continue;
    const d = r._debug;
    console.log(`  ${r.symbol}: shelf=${d.shelfQuality} void=${d.voidStatus} SR=${d.metrics.SR_ratio?.toFixed(2)} rel=${d.metrics.relative_strength?.toFixed(2)} dom=${d.metrics.local_dominance?.toFixed(2)}`);
    console.log(`    DCA: bias=${d.dca.bias} stack=${d.dca.stack_below} headwind=${d.dca.headwind_above} | Nansen: flow=${d.nansen.flow_bias} conf=${d.nansen.confluence}`);
  }
}
