/**
 * Centralised configuration loaded entirely from environment variables.
 */

export const CATEGORIES = ['sports', 'crypto', 'politics', 'finance', 'entertainment', 'other'];

function env(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function envNumber(name, fallback) {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildWebhookMap() {
  return {
    sports: env('SPORTS_WEBHOOK_URL'),
    crypto: env('CRYPTO_WEBHOOK_URL'),
    politics: env('POLITICS_WEBHOOK_URL'),
    finance: env('FINANCE_WEBHOOK_URL'),
    entertainment: env('ENTERTAINMENT_WEBHOOK_URL'),
    other: env('OTHER_WEBHOOK_URL'),
  };
}

// Each category can have its own threshold via <CATEGORY>_MIN_BET_SIZE,
// e.g. CRYPTO_MIN_BET_SIZE=100. Falls back to the global MIN_BET_SIZE.
function buildMinBetMap(globalMin) {
  const map = {};
  for (const category of CATEGORIES) {
    map[category] = envNumber(`${category.toUpperCase()}_MIN_BET_SIZE`, globalMin);
  }
  return map;
}

export function loadConfig() {
  const apiKey = env('PREDICTIONHUNT_API_KEY');
  const webhooks = buildWebhookMap();

  const missing = [];
  if (!apiKey) missing.push('PREDICTIONHUNT_API_KEY');

  const configuredWebhooks = CATEGORIES.filter((c) => webhooks[c]);
  if (configuredWebhooks.length === 0) {
    missing.push('at least one of *_WEBHOOK_URL');
  }

  if (missing.length > 0) {
    console.error(
      `[config] Missing required environment variables:\n  - ${missing.join('\n  - ')}\n` +
        'Set these as Railway environment variables and redeploy.'
    );
    process.exit(1);
  }

  const transportRaw = (env('TRANSPORT') || 'auto').toLowerCase();
  const transport = ['auto', 'websocket', 'polling'].includes(transportRaw) ? transportRaw : 'auto';

  const minBetSize = envNumber('MIN_BET_SIZE', 1000);
  const minBetSizes = buildMinBetMap(minBetSize);
  // The cheap pre-filter uses the LOWEST threshold of any category, so a trade
  // that qualifies for a low-threshold category is not dropped too early.
  const minBetFloor = Math.min(minBetSize, ...Object.values(minBetSizes));

  const config = {
    apiKey,
    webhooks,
    minBetSize,
    minBetSizes,
    minBetFloor,
    transport,
    pollIntervalMs: Math.max(15, envNumber('POLL_INTERVAL_SECONDS', 45)) * 1000,
    marketRefreshMs: Math.max(60, envNumber('MARKET_REFRESH_SECONDS', 900)) * 1000,
    maxRetries: envNumber('MAX_RETRIES', 4),
    retryBaseDelayMs: envNumber('RETRY_BASE_DELAY_MS', 1000),
    dedupeTtlMs: Math.max(60, envNumber('DEDUPE_TTL_SECONDS', 21600)) * 1000,
    // Drop any bet older than this (in seconds) right before sending, so a stall
    // or slow delivery drain can never flood old/stale alerts. Set to 0 to disable.
    maxAlertAgeMs: Math.max(0, envNumber('MAX_ALERT_AGE_SECONDS', 120)) * 1000,
    restBaseUrl: env('REST_BASE_URL') || 'https://www.predictionhunt.com/api',
    wsUrl: env('WS_URL') || 'wss://ws.predictionhunt.com',
    logLevel: (env('LOG_LEVEL') || 'info').toLowerCase(),
  };

  return Object.freeze(config);
}
