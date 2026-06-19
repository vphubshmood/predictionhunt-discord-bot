/**
 * In-memory index of market metadata keyed by the platform-native market id.
 * Mirrors /v2/markets so we can enrich each whale trade with a title,
 * outcome label, category and link.
 */

import { logger } from './logger.js';

export class MarketIndex {
  constructor({ client }) {
    this.client = client;
    this.byMarketId = new Map();
    this.lastRefresh = 0;
  }

  get size() {
    return this.byMarketId.size;
  }

  lookup(marketId) {
    if (!marketId) return undefined;
    return this.byMarketId.get(String(marketId));
  }

  async refresh({ maxPages = 40 } = {}) {
    const platforms = ['polymarket', 'kalshi'];
    const next = new Map();
    try {
      for (const platform of platforms) {
        let cursor;
        let pages = 0;
        do {
          const { markets, nextCursor } = await this.client.getMarkets({
            platform,
            status: 'active',
            limit: 500,
            cursor,
          });
          for (const market of markets) {
            const marketId = market?.market_id;
            if (!marketId) continue;
                        const entry = {
              title: market.event_title || market.title || '',
              eventTitle: market.event_title || '',
              outcomeLabel: market.title || '',
              category: market.category || '',
              platform: market.platform || platform,
              sourceUrl: market.source_url || '',
            };
            // Store under every possible ID so lookups always hit
            next.set(String(marketId), entry);
            if (market.condition_id) next.set(String(market.condition_id), entry);
            if (market.ticker) next.set(String(market.ticker), entry);
            if (market.slug) next.set(String(market.slug), entry);
          }
          cursor = nextCursor || undefined;
          pages += 1;
        } while (cursor && pages < maxPages);
      }

      if (next.size > 0) {
        this.byMarketId = next;
        this.lastRefresh = Date.now();
        logger.info('Market index refreshed', { markets: next.size });
      } else {
        logger.warn('Market index refresh returned no markets; keeping previous index', {
          previous: this.byMarketId.size,
        });
      }
    } catch (error) {
      logger.error('Market index refresh failed; keeping previous index', {
        error: error instanceof Error ? error.message : String(error),
        previous: this.byMarketId.size,
      });
    }
  }
}
