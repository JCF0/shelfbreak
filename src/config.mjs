/**
 * Shelfbreak — Configuration & Constants
 */

// ── Structure windows (% from current price) ──
export const SUPPORT_WINDOW = [-0.12, -0.02];
export const RESISTANCE_WINDOW = [0.02, 0.20];
export const NEAR_ZONE = [-0.04, -0.01];

// ── Shelf classification thresholds ──
export const RELATIVE_STRONG = 2.5;
export const RELATIVE_GOOD = 1.8;
export const LOCAL_DOM_STRONG = 2.0;
export const LOCAL_DOM_GOOD = 1.5;

// ── Void detection ──
export const VOID_CLEAR = 0.3;
export const VOID_MILD = 0.6;

// ── Distance thresholds ──
export const SUPPORT_CLOSE = 0.05;
export const SUPPORT_MAX = 0.10;
export const RESISTANCE_NEAR = 0.08;

// ── API config ──
export const CONFIG = {
  nansen: {
    chain: 'solana',
    screenerTimeframe: '24h',
    screenerLimit: 100,      // broad screener to ensure ≥10 valid tokens after filtering
    nansenEnrichLimit: 25,   // flow-intel on all valid tokens after prefilter
    clobrDepthLimit: 5,      // CLOBr depth analysis on top 5 after Nansen ranking
    flowDays: 30,
  },
  clobr: {
    baseUrl: 'https://clobr.io/api/v1',
    depthLowPct: -0.15,   // fetch a bit wider than window
    depthHighPct: 0.25,
    currency: 'USD',
  },
  cache: {
    ttlMs: 24 * 60 * 60 * 1000,  // 24h for dev
  },
  apiDelayMs: 2000,  // CLOBr: 3 req per 5 seconds, stay safe
};
