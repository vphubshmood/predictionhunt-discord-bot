/**
 * Shared trade-processing pipeline: filter -> dedupe -> classify -> send.
 */

import { normalizeTrade } from './alert.js';
import { logger } from './logger.js';

/**
 * Best-effort extraction of a trade's execution time in epoch milliseconds.
 * Handles `timestamp` (epoch seconds) and `executed_at` (ISO string).
 * Returns null when no usable time is present.
 * @param {object} trade Raw trade object from the API / websocket.
 * @returns {number|null} Epoch milliseconds, or null if unknown.
 */
function tradeTimeMs(trade) {
  if (trade.timestamp != null) {
    const secs = Number(trade.timestamp);
    if (Number.isFinite(secs) && secs > 0) return secs * 1000;
  }
  if (trade.executed_at) {
    const ms = Date.parse(trade.executed_at);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export class TradeProcessor {
  constructor({ marketIndex, deduper, notifier, minBetSize, minBetSizes = {}, minBetFloor, maxAlertAgeMs }) {
    this.marketIndex = marketIndex;
    this.deduper = deduper;
    this.notifier = notifier;
    this.minBetSize = minBetSize;
    this.minBetSizes = minBetSizes;
    this.minBetFloor = minBetFloor ?? minBetSize;
    // Drop bets older than this right before sending so a stall/slow drain can
    // never replay stale alerts. 0 or negative disables the gate.
    this.maxAlertAgeMs = maxAlertAgeMs ?? 0;
  }

  async process(trade) {
    const amount = Number(trade.amount_usd ?? trade.total ?? 0);
    // Cheap pre-filter using the lowest threshold of any category.
    if (!Number.isFinite(amount) || amount < this.minBetFloor) {
      return 'skipped-small';
    }

    // Staleness gate: this runs immediately before the (rate-limited) send, so
    // a bet that aged past the cutoff while waiting in the send queue is dropped
    // instead of being delivered late. This is what prevents the backlog flood.
    if (this.maxAlertAgeMs > 0) {
      const tMs = tradeTimeMs(trade);
      if (tMs != null) {
        const age = Date.now() - tMs;
        if (age > this.maxAlertAgeMs) {
          return 'skipped-stale';
        }
      }
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
    const summary = { sent: 0, skippedSmall: 0, duplicates: 0, stale: 0, failed: 0 };
    for (const trade of trades) {
      try {
        const outcome = await this.process(trade);
        if (outcome === 'sent') summary.sent += 1;
        else if (outcome === 'skipped-small') summary.skippedSmall += 1;
        else if (outcome === 'skipped-duplicate') summary.duplicates += 1;
        else if (outcome === 'skipped-stale') summary.stale += 1;
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
