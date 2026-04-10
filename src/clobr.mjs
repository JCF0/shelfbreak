/**
 * Shelfbreak — CLOBr fetchers
 *
 * market-depth, score, dca-orders
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CONFIG } from './config.mjs';
import { cacheRead, cacheWrite, isDevMode } from './cache.mjs';

// Load API key from .openclaw/.env (presence check only)
const envPath = resolve(process.env.USERPROFILE || process.env.HOME, '.openclaw', '.env');
let API_KEY = '';
try {
  const envContent = readFileSync(envPath, 'utf-8');
  const match = envContent.match(/^CLOBRAPI_KEY=(.+)$/m);
  if (match) API_KEY = match[1].trim();
} catch {}

if (!API_KEY) {
  console.warn('  [clobr] WARNING: CLOBRAPI_KEY not found in ~/.openclaw/.env');
}

async function clobrFetch(endpoint, params = {}) {
  const url = new URL(`${CONFIG.clobr.baseUrl}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { 'x-api-key': API_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CLOBr ${endpoint} ${res.status}: ${text.slice(0, 200)}`);
  }

  return await res.json();
}

/**
 * Fetch market depth for a token.
 */
export async function fetchMarketDepth(tokenAddress) {
  const cached = cacheRead('clobr_depth', tokenAddress);
  if (cached) {
    console.log(`  [clobr] depth ${tokenAddress.slice(0, 8)}: cache hit`);
    return { data: cached.data, cached: true };
  }

  if (isDevMode()) {
    console.log(`  [clobr] depth ${tokenAddress.slice(0, 8)}: DEV MODE — no cache`);
    return { data: null, cached: false, missing: true };
  }

  console.log(`  [clobr] depth ${tokenAddress.slice(0, 8)}: fetching live...`);
  try {
    const data = await clobrFetch('/market-depth', {
      token_address: tokenAddress,
      currency: CONFIG.clobr.currency,
      low_pct_change: CONFIG.clobr.depthLowPct,
      high_pct_change: CONFIG.clobr.depthHighPct,
    });
    cacheWrite('clobr_depth', tokenAddress, data);
    return { data, cached: false };
  } catch (e) {
    console.error(`  [clobr] depth ${tokenAddress.slice(0, 8)} error: ${e.message}`);
    return { data: null, cached: false, error: e.message };
  }
}

/**
 * Fetch CLOBr score for a token.
 */
export async function fetchScore(tokenAddress) {
  const cached = cacheRead('clobr_score', tokenAddress);
  if (cached) {
    console.log(`  [clobr] score ${tokenAddress.slice(0, 8)}: cache hit`);
    return { data: cached.data, cached: true };
  }

  if (isDevMode()) {
    console.log(`  [clobr] score ${tokenAddress.slice(0, 8)}: DEV MODE — no cache`);
    return { data: null, cached: false, missing: true };
  }

  console.log(`  [clobr] score ${tokenAddress.slice(0, 8)}: fetching live...`);
  try {
    const data = await clobrFetch(`/score/${tokenAddress}`);
    cacheWrite('clobr_score', tokenAddress, data);
    return { data, cached: false };
  } catch (e) {
    console.error(`  [clobr] score ${tokenAddress.slice(0, 8)} error: ${e.message}`);
    return { data: null, cached: false, error: e.message };
  }
}

/**
 * Fetch DCA orders for a token.
 */
export async function fetchDCAOrders(tokenAddress) {
  const cached = cacheRead('clobr_dca', tokenAddress);
  if (cached) {
    console.log(`  [clobr] dca ${tokenAddress.slice(0, 8)}: cache hit`);
    return { data: cached.data, cached: true };
  }

  if (isDevMode()) {
    console.log(`  [clobr] dca ${tokenAddress.slice(0, 8)}: DEV MODE — no cache`);
    return { data: null, cached: false, missing: true };
  }

  console.log(`  [clobr] dca ${tokenAddress.slice(0, 8)}: fetching live...`);
  try {
    const data = await clobrFetch('/dca-orders', {
      token_address: tokenAddress,
    });
    cacheWrite('clobr_dca', tokenAddress, data);
    return { data, cached: false };
  } catch (e) {
    console.error(`  [clobr] dca ${tokenAddress.slice(0, 8)} error: ${e.message}`);
    return { data: null, cached: false, error: e.message };
  }
}

/**
 * Fetch limit orders for a token (inspect only).
 */
export async function fetchLimitOrders(tokenAddress) {
  const cached = cacheRead('clobr_limits', tokenAddress);
  if (cached) {
    console.log(`  [clobr] limits ${tokenAddress.slice(0, 8)}: cache hit`);
    return { data: cached.data, cached: true };
  }

  if (isDevMode()) {
    console.log(`  [clobr] limits ${tokenAddress.slice(0, 8)}: DEV MODE — no cache`);
    return { data: null, cached: false, missing: true };
  }

  console.log(`  [clobr] limits ${tokenAddress.slice(0, 8)}: fetching live...`);
  try {
    const data = await clobrFetch('/limit-orders', {
      token_address: tokenAddress,
    });
    cacheWrite('clobr_limits', tokenAddress, data);
    return { data, cached: false };
  } catch (e) {
    console.error(`  [clobr] limits ${tokenAddress.slice(0, 8)} error: ${e.message}`);
    return { data: null, cached: false, error: e.message };
  }
}
