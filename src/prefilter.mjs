/**
 * Shelfbreak — Token Pre-filter
 *
 * Reuses Flow Scanner exclusion logic (denylists, patterns, protected symbols).
 * Applied before Nansen enrichment to avoid wasting API calls on non-target tokens.
 *
 * Rationale: Shelfbreak assumes on-chain liquidity contributes to price discovery.
 * This does not hold for stock tokens, synthetics, wrappers, or stablecoins where
 * price is driven externally.
 */

// ═══════════════════════════════════════════════════════════════
// DENYLISTS (synced from flow-scanner/src/filters.mjs)
// ═══════════════════════════════════════════════════════════════

// Stablecoins
const STABLE_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'FRAX',
  'LUSD', 'SUSD', 'MIM', 'DOLA', 'CRVUSD', 'GHO', 'PYUSD',
  'USDD', 'USDE', 'USDS', 'USDG', 'USD0', 'USD1', 'EURC', 'EURCV',
  'RLUSD', 'AUSD', 'USDTB', 'FRXUSD', 'USDF', 'USDKG', 'USDON',
  'MUSD', 'ZCHF', 'BUSD0', 'REUSD', 'APYUSD', 'APXUSD', 'CASH',
  'JUPUSD',
]);

// Wrapped majors / BTC proxies / bridged L1s
const WRAPPED_MAJOR_SYMBOLS = new Set([
  'WBTC', 'WETH', 'WBNB', 'WMATIC', 'WAVAX', 'WSOL',
  'TBTC', 'BBTC', 'LBTC', 'CBBTC', 'MBTC', 'SBTC', 'FBTC',
  'WTAO', 'SOLW',
  'XAUT', 'PAXG', 'XAUT0',   // gold-backed
  'ZEC',                        // Zcash — always bridged on Solana
  'ETH',                        // wrapped ETH on non-ETH chains
]);

// Liquid staking / yield wrappers
const LST_YIELD_SYMBOLS = new Set([
  'STETH', 'WSTETH', 'RETH', 'CBETH', 'SWETH', 'FRXETH', 'SFRXETH',
  'EETH', 'WEETH', 'RSETH', 'EZETH', 'PUFETH',
  'MSOL', 'JITOSOL', 'JUPSOL', 'BSOL', 'MARINADESOL',
  'SUSDE', 'SUSDS', 'SDAI',
  'OETH', 'MSETH', 'MSUSD',
  'AETHUSDC', 'AETHUSDT',
]);

// Basket / index / vault / synthetic / stock / LP tokens
const BASKET_SYNTH_SYMBOLS = new Set([
  'SYRUPUSDC', 'SYRUPUSDT',
  'CUSDO',
  'JLP',       // Jupiter LP token
  // xStock tokens (Circle's tokenized stock program) — price driven externally
  'CRCLX', 'BACX', 'TSLAX', 'NVDAX', 'SPYX', 'QQQX', 'COINX', 'MSTRX',
  'GOOGLX', 'HOODX', 'GLDX', 'AMZNX', 'AAPLX', 'METAX', 'CMCSAX', 'MSFTX',
  'MCDX', 'DFDVX', 'XOMX', 'UNHX', 'CVXX', 'PLTRX', 'ORCLX',
  // Non-xStock stock/synthetic tokens
  'SPACEX',     // SpaceX synthetic — price driven externally
  'ANDURL',     // Anduril PreStocks — pre-IPO stock token
  // RWA / yield-bearing / externally-anchored assets
  'ONYC',       // OnRe Tokenized Reinsurance — RWA
  'GOLD',       // Gold-pegged synthetic
  'VNXAU',      // VNX Gold
  'GSX',        // Goldman Sachs xStock
]);

// Protected symbols (look like wrappers but aren't)
const PROTECTED_SYMBOLS = new Set([
  'W',       // Wormhole token
  'WIF',     // dogwifhat
  'WEN',
  'WLD',     // Worldcoin
  'WOJAK',
]);

// Pattern excludes (regex)
const EXCLUDE_PATTERNS = [
  /^PT-/i,       // Pendle Principal Tokens
  /^PLP-/i,      // Pendle LP tokens
  /^YT-/i,       // Pendle Yield Tokens
  /^a[A-Z]/,     // Aave aTokens
  /^c[A-Z]/,     // Compound cTokens
  /^st[A-Z]/,    // Generic staked tokens
  /USD[0-9]/i,   // Numbered USD variants
];

// Keyword excludes (applied to lowercase symbol, skipped for protected)
const EXCLUDE_KEYWORDS = [
  'wrapped', 'staked', 'yield', 'vault', 'index', 'basket',
  'synthetic', 'stock', 'syrup', 'xstock',
  'reinsurance', 'prestock', 'tokenized',
];

// ═══════════════════════════════════════════════════════════════
// FILTER
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a token should be excluded.
 * @param {string} symbol
 * @param {string} chain
 * @returns {{ exclude: boolean, reason: string|null }}
 */
function checkExclusion(symbol, chain = 'solana') {
  const sym = (symbol || '').toUpperCase().replace(/^🌱\s*/, '');

  if (!sym) return { exclude: true, reason: 'empty symbol' };

  // Hard denylists
  if (STABLE_SYMBOLS.has(sym)) return { exclude: true, reason: `stablecoin (${sym})` };
  if (WRAPPED_MAJOR_SYMBOLS.has(sym)) return { exclude: true, reason: `wrapped/bridged (${sym})` };
  if (LST_YIELD_SYMBOLS.has(sym)) return { exclude: true, reason: `LST/yield (${sym})` };
  if (BASKET_SYNTH_SYMBOLS.has(sym)) return { exclude: true, reason: `synthetic/stock/LP (${sym})` };

  // Emoji-prefixed pump.fun new tokens
  if ((symbol || '').startsWith('🌱')) return { exclude: true, reason: 'pump.fun new token' };

  // Pattern excludes (skip protected symbols)
  if (!PROTECTED_SYMBOLS.has(sym)) {
    for (const pattern of EXCLUDE_PATTERNS) {
      if (pattern.test(symbol)) return { exclude: true, reason: `pattern: ${pattern.source}` };
    }
    const symLower = (symbol || '').toLowerCase();
    for (const kw of EXCLUDE_KEYWORDS) {
      if (symLower.includes(kw)) return { exclude: true, reason: `keyword: ${kw}` };
    }
  }

  return { exclude: false, reason: null };
}

/**
 * Filter screener tokens to valid candidates.
 * @param {object[]} tokens - Raw Nansen screener tokens
 * @param {number} limit - Max valid tokens to return
 * @returns {{ valid: object[], removed: object[] }}
 */
export function prefilterTokens(tokens, limit = 5) {
  const valid = [];
  const removed = [];

  for (const t of tokens) {
    if (!t.token_address || !t.token_symbol) {
      removed.push({ symbol: t.token_symbol || '???', reason: 'missing address/symbol' });
      continue;
    }

    const check = checkExclusion(t.token_symbol);
    if (check.exclude) {
      removed.push({ symbol: t.token_symbol, reason: check.reason });
      continue;
    }

    valid.push(t);
    if (valid.length >= limit) break;
  }

  return { valid, removed };
}
