/**
 * Maps PredictionHunt market categories onto the six fixed buckets.
 */

import { CATEGORIES } from './config.js';

const RULES = [
  {
    bucket: 'sports',
    keywords: ['sport', 'nba', 'nfl', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'ufc', 'mma', 'boxing', 'f1', 'formula 1', 'cricket', 'olympic', 'world cup', 'super bowl', 'league'],
  },
  {
    bucket: 'crypto',
    keywords: ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'doge', 'token', 'coin', 'defi', 'nft', 'blockchain', 'stablecoin', 'altcoin'],
  },
  {
    bucket: 'politics',
    keywords: ['politic', 'election', 'president', 'senate', 'house', 'congress', 'governor', 'parliament', 'vote', 'poll', 'primary', 'campaign', 'democrat', 'republican', 'geopolit', 'war', 'government', 'court', 'supreme court', 'legislation', 'referendum', 'mayor'],
  },
  {
    bucket: 'finance',
    keywords: ['financ', 'econ', 'fed', 'interest rate', 'inflation', 'cpi', 'gdp', 'stock', 'market cap', 'earnings', 'ipo', 'recession', 'unemployment', 'treasury', 'bond', 'company', 'companies', 'business', 'tech', 'science', 'nasdaq', 's&p', 'dow', 'currency', 'forex'],
  },
  {
    bucket: 'entertainment',
    keywords: ['entertain', 'movie', 'film', 'oscar', 'emmy', 'grammy', 'music', 'celebrity', 'tv', 'streaming', 'box office', 'award', 'rotten tomatoes', 'netflix', 'spotify', 'album', 'show', 'reality', 'pop culture'],
  },
];

function normalize(value) {
  return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

export function resolveCategory({ category, title } = {}) {
  const haystack = `${normalize(category)} ${normalize(title)}`.trim();
  const direct = normalize(category);
  if (CATEGORIES.includes(direct)) return direct;
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.bucket;
    }
  }
  return 'other';
}
