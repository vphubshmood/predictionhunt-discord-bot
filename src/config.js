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

  const config = {
    apiKey,
    webhooks,
    minBetSize: envNumber('MIN_BET_SIZE', 1000),
    transport,
    pollIntervalMs: Math.max(15, envNumber('POLL_INTERVAL_SECONDS', 45)) * 1000,
    marketRefreshMs: Math.max(60, envNumber('MARKET_REFRESH_SECONDS', 900)) * 1000,
    maxRetries: envNumber('MAX_RETRIES', 4),
    retryBaseDelayMs: envNumber('RETRY_BASE_DELAY_MS', 1000),
    dedupeTtlMs: Math.max(60, envNumber('DEDUPE_TTL_SECONDS', 21600)) * 1000,
    restBaseUrl: env('REST_BASE_URL') || 'https://www.predictionhunt.com/api',
    wsUrl: env('WS_URL') || 'wss://ws.predictionhunt.com',
    logLevel: (env('LOG_LEVEL') || 'info').toLowerCase(),
  };

  return Object.freeze(config);
}
