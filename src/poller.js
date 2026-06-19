/**
 * REST polling transport using the Smart Money alerts feed.
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
  }

  async start() {
    this.running = true;
    logger.info('Starting Smart Money polling transport', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      minBetSize: this.minBetSize,
    });

    while (this.running) {
      const startedAt = Date.now();
      try {
        let trades = await this.client.getSmartMoneyAlerts({
          minTotal: this.minBetSize,
          limit: 200,
        });

        // If smart-money endpoint returns nothing, fall back to basic trades
        if (!trades || trades.length === 0) {
          logger.debug('Smart money returned 0 results, trying basic trades feed');
          const startTime = Math.floor(Date.now() / 1000) - Math.ceil(this.intervalMs / 1000) * 3;
          trades = await this.client.getRecentTrades({
            minTotal: this.minBetSize,
            limit: 200,
            startTime,
          });
        }

        const summary = await this.processor.processBatch(trades);
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
