/**
 * Normalizes a raw PredictionHunt trade into a flat "alert" and formats it
 * into a branded VP Hub trade-card embed.
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

/** Compact money: 73120 -> "+$73.1K", 2400000 -> "+$2.4M". */
function formatCompactUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
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

/** Make a Kalshi ticker readable: "KXBTC15M" -> "BTC 15M". */
function humanizeTicker(marketId) {
  if (!marketId) return 'Unknown market';
  const parts = String(marketId).split('-');
  const prettySeries = (raw) =>
    String(raw)
      .replace(/^KX/i, '')
      .replace(/([A-Z])(\d)/i, '$1 $2')
      .trim();

  if (parts.length >= 2) {
    const series = prettySeries(parts[0]);
    const when = parts[1];
    const m = when.match(/^(\d{1,2})([A-Z]{3})(\d{2})(\d{2})(\d{2})?$/);
    if (m) {
      const [, day, mon, , hh, mm] = m;
      return `${series} (settles ${day} ${mon} ${hh}:${mm ?? '00'})`;
    }
    return `${series} market`;
  }
  return prettySeries(marketId);
}

/** Best-effort clickable link to the market, even without metadata. */
function buildMarketLink({ platform, marketId, sourceUrl }) {
  if (sourceUrl) return sourceUrl;
  const p = String(platform || '').toLowerCase();
  if (p === 'kalshi' && marketId) {
    const series = String(marketId).split('-')[0].toLowerCase();
    return `https://kalshi.com/markets/${series}`;
  }
  if (p === 'polymarket' && marketId) {
    return `https://polymarket.com/markets?_q=${encodeURIComponent(marketId)}`;
  }
  return '';
}

export function normalizeTrade({ trade, marketIndex }) {
  const marketId = trade.market_id ?? trade.condition_id ?? trade.ticker ?? '';
  const meta = marketIndex.lookup(marketId) || {};

  const userRaw =
    trade.taker_name ||
    trade.wallet_name ||
    trade.maker_name ||
    trade.taker_addr ||
    trade.wallet ||
    trade.maker_addr ||
    '';
  const user = userRaw ? shortenWallet(userRaw) : 'unknown';

  const side = (trade.side || trade.taker_side || '').toString().toLowerCase() || 'n/a';
  const platformRaw = trade.platform || meta.platform || '';
  const platform = formatPlatform(platformRaw);

  const realTitle = meta.title || meta.eventTitle || trade.title || '';
  const title = realTitle || `⚠️ Unresolved — ${humanizeTicker(marketId)}`;
  const titleResolved = Boolean(realTitle);
  const category = resolveCategory({ category: meta.category, title });

  const amountUsd = Number(trade.amount_usd ?? trade.total ?? 0);
  const placedAt =
    trade.executed_at ||
    (trade.timestamp ? new Date(trade.timestamp * 1000).toISOString() : new Date().toISOString());

  const sourceUrl = buildMarketLink({
    platform: platformRaw,
    marketId,
    sourceUrl: meta.sourceUrl || trade.source_url || '',
  });

  const traderProfit =
    trade.smart_lifetime_pnl != null ? Number(trade.smart_lifetime_pnl) : null;

  return {
    tradeId: String(trade.trade_id ?? `${marketId}:${trade.timestamp ?? placedAt}:${userRaw}`),
    user,
    userRaw,
    title,
    titleResolved,
    category,
    platform,
    side,
    amountUsd,
    price: trade.price,
    sourceUrl,
    placedAt,
    marketId: String(marketId),
    traderProfit,
  };
}

export function buildDiscordPayload(alert) {
  const sideMap = { yes: 'Up', no: 'Down', over: 'Over', under: 'Under' };
  const sideWord = sideMap[alert.side] || (alert.side === 'n/a' ? '' : alert.side.toUpperCase());
  const sideLabel = sideWord ? `BUY ${sideWord}` : 'n/a';

  // Payout = stake / entry price (each winning share settles at $1).
  const priceNum = Number(alert.price);
  const payout =
    Number.isFinite(priceNum) && priceNum > 0 ? alert.amountUsd / priceNum : null;

  const fields = [
    { name: 'Side', value: sideLabel, inline: true },
    { name: 'Entry', value: formatPrice(alert.price), inline: true },
    { name: '\u200b', value: '\u200b', inline: true },
    { name: 'Stake', value: formatUsd(alert.amountUsd), inline: true },
    { name: 'Payout', value: payout != null ? formatUsd(payout) : 'n/a', inline: true },
    {
      name: 'Trader Profit',
      value: alert.traderProfit != null ? formatCompactUsd(alert.traderProfit) : 'n/a',
      inline: true,
    },
  ];

  if (alert.sourceUrl) {
    fields.push({ name: '\u200b', value: `[🔗 View this market](${alert.sourceUrl})`, inline: false });
  }

  const embed = {
    author: { name: 'VP Hub' },
    title: alert.title.slice(0, 256),
    url: alert.sourceUrl || undefined,
    color: CATEGORY_COLORS[alert.category] ?? CATEGORY_COLORS.other,
    fields,
    footer: { text: `VP Hub • ${alert.platform} • ${alert.category}` },
    timestamp: alert.placedAt,
  };

  return {
    username: 'VP Hub',
    embeds: [embed],
  };
}
