/**
 * Resilient fetch wrapper with automatic retries and exponential backoff.
 */

import { logger } from './logger.js';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoffDelay(attempt, baseDelayMs, response) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  const exp = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exp + jitter, 30000);
}

export async function requestWithRetry(url, init = {}, options = {}) {
  const { maxRetries = 4, baseDelayMs = 1000, timeoutMs = 15000, label = 'request' } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs, response);
        logger.warn(`${label} got retryable status, backing off`, {
          status: response.status,
          attempt: attempt + 1,
          delayMs: Math.round(delay),
        });
        await sleep(delay);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxRetries) {
        const delay = backoffDelay(attempt, baseDelayMs);
        logger.warn(`${label} network error, retrying`, {
          error: error instanceof Error ? error.message : String(error),
          attempt: attempt + 1,
          delayMs: Math.round(delay),
        });
        await sleep(delay);
        continue;
      }
    }
  }
  throw new Error(
    `${label} failed after ${maxRetries + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}
