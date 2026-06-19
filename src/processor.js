/**
 * Shared trade-processing pipeline: filter -> dedupe -> classify -> send.
 */

import { normalizeTrade } from './alert.js';
import { logger } from './logger.js';

export class TradeProcessor {
  constructor({ marketIndex, deduper, notifier, minBetSize, minBetSizes = {}, minBetFloor }) {
    this.marketIndex = marketIndex;
    this.deduper = deduper;
    this.notifier = notifier;
    this.minBetSize = minBetSize;
    this.minBetSizes = minBetSizes;
    this.minBetFloor = minBetFloor ?? minBetSize;
  }

  async process(trade) {
    const amount = Number(trade.amount_usd ?? trade.total ?? 0);
    // Cheap pre-filter using the lowest threshold of any category.
    if (!Number.isFinite(amount) || amount < this.minBetFloor) {
      return 'skipped-small';
    }

    const alert = normalizeTrade({ trade, marketIndex: this.marketIndex });

    // Apply the threshold for THIS bet's category (falls back to the global one).
    const categoryMin = this.minBetSizes[alert.category] ?? this.minBetSize;
    if (amount < categoryMin) {
      return 'skipped-small';
    }

    if (!this.deduper.shouldSend(alert)) {
      return 'skipped-duplicate';
    }

    const delivered = await this.notifier.send(alert);
    return delivered ? 'sent' : 'failed';
  }

  async processBatch(trades) {
    const summary = { sent: 0, skippedSmall: 0, duplicates: 0, failed: 0 };
    for (const trade of trades) {
      try {
        const outcome = await this.process(trade);
        if (outcome === 'sent') summary.sent += 1;
        else if (outcome === 'skipped-small') summary.skippedSmall += 1;
        else if (outcome === 'skipped-duplicate') summary.duplicates += 1;
        else summary.failed += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error('Failed processing trade', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return summary;
  }
}
