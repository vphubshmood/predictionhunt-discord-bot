/**
 * REST polling transport — uses the basic /v2/trades feed (proven working).
 */

import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
    this.seenIds = new Set();
  }

  async start() {
    this.running = true;
    logger.info('Starting polling transport', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      minBetSize: this.minBetSize,
    });

    const lookbackSeconds = Math.ceil(this.intervalMs / 1000) * 3;

    while (this.running) {
      const startedAt = Date.now();
      try {
        const startTime = Math.floor(Date.now() / 1000) - lookbackSeconds;
        const trades = await this.client.getRecentTrades({
          minTotal: this.minBetSize,
          limit: 200,
          startTime,
        });

        // Then try to enrich each trade with smart money data
        let enriched = trades;
        try {
          const smartData = await this.client.getSmartMoneyAlerts({ limit: 200 });
          // Build a lookup map from market_id -> smart money data
          const smartMap = new Map();
          for (const s of smartData) {
            if (s.market_id) smartMap.set(String(s.market_id), s);
          }
          // Merge smart money fields into each trade
          enriched = trades.map((t) => {
            const smart = smartMap.get(String(t.market_id || t.condition_id || ''));
            if (!smart) return t;
            return {
              ...t,
              title: smart.title || t.title,
              outcome_label: smart.outcome_label || '',
              smart_lifetime_pnl: smart.smart_lifetime_pnl ?? t.smart_lifetime_pnl,
              payout: smart.payout ?? t.payout,
              source_url: smart.source_url || t.source_url,
            };
          });
        } catch {
          // Smart money enrichment failed — still send with basic data
          logger.debug('Smart money enrichment skipped, using basic trade data');
        }

        const summary = await this.processor.processBatch(enriched);
        if (summary.sent > 0 || summary.failed > 0) {
          logger.info('Poll cycle delivered alerts', { ...summary });
        } else {
          logger.debug('Poll cycle complete', { fetched: trades.length, ...summary });
        }
      } catch (error) {
        logger.error('Poll cycle failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, this.intervalMs - elapsed);
      if (this.running && wait > 0) await sleep(wait);
    }
  }

  stop() {
    this.running = false;
  }
}
