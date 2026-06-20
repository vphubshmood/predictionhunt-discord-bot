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
   * Smart Money alerts — full titles, outcomes, lifetime profit included.
   * Dev plan endpoint: GET /v2/alerts/smart-money
   */
  async getSmartMoneyAlerts({ limit = 100 } = {}) {
    try {
      const body = await this.get('/v2/alerts/smart-money', { limit });

      // Log raw response once so we can see the actual field names
      logger.debug('Smart money raw response', {
        keys: Object.keys(body || {}),
        firstItem: JSON.stringify((body?.alerts || body?.trades || body || [])[0] || {}).slice(0, 300),
      });

      const items =
        Array.isArray(body?.alerts) ? body.alerts :
        Array.isArray(body?.trades) ? body.trades :
        Array.isArray(body?.data) ? body.data :
        Array.isArray(body) ? body : [];

      return items.map((a) => {
        const rawTitle = a.market_title || a.title || a.event_title || a.market_name || '';
        const title = rawTitle.startsWith('unresolved:') ? '' : rawTitle;
        return {
          trade_id: a.trade_id || a.id,
          platform: a.platform || 'polymarket',
          market_id: a.market_id || a.condition_id || a.ticker,
          title,
          outcome_label: a.outcome || a.side_label || a.outcome_label || a.selection || '',
          side: (a.side || a.action || a.direction || '').toLowerCase(),
          price: a.price ?? a.entry_price ?? a.avg_price,
          // Try every possible field name for stake/amount
          amount_usd: a.stake ?? a.amount_usd ?? a.total ?? a.notional ?? a.size ?? 0,
          payout: a.payout ?? a.potential_payout,
          wallet: a.wallet || a.trader_wallet || a.address,
          wallet_name: a.wallet_name || a.trader_name || a.username,
          smart_lifetime_pnl: a.lifetime_profit ?? a.lifetime_pnl ?? a.smart_lifetime_pnl ?? a.pnl,
          executed_at: a.executed_at || a.created_at || a.time,
          timestamp: a.timestamp || a.ts || a.created_at,
          source_url: a.source_url || a.market_url || a.url,
        };
      });
    } catch (error) {
      logger.error('Smart money fetch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
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
