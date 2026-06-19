/**
 * REST polling transport — used when WebSocket is unavailable.
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
    logger.info('Starting REST polling transport', {
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
        const summary = await this.processor.processBatch(trades);
        logger.debug('Poll cycle complete', { fetched: trades.length, ...summary });
        if (summary.sent > 0 || summary.failed > 0) {
          logger.info('Poll cycle delivered alerts', { ...summary });
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
