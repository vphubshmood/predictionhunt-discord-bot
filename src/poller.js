import { sleep } from './http.js';
import { logger } from './logger.js';

export class TradePoller {
  constructor({ client, processor, intervalMs, minBetSize }) {
    this.client = client;
    this.processor = processor;
    this.intervalMs = intervalMs;
    this.minBetSize = minBetSize;
    this.running = false;
    // Only send trades that arrive AFTER the bot starts
    this.startedAt = Math.floor(Date.now() / 1000);
    this.seenIds = new Set();
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
        const raw = await this.client.getSmartMoneyAlerts({ limit: 100 });

        const trades = raw
          .map((a) => {
            // Strip "unresolved:0x..." titles that the API itself returns
            const rawTitle = a.market_title || a.title || a.event_title || '';
            const title = rawTitle.startsWith('unresolved:') ? '' : rawTitle;

            return {
              trade_id: a.trade_id || a.id,
              platform: a.platform || 'polymarket',
              market_id: a.market_id || a.condition_id || a.ticker,
              title,
              outcome_label: a.outcome || a.side_label || a.outcome_label || '',
              side: (a.side || a.action || '').toLowerCase(),
              price: a.price ?? a.entry_price,
              amount_usd: a.stake ?? a.amount_usd ?? a.total ?? 0,
              payout: a.payout,
              wallet: a.wallet || a.trader_wallet,
              wallet_name: a.wallet_name || a.trader_name,
              smart_lifetime_pnl: a.lifetime_profit ?? a.lifetime_pnl ?? a.smart_lifetime_pnl,
              executed_at: a.executed_at || a.created_at,
              timestamp: a.timestamp || a.ts,
              source_url: a.source_url || a.market_url,
            };
          })
          .filter((t) => {
            // Block old bets — only allow trades from after bot started
            const ts = t.timestamp ||
              Math.floor(Date.parse(t.executed_at || '') / 1000) || 0;
            if (ts > 0 && ts < this.startedAt) return false;

            // Block duplicates by trade_id
            const id = String(t.trade_id || `${t.market_id}:${t.side}:${t.amount_usd}`);
            if (this.seenIds.has(id)) return false;
            this.seenIds.add(id);

            // Keep seenIds from growing forever
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
