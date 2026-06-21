import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
    // Only send trades from RIGHT NOW — ignore everything before bot starts
    this.startedAt = Math.floor(Date.now() / 1000);
    this.seenIds = new Set();
  }

  async start() {
    this.running = true;
    logger.info('Starting polling transport', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      minBetSize: this.minBetSize,
    });

    // Start 3 minutes in the past to cover the PredictionHunt API's natural
    // trade surfacing delay — without this, fresh restarts see zero results
    // because startedAt is set to "now" and the API hasn't caught up yet.
    this.startedAt = Math.floor(Date.now() / 1000) - 180;

    while (this.running) {
      const cycleStart = Date.now();
      try {
        const raw = await this.client.getRecentTrades({
          minTotal: this.minBetSize,
          limit: 200,
          startTime: this.startedAt,
        });

        const trades = raw.filter((t) => {
          const ts = t.timestamp ||
            Math.floor(Date.parse(t.executed_at || '') / 1000) || 0;
          // Skip anything older than when bot started
          if (ts > 0 && ts < this.startedAt) return false;
          // Skip duplicates
          const id = String(t.trade_id || `${t.market_id}:${t.side}:${t.amount_usd}:${ts}`);
          if (this.seenIds.has(id)) return false;
          this.seenIds.add(id);
          if (this.seenIds.size > 5000) {
            const arr = [...this.seenIds];
            this.seenIds = new Set(arr.slice(arr.length - 2500));
          }
          return true;
        });

        if (trades.length > 0) {
          const summary = await this.processor.processBatch(trades);
          if (summary.sent > 0 || summary.failed > 0 || summary.stale > 0) {
            logger.info('Poll cycle delivered alerts', { ...summary });
          }
        } else {
          logger.debug('Poll cycle — no new trades');
        }
      } catch (error) {
        logger.error('Poll cycle failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const elapsed = Date.now() - cycleStart;
      const wait = Math.max(0, this.intervalMs - elapsed);
      if (this.running && wait > 0) await sleep(wait);
    }
  }

  stop() {
    this.running = false;
  }
}
