import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
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
        // Pull directly from Smart Money — titles, outcomes, profit all included
        const raw = await this.client.getSmartMoneyAlerts({ limit: 200 });

        // Map Smart Money fields to the unified trade shape
        const trades = raw.map((a) => ({
          trade_id: a.trade_id || a.id,
          platform: a.platform || 'polymarket',
          market_id: a.market_id || a.condition_id || a.ticker,
          // Title is already resolved on this endpoint
          title: a.market_title || a.title || a.event_title || '',
          outcome_label: a.outcome || a.side_label || a.outcome_label || '',
          side: (a.side || a.action || '').toLowerCase(),
          price: a.price ?? a.entry_price,
          // KEY FIX: smart money uses "stake" not "amount_usd"
          amount_usd: a.stake ?? a.amount_usd ?? a.total ?? 0,
          payout: a.payout,
          wallet: a.wallet || a.trader_wallet,
          wallet_name: a.wallet_name || a.trader_name,
          smart_lifetime_pnl: a.lifetime_profit ?? a.lifetime_pnl ?? a.smart_lifetime_pnl,
          executed_at: a.executed_at || a.created_at,
          timestamp: a.timestamp || a.ts,
          source_url: a.source_url || a.market_url,
        }));

        // Only trades newer than last seen
        const newTrades = trades.filter((t) => {
          const ts = t.timestamp ||
            Math.floor(Date.parse(t.executed_at || '') / 1000) || 0;
          return ts > this.lastSeenTime;
        });

        if (newTrades.length > 0) {
          const newest = Math.max(...newTrades.map((t) =>
            t.timestamp ||
            Math.floor(Date.parse(t.executed_at || '') / 1000) || 0
          ));
          if (newest > this.lastSeenTime) this.lastSeenTime = newest;

          const summary = await this.processor.processBatch(newTrades);
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

      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, this.intervalMs - elapsed);
      if (this.running && wait > 0) await sleep(wait);
    }
  }

  stop() {
    this.running = false;
  }
}
