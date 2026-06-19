/**
 * Normalizes a raw trade into a flat alert and builds the Discord embed.
 */

import { resolveCategory } from './categories.js';

const CATEGORY_COLORS = {
  sports: 0x2ecc71,
  crypto: 0xf1c40f,
  politics: 0x3498db,
  finance: 0x9b59b6,
  entertainment: 0xe91e63,
  other: 0x95a5a6,
};

function formatPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return 'n/a';
  if (n > 0 && n <= 1) return `${Math.round(n * 100)}¢`;
  return String(price);
}

function formatProbability(price) {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return 'n/a';
  return `${Math.round(n * 100)}%`;
}

function formatUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function shortenWallet(addr) {
  if (typeof addr !== 'string' || addr.length < 12) return addr || 'unknown';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatPlatform(platform) {
  if (!platform) return 'Unknown';
  const map = {
    polymarket: 'Polymarket',
    kalshi: 'Kalshi',
    predictit: 'PredictIt',
    prophetx: 'ProphetX',
    opinion: 'Opinion',
    predictfun: 'PredictFun',
  };
  return map[String(platform).toLowerCase()] || platform;
}

export function normalizeTrade({ trade, marketIndex }) {
  const marketId = trade.market_id ?? trade.condition_id ?? trade.ticker ?? '';
  const meta = marketIndex.lookup(marketId) || {};

  const userRaw =
    trade.taker_name || trade.wallet_name || trade.maker_name ||
    trade.taker_addr || trade.wallet || trade.maker_addr || '';
  const user = userRaw ? shortenWallet(userRaw) : 'unknown';

  const side = (trade.side || trade.taker_side || '').toString().toLowerCase() || 'n/a';
  const platform = formatPlatform(trade.platform || meta.platform);
  const title = meta.title || meta.eventTitle || trade.title || `Market ${marketId}`;
  const category = resolveCategory({ category: meta.category, title });

  const amountUsd = Number(trade.amount_usd ?? trade.total ?? 0);
  const placedAt = trade.executed_at || (trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : new Date().toISOString());

  let confidence = null;
  if (trade.smart_lifetime_pnl != null) {
    confidence = `Trader lifetime PnL ${formatUsd(trade.smart_lifetime_pnl)}`;
  } else if (trade.rank != null) {
    confidence = `Rank #${trade.rank}`;
  } else if (trade.confidence != null) {
    confidence = String(trade.confidence);
  }

  return {
    tradeId: String(trade.trade_id ?? `${marketId}:${trade.timestamp ?? placedAt}:${userRaw}`),
    user,
    userRaw,
    title,
    category,
    platform,
    side,
    amountUsd,
    price: trade.price,
    sourceUrl: meta.sourceUrl || trade.source_url || '',
    placedAt,
    marketId: String(marketId),
    confidence,
  };
}

export function buildDiscordPayload(alert) {
  const sideLabel = alert.side === 'n/a' ? 'n/a' : alert.side.toUpperCase();
  const placed = (() => {
    const ts = Date.parse(alert.placedAt);
    if (!Number.isFinite(ts)) return alert.placedAt;
    return `<t:${Math.floor(ts / 1000)}:R>`;
  })();

  const fields = [
    { name: 'Whale', value: alert.user || 'unknown', inline: true },
    { name: 'Platform', value: alert.platform, inline: true },
    { name: 'Category', value: alert.category, inline: true },
    { name: 'Side', value: sideLabel, inline: true },
    { name: 'Bet Size', value: formatUsd(alert.amountUsd), inline: true },
    { name: 'Price', value: `${formatPrice(alert.price)} (${formatProbability(alert.price)})`, inline: true },
    { name: 'Time Placed', value: placed, inline: true },
  ];

  if (alert.confidence) {
    fields.push({ name: 'Confidence / Rank', value: alert.confidence, inline: true });
  }
  if (alert.userRaw && alert.userRaw !== alert.user) {
    fields.push({ name: 'Wallet', value: `\`${alert.userRaw}\``, inline: false });
  }
  if (alert.sourceUrl) {
    fields.push({ name: 'Market Link', value: `[Open market](${alert.sourceUrl})`, inline: false });
  }

  const embed = {
    title: alert.title.slice(0, 256),
    url: alert.sourceUrl || undefined,
    color: CATEGORY_COLORS[alert.category] ?? CATEGORY_COLORS.other,
    description: `🐋 **Whale ${sideLabel} ${formatUsd(alert.amountUsd)}** @ ${formatPrice(alert.price)}`,
    fields,
    footer: { text: `PredictionHunt • ${alert.platform} • ${alert.category}` },
    timestamp: alert.placedAt,
  };

  return {
    username: 'PredictionHunt Whale Alerts',
    embeds: [embed],
  };
}
