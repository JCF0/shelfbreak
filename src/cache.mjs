/**
 * Shelfbreak — Cache layer
 *
 * Cache files stored as: cache/{endpoint}_{identifier}.json
 * Dev mode: never expire, never silently refresh.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, '..', 'cache');
mkdirSync(CACHE_DIR, { recursive: true });

export { CACHE_DIR };

let devMode = false;
export function setDevMode(enabled) { devMode = enabled; }
export function isDevMode() { return devMode; }

/**
 * Read from cache. Returns { data, age_ms } or null if miss.
 * In dev mode, ignores TTL (returns cached data regardless of age).
 */
export function cacheRead(endpoint, identifier) {
  const filename = `${endpoint}_${identifier}.json`;
  const filepath = resolve(CACHE_DIR, filename);

  if (!existsSync(filepath)) return null;

  try {
    const stat = statSync(filepath);
    const ageMs = Date.now() - stat.mtimeMs;

    // In dev mode, always return cache regardless of age
    if (!devMode && ageMs > CONFIG.cache.ttlMs) return null;

    const data = JSON.parse(readFileSync(filepath, 'utf-8'));
    return { data, age_ms: ageMs, path: filepath };
  } catch (e) {
    console.error(`  [cache] read error ${filename}: ${e.message}`);
    return null;
  }
}

/**
 * Write to cache.
 */
export function cacheWrite(endpoint, identifier, data) {
  const filename = `${endpoint}_${identifier}.json`;
  const filepath = resolve(CACHE_DIR, filename);

  try {
    writeFileSync(filepath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`  [cache] write error ${filename}: ${e.message}`);
  }
}

/**
 * Check if cache entry exists (regardless of TTL).
 */
export function cacheExists(endpoint, identifier) {
  const filename = `${endpoint}_${identifier}.json`;
  return existsSync(resolve(CACHE_DIR, filename));
}
