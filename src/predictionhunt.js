/**
 * PredictionHunt REST API client.
 * Uses /v2/alerts/smart-money as the primary whale feed — it returns
 * full market titles, real outcome labels (team/candidate names),
 * stake, payout, and lifetime trader profit all in one response.
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

  /**
   * Fetch smart-money whale alerts — the primary data source.
   * Returns full titles, outcome labels, stake, payout, lifetime profit.
   */
  async getSmartMoneyAlerts({ minTotal, limit = 100, platform } = {}) {
    const body = await this.get('/v2/alerts/smart-money', {
      min_stake: minTotal,
      limit,
      platform,
    });
    // Normalize the smart-money response into the unified trade shape
    const alerts = Array.isArray(body?.alerts) ? body.alerts :
                   Array.isArray(body?.trades) ? body.trades :
                   Array.isArray(body) ? body : [];
    return alerts.map((a) => ({
      // Identity
      trade_id: a.trade_id || a.id,
      platform: a.platform || 'polymarket',
      market_id: a.market_id || a.condition_id || a.ticker,
      // The full resolved market title — e.g. "San Diego Padres vs Texas Rangers"
      title: a.market_title || a.title || a.event_title || '',
      // The specific outcome label — e.g. "San Diego Padres", "Yes", "Under"
      outcome_label: a.outcome || a.side_label || a.outcome_label || '',
      // Side: yes / no / over / under
      side: (a.side || a.action || '').toLowerCase(),
      // Prices and amounts
      price: a.price ?? a.entry_price,
      amount_usd: a.stake ?? a.amount_usd ?? a.total,
      payout: a.payout,
      // Trader info
      wallet: a.wallet || a.trader_wallet,
      wallet_name: a.wallet_name || a.trader_name,
      smart_lifetime_pnl: a.lifetime_profit ?? a.lifetime_pnl ?? a.smart_lifetime_pnl,
      // Timing
      executed_at: a.executed_at || a.created_at,
      timestamp: a.timestamp || a.ts,
      // Link
      source_url: a.source_url || a.market_url,
    }));
  }

  /**
   * Fallback: basic trades feed used only if smart-money endpoint fails.
   */
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
