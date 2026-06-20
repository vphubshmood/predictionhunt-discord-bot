import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
    // Start from NOW — ignore everything before the bot started
    this.lastSeenTime = Math.floor(Date.now() / 1000);
  }

  async start() {
    this.running = true;
    logger.info('Starting polling transport', {
      intervalSeconds: Math.round(this.intervalMs / 1000),
      minBetSize: this.minBetSize,
    });

    while (this.running) {
      const startedAt = Date.now();
      try {
        const trades = await this.client.getRecentTrades({
          minTotal: this.minBetSize,
          limit: 200,
          startTime: this.lastSeenTime,
        });

        // Only process trades newer than last seen, update the cursor
        const newTrades = trades.filter((t) => {
          const ts = t.timestamp || Math.floor(Date.parse(t.executed_at || '') / 1000);
          return ts > this.lastSeenTime;
        });

        if (newTrades.length > 0) {
          // Move cursor forward to newest trade seen
          const newest = Math.max(...newTrades.map((t) =>
            t.timestamp || Math.floor(Date.parse(t.executed_at || '') / 1000) || 0
          ));
          if (newest > this.lastSeenTime) this.lastSeenTime = newest;

          // Enrich with smart money data where possible
          let enriched = newTrades;
          try {
            const smartData = await this.client.getSmartMoneyAlerts({ limit: 200 });
            const smartMap = new Map();
            for (const s of smartData) {
              if (s.market_id) smartMap.set(String(s.market_id), s);
            }
            enriched = newTrades.map((t) => {
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
            logger.debug('Smart money enrichment skipped');
          }

          const summary = await this.processor.processBatch(enriched);
          if (summary.sent > 0 || summary.failed > 0) {
            logger.info('Poll cycle delivered alerts', { ...summary });
          }
        } else {
          logger.debug('Poll cycle — no new trades', { checkedFrom: this.lastSeenTime });
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
