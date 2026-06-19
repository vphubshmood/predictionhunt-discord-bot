import { resolveCategory } from './categories.js';

const CATEGORY_COLORS = {
  sports: 0x2ecc71, crypto: 0xf1c40f, politics: 0x3498db,
  finance: 0x9b59b6, entertainment: 0xe91e63, other: 0x95a5a6,
};

function formatPrice(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return 'n/a';
  if (n > 0 && n <= 1) return `${Math.round(n * 100)}¢`;
  return String(price);
}

function formatUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'n/a';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

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
    polymarket: 'Polymarket', kalshi: 'Kalshi', predictit: 'PredictIt',
    prophetx: 'ProphetX', opinion: 'Opinion', predictfun: 'PredictFun',
  };
  return map[String(platform).toLowerCase()] || platform;
}

function humanizeTicker(marketId) {
  if (!marketId) return 'Unknown market';
  const s = String(marketId);
  if (s.startsWith('0x')) return null; // Polymarket hash — skip humanizing
  const parts = s.split('-');
  const prettySeries = (raw) =>
    String(raw).replace(/^KX/i, '').replace(/([A-Z])(\d)/i, '$1 $2').trim();
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
  return prettySeries(s);
}

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
    trade.taker_name || trade.wallet_name || trade.maker_name ||
    trade.taker_addr || trade.wallet || trade.maker_addr || '';
  const user = userRaw ? shortenWallet(userRaw) : 'unknown';

  const side = (trade.side || trade.taker_side || '').toString().toLowerCase() || 'n/a';
  const platformRaw = trade.platform || meta.platform || '';
  const platform = formatPlatform(platformRaw);

  const realTitle = meta.eventTitle || meta.title || trade.title || '';
  const humanized = humanizeTicker(marketId);
    const title = realTitle
    ? realTitle
    : humanized
    ? humanized
    : `Market ${String(marketId).slice(0, 8)}…`;

  const outcomeLabel = trade.outcome_label || meta.outcomeLabel || '';
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
    user, userRaw, title, outcomeLabel, category, platform,
    side, amountUsd, price: trade.price, sourceUrl, placedAt,
    marketId: String(marketId), traderProfit,
  };
}

function buildSideLabel(alert) {
  // Use real outcome name if available (e.g. "San Diego Padres", "Yes", "Under")
  const outcome = (alert.outcomeLabel || '').trim();
  if (outcome && !['yes','no','over','under'].includes(outcome.toLowerCase())) {
    if (alert.side === 'yes') return `BUY ${outcome}`;
    if (alert.side === 'no') return `FADE ${outcome}`;
  }
  // Crypto and finance = Up/Down. Everything else = Yes/No.
  const isPriceMarket = alert.category === 'crypto' || alert.category === 'finance';
  const map = isPriceMarket
    ? { yes: 'Up', no: 'Down', over: 'Over', under: 'Under' }
    : { yes: 'Yes', no: 'No', over: 'Over', under: 'Under' };
  const word = map[alert.side] || (alert.side === 'n/a' ? '' : alert.side.toUpperCase());
  return word ? `BUY ${word}` : 'n/a';
}

export function buildDiscordPayload(alert) {
  const sideLabel = buildSideLabel(alert);
  const priceNum = Number(alert.price);
  const payout = Number.isFinite(priceNum) && priceNum > 0 ? alert.amountUsd / priceNum : null;

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

  const GREEN = 0x2ecc71;
  const RED = 0xe74c3c;
  const GREY = 0x95a5a6;
  let sideColor = GREY;
  if (['yes', 'over'].includes(alert.side)) sideColor = GREEN;
  else if (['no', 'under'].includes(alert.side)) sideColor = RED;

  return {
    username: 'VP Hub',
    embeds: [{
      author: { name: 'VP Hub' },
      title: alert.title.slice(0, 256),
      url: alert.sourceUrl || undefined,
      color: sideColor,
      fields,
      footer: { text: `VP Hub • ${alert.platform} • ${alert.category}` },
      timestamp: alert.placedAt,
    }],
  };
}
