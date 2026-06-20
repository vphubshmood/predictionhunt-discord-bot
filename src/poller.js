import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
    this.startedAt = Math.floor(Date.now() / 1000);
    this.seenIds = new Set();
    this.smartMoneyWorking = null; // null = untested
  }

  async start() {
    this.running = true;
    logger.info('Starting polling transport', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      minBetSize: this.minBetSize,
    });

    while (this.running) {
      const cycleStart = Date.now();
      try {
        let raw = [];

        // Try Smart Money endpoint first (Dev plan)
        const smart = await this.client.getSmartMoneyAlerts({ limit: 100 });
        if (smart.length > 0) {
          if (!this.smartMoneyWorking) {
            this.smartMoneyWorking = true;
            logger.info('Smart Money endpoint working — using full titles and profit data');
          }
          raw = smart;
        } else {
          // Fall back to basic trades
          if (this.smartMoneyWorking !== false) {
            logger.warn('Smart Money returned 0 results — falling back to basic trades feed');
            this.smartMoneyWorking = false;
          }
          raw = await this.client.getRecentTrades({
            minTotal: this.minBetSize,
            limit: 200,
            startTime: this.startedAt,
          });
        }

        const trades = raw.filter((t) => {
          const ts = t.timestamp ||
            Math.floor(Date.parse(t.executed_at || '') / 1000) || 0;
          if (ts > 0 && ts < this.startedAt) return false;
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
          if (summary.sent > 0 || summary.failed > 0) {
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
