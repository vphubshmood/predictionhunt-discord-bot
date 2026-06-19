/**
 * PredictionHunt REST API client.
 */

import { requestWithRetry } from './http.js';
import { logger } from './logger.js';

export class PredictionHuntClient {
  constructor({ apiKey, baseUrl, maxRetries = 4, retryBaseDelayMs = 1000 }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
  }

  async get(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await requestWithRetry(
      url.toString(),
      {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-API-Key': this.apiKey },
      },
      {
        maxRetries: this.maxRetries,
        baseDelayMs: this.retryBaseDelayMs,
        label: `predictionhunt GET ${path}`,
      }
    );

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`predictionhunt GET ${path} returned non-JSON (status ${response.status})`);
    }

    if (!response.ok) {
      const message = body?.message || body?.error || `HTTP ${response.status}`;
      throw new Error(`predictionhunt GET ${path} failed: ${message}`);
    }
    return body;
  }

  async checkStatus() {
    try {
      await this.get('/v2/status');
      return true;
    } catch (error) {
      logger.error('PredictionHunt status check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async getRecentTrades({ minTotal, limit = 100, startTime, platform } = {}) {
    const body = await this.get('/v2/trades', {
      min_total: minTotal,
      limit,
      order: 'desc',
      start_time: startTime,
      platform,
    });
    return Array.isArray(body?.trades) ? body.trades : [];
  }

  async getMarkets({ platform, status = 'active', limit = 500, cursor } = {}) {
    const body = await this.get('/v2/markets', { platform, status, limit, cursor });
    return {
      markets: Array.isArray(body?.markets) ? body.markets : [],
      nextCursor: body?.next_cursor ?? null,
    };
  }
}
