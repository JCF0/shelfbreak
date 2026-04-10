#!/usr/bin/env node
/**
 * Shelfbreak — Phase 0: Data Fetch
 *
 * Fetches and caches all required API data for development.
 * Run once, then iterate on compute layer using cached data.
 *
 * Usage:
 *   node fetch-data.mjs
 */
import { CONFIG } from './src/config.mjs';
import { fetchScreener, fetchFlowIntelligence } from './src/nansen.mjs';
import { fetchMarketDepth, fetchScore, fetchDCAOrders } from './src/clobr.mjs';
import { prefilterTokens } from './src/prefilter.mjs';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

console.log(`╔══════════════════════════════════════════════╗`);
console.log(`║  Shelfbreak — Phase 0: Data Fetch           ║`);
console.log(`╚══════════════════════════════════════════════╝\n`);

let totalCalls = 0;
const report = { nansen: [], clobr: [], errors: [] };

// ── Step 1: Nansen screener ──
console.log(`── Nansen Screener (solana, 24h, top 5) ──`);
const screener = await fetchScreener();
if (!screener.cached) totalCalls++;

if (screener.tokens.length === 0) {
  console.log('  ERROR: No tokens from screener. Cannot proceed.');
  process.exit(1);
}

// Pre-filter to CLOBr-compatible tokens
const { valid: allValid, removed } = prefilterTokens(screener.tokens, CONFIG.nansen.nansenEnrichLimit);
const tokens = allValid;

console.log(`  Raw: ${screener.tokens.length} tokens`);
console.log(`  Filtered: ${removed.length} removed (${removed.map(r => r.symbol).join(', ')})`);
console.log(`  Candidates: ${tokens.map(t => t.token_symbol).join(', ')}\n`);

// ── Step 2: Nansen flow-intelligence per token ──
console.log(`── Nansen Flow Intelligence ──`);
for (const token of tokens) {
  const addr = token.token_address;
  const sym = token.token_symbol || '???';
  const result = await fetchFlowIntelligence(addr);
  if (!result.missing) {
    report.nansen.push({ symbol: sym, address: addr, flow_bias: result.flow_bias, confluence: result.confluence });
  }
  if (result.error) report.errors.push(`nansen flow-intel ${sym}: ${result.error}`);
  totalCalls++;
  await sleep(CONFIG.apiDelayMs);
}

// ── Step 3: CLOBr market-depth per token ──
console.log(`\n── CLOBr Market Depth ──`);
for (const token of tokens) {
  const addr = token.token_address;
  const sym = token.token_symbol || '???';
  const result = await fetchMarketDepth(addr);
  if (result.error) report.errors.push(`clobr depth ${sym}: ${result.error}`);
  if (!result.cached && !result.missing) totalCalls++;
  await sleep(CONFIG.apiDelayMs);
}

// ── Step 4: CLOBr score per token ──
console.log(`\n── CLOBr Score ──`);
for (const token of tokens) {
  const addr = token.token_address;
  const sym = token.token_symbol || '???';
  const result = await fetchScore(addr);
  if (result.error) report.errors.push(`clobr score ${sym}: ${result.error}`);
  if (!result.cached && !result.missing) totalCalls++;
  await sleep(CONFIG.apiDelayMs);
}

// ── Step 5: CLOBr DCA orders per token ──
console.log(`\n── CLOBr DCA Orders ──`);
for (const token of tokens) {
  const addr = token.token_address;
  const sym = token.token_symbol || '???';
  const result = await fetchDCAOrders(addr);
  if (result.error) report.errors.push(`clobr dca ${sym}: ${result.error}`);
  if (!result.cached && !result.missing) totalCalls++;
  await sleep(CONFIG.apiDelayMs);
}

// ── Report ──
console.log(`\n══════════════════════════════════════════════`);
console.log(`PHASE 0 COMPLETE`);
console.log(`══════════════════════════════════════════════`);
console.log(`Total live API calls: ${totalCalls}`);
console.log(`Tokens: ${tokens.map(t => t.token_symbol).join(', ')}`);
console.log(`\nNansen flow classifications:`);
for (const n of report.nansen) {
  console.log(`  ${n.symbol.padEnd(10)} flow_bias: ${n.flow_bias.padEnd(10)} confluence: ${n.confluence}`);
}
if (report.errors.length > 0) {
  console.log(`\nErrors (${report.errors.length}):`);
  for (const e of report.errors) console.log(`  ⚠ ${e}`);
}
console.log(`\nAll data cached. Compute layer can iterate freely.`);
