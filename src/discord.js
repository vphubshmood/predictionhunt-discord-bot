import { requestWithRetry, sleep } from './http.js';
import { logger } from './logger.js';
import { buildDiscordPayload } from './alert.js';

export class DiscordNotifier {
  constructor({ webhooks, maxRetries = 4, retryBaseDelayMs = 1000 }) {
    this.webhooks = webhooks;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.warnedMissing = new Set();
    // Track last send time per webhook to avoid Discord rate limits
    this.lastSent = {};
  }

  async send(alert) {
    const webhookUrl = this.webhooks[alert.category];
    if (!webhookUrl) {
      if (!this.warnedMissing.has(alert.category)) {
        this.warnedMissing.add(alert.category);
        logger.warn('No webhook configured for category', { category: alert.category });
      }
      return false;
    }

    // Enforce minimum 1.5 seconds between sends per category
    // Discord allows 5 webhook messages per 2 seconds but we stay conservative
    const now = Date.now();
    const last = this.lastSent[alert.category] || 0;
    const gap = now - last;
    if (gap < 1500) await sleep(1500 - gap);
    this.lastSent[alert.category] = Date.now();

    const payload = buildDiscordPayload(alert);
    if (!payload) return false;

    try {
      const response = await requestWithRetry(
        webhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        {
          maxRetries: this.maxRetries,
          baseDelayMs: this.retryBaseDelayMs,
          label: `discord ${alert.category} webhook`,
        }
      );

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.error('Discord webhook delivery failed', {
          category: alert.category,
          status: response.status,
          body: text.slice(0, 300),
        });
        return false;
      }

      logger.info('Alert delivered', {
        category: alert.category,
        platform: alert.platform,
        amountUsd: Math.round(alert.amountUsd),
        title: alert.title.slice(0, 80),
      });
      return true;
    } catch (error) {
      logger.error('Discord webhook delivery errored', {
        category: alert.category,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
