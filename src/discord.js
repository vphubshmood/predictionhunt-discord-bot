/**
 * Discord webhook delivery, routed per category.
 */

import { requestWithRetry } from './http.js';
import { logger } from './logger.js';
import { buildDiscordPayload } from './alert.js';

export class DiscordNotifier {
  constructor({ webhooks, maxRetries = 4, retryBaseDelayMs = 1000 }) {
    this.webhooks = webhooks;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.warnedMissing = new Set();
  }

  async send(alert) {
    const webhookUrl = this.webhooks[alert.category];
    if (!webhookUrl) {
      if (!this.warnedMissing.has(alert.category)) {
        this.warnedMissing.add(alert.category);
        logger.warn('No webhook configured for category; alerts will be dropped', {
          category: alert.category,
        });
      }
      return false;
    }

    const payload = buildDiscordPayload(alert);

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
