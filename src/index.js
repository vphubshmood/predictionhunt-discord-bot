/**
 * PredictionHunt -> Discord whale-alert bot — entry point.
 */

import { loadConfig, CATEGORIES } from './config.js';
import { logger, setLogLevel } from './logger.js';
import { PredictionHuntClient } from './predictionhunt.js';
import { MarketIndex } from './market-index.js';
import { Deduper } from './deduper.js';
import { DiscordNotifier } from './discord.js';
import { TradeProcessor } from './processor.js';
import { TradePoller } from './poller.js';
import { TradeStreamer } from './streamer.js';

async function main() {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info('Starting PredictionHunt Discord bot', {
    transport: config.transport,
    minBetSize: config.minBetSize,
    categoriesConfigured: CATEGORIES.filter((c) => config.webhooks[c]),
  });

  const client = new PredictionHuntClient({
    apiKey: config.apiKey,
    baseUrl: config.restBaseUrl,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
  });

  const ok = await client.checkStatus();
  if (!ok) {
    logger.warn('Could not confirm PredictionHunt status; continuing anyway (retries are enabled)');
  } else {
    logger.info('PredictionHunt API reachable');
  }

  const marketIndex = new MarketIndex({ client });
  await marketIndex.refresh();
  const marketRefreshTimer = setInterval(
    () => marketIndex.refresh().catch(() => {}),
    config.marketRefreshMs
  );

  const deduper = new Deduper({ ttlMs: config.dedupeTtlMs });
  const notifier = new DiscordNotifier({
    webhooks: config.webhooks,
    maxRetries: config.maxRetries,
    retryBaseDelayMs: config.retryBaseDelayMs,
  });
  const processor = new TradeProcessor({
    marketIndex,
    deduper,
    notifier,
    minBetSize: config.minBetSize,
  });

  const poller = new TradePoller({
    client,
    processor,
    intervalMs: config.pollIntervalMs,
    minBetSize: config.minBetSize,
  });

  let streamer = null;

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    clearInterval(marketRefreshTimer);
    poller.stop();
    if (streamer) streamer.stop();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  if (config.transport === 'polling') {
    await poller.start();
    return;
  }

  streamer = new TradeStreamer({
    apiKey: config.apiKey,
    wsUrl: config.wsUrl,
    processor,
  });

  const { fatal } = await streamer.start();
  if (fatal && config.transport === 'auto') {
    logger.warn('WebSocket unavailable for this API tier — falling back to REST polling');
    await poller.start();
  } else if (fatal) {
    logger.error('WebSocket transport requested but unavailable for this API tier');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Fatal error during startup', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
