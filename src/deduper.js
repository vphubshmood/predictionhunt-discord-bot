/**
 * Time-bounded de-duplication store to prevent repeat alerts.
 */

export class Deduper {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }

  prune() {
    const now = Date.now();
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
    }
  }

  mark(key) {
    const now = Date.now();
    const existing = this.seen.get(key);
    if (existing !== undefined && existing > now) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  shouldSend(alert) {
    this.prune();

    if (alert.tradeId) {
      const tradeKey = `trade:${alert.tradeId}`;
      if (!this.mark(tradeKey)) return false;
    }

    if (alert.user && alert.user !== 'unknown') {
      const userKey = `user:${alert.user}|${alert.marketId}|${alert.side}`;
      if (!this.mark(userKey)) return false;
    }

    return true;
  }

  get size() {
    return this.seen.size;
  }
}
