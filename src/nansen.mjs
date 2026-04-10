/**
 * Shelfbreak — Nansen fetchers
 *
 * Thin integration: screener + flow-intelligence only.
 */
import { exec as execCb } from 'child_process';
import { CONFIG } from './config.mjs';
import { cacheRead, cacheWrite, cacheExists, isDevMode } from './cache.mjs';

function execAsync(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    execCb(cmd, { maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: err ? (err.code || 1) : 0 });
    });
  });
}

function parseNansenResponse(stdout) {
  const jsonStart = stdout.search(/[\[{]/);
  if (jsonStart === -1) return null;
  const parsed = JSON.parse(stdout.slice(jsonStart));
  if (parsed?.data?.data && Array.isArray(parsed.data.data)) return parsed.data.data;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (parsed?.data && typeof parsed.data === 'object') return parsed.data;
  return parsed;
}

/**
 * Fetch top tokens from Nansen screener.
 * Returns array of { token_address, token_symbol, ... }
 */
export async function fetchScreener() {
  const { chain, screenerTimeframe, screenerLimit } = CONFIG.nansen;
  const cacheKey = `${chain}_${screenerTimeframe}_${screenerLimit}`;

  const cached = cacheRead('nansen_screener', cacheKey);
  if (cached) {
    console.log(`  [nansen] screener: cache hit (${(cached.age_ms / 1000 / 60).toFixed(0)}m old)`);
    return { tokens: cached.data, cached: true };
  }

  if (isDevMode()) {
    console.log(`  [nansen] screener: DEV MODE — no cache, would need live fetch`);
    return { tokens: [], cached: false, missing: true };
  }

  console.log(`  [nansen] screener: fetching live...`);
  const cmd = `nansen research token screener --chain ${chain} --timeframe ${screenerTimeframe} --limit ${screenerLimit}`;
  const result = await execAsync(cmd);

  if (result.exitCode !== 0) {
    console.error(`  [nansen] screener failed: ${result.stderr.slice(0, 200)}`);
    return { tokens: [], cached: false, error: result.stderr };
  }

  const tokens = parseNansenResponse(result.stdout);
  if (!tokens || !Array.isArray(tokens)) {
    console.error(`  [nansen] screener: unexpected response format`);
    return { tokens: [], cached: false, error: 'bad format' };
  }

  cacheWrite('nansen_screener', cacheKey, tokens);
  console.log(`  [nansen] screener: ${tokens.length} tokens fetched + cached`);
  return { tokens, cached: false };
}

/**
 * Fetch flow intelligence for a token.
 * Returns { flow_bias, confluence, raw }
 */
export async function fetchFlowIntelligence(tokenAddress) {
  const { chain, flowDays } = CONFIG.nansen;
  const cacheKey = `${chain}_${tokenAddress}`;

  const cached = cacheRead('nansen_flow_intel', cacheKey);
  if (cached) {
    console.log(`  [nansen] flow-intel ${tokenAddress.slice(0, 8)}: cache hit`);
    return classifyFlow(cached.data);
  }

  if (isDevMode()) {
    console.log(`  [nansen] flow-intel ${tokenAddress.slice(0, 8)}: DEV MODE — no cache`);
    return { flow_bias: 'neutral', confluence: 'neutral', raw: null, missing: true };
  }

  console.log(`  [nansen] flow-intel ${tokenAddress.slice(0, 8)}: fetching live...`);
  const cmd = `nansen research token flow-intelligence --token ${tokenAddress} --chain ${chain} --days ${flowDays}`;
  const result = await execAsync(cmd);

  if (result.exitCode !== 0) {
    console.error(`  [nansen] flow-intel failed: ${result.stderr.slice(0, 200)}`);
    return { flow_bias: 'neutral', confluence: 'neutral', raw: null, error: result.stderr };
  }

  const data = parseNansenResponse(result.stdout);
  cacheWrite('nansen_flow_intel', cacheKey, data);
  return classifyFlow(data);
}

/**
 * Simple Nansen flow classification.
 * flow_bias: strong / neutral / weak
 * confluence: supportive / neutral / conflicting
 */
function classifyFlow(data) {
  if (!data) return { flow_bias: 'neutral', confluence: 'neutral', raw: null };

  // Handle array or object
  const d = Array.isArray(data) ? data[0] : data;
  if (!d) return { flow_bias: 'neutral', confluence: 'neutral', raw: null };

  const smFlow = d.smart_trader_net_flow_usd ?? 0;
  const whaleFlow = d.whale_net_flow_usd ?? 0;
  const topPnlFlow = d.top_pnl_net_flow_usd ?? 0;
  const qualityFlow = smFlow + whaleFlow + topPnlFlow;

  // flow_bias: based on total quality cohort direction
  let flow_bias;
  if (qualityFlow > 0 && (smFlow > 0 || topPnlFlow > 0)) flow_bias = 'strong';
  else if (qualityFlow > 0) flow_bias = 'neutral';
  else if (qualityFlow < 0 && (smFlow < 0 || topPnlFlow < 0)) flow_bias = 'weak';
  else flow_bias = 'neutral';

  // confluence: are different cohorts aligned?
  const signs = [smFlow, whaleFlow, topPnlFlow].map(v => v > 0 ? 1 : v < 0 ? -1 : 0);
  const positive = signs.filter(s => s > 0).length;
  const negative = signs.filter(s => s < 0).length;

  let confluence;
  if (positive >= 2 && negative === 0) confluence = 'supportive';
  else if (negative >= 2 && positive === 0) confluence = 'conflicting';
  else confluence = 'neutral';

  return {
    flow_bias,
    confluence,
    raw: { smFlow, whaleFlow, topPnlFlow, qualityFlow },
  };
}
