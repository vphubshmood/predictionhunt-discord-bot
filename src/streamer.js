/**
 * WebSocket streaming transport (preferred — Dev tier and up).
 */

import WebSocket from 'ws';
import { logger } from './logger.js';
import { sleep } from './http.js';

const FATAL_WS_CODES = new Set(['TIER_FORBIDDEN', 'AUTH_FAILED', 'AUTH_REQUIRED', 'CHANNEL_FORBIDDEN']);

export class TradeStreamer {
  constructor({ apiKey, wsUrl, processor }) {
    this.apiKey = apiKey;
    this.wsUrl = wsUrl;
    this.processor = processor;
    this.ws = null;
    this.running = false;
    this.heartbeatTimer = null;
    this.fellBackToPolling = false;
  }

  async start() {
    this.running = true;
    let attempt = 0;

    while (this.running) {
      try {
        const fatal = await this.connectOnce();
        if (fatal) {
          this.fellBackToPolling = true;
          return { fatal: true };
        }
        attempt = 0;
      } catch (error) {
        logger.error('WebSocket connection error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!this.running) break;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** attempt + Math.random() * 1000, 30000);
      logger.warn('Reconnecting WebSocket', { attempt, delayMs: Math.round(delay) });
      await sleep(delay);
    }
    return { fatal: false };
  }

  connectOnce() {
    return new Promise((resolve, reject) => {
      const url = `${this.wsUrl}?api_key=${encodeURIComponent(this.apiKey)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      let fatal = false;
      let settled = false;

      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        this.clearHeartbeat();
        if (error) reject(error);
        else resolve(value);
      };

      ws.on('open', () => {
        logger.info('WebSocket connected, subscribing to smart_money channel');
        ws.send(JSON.stringify({ action: 'subscribe', channel: 'smart_money' }));
        this.startHeartbeat();
      });

      ws.on('message', async (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          logger.warn('Received non-JSON WebSocket frame');
          return;
        }

        if (msg.type === 'error') {
          const code = msg.code || 'UNKNOWN';
          logger.error('WebSocket error message', { code, message: msg.message });
          if (FATAL_WS_CODES.has(code)) {
            fatal = true;
            ws.close();
          }
          return;
        }

        if (msg.type === 'warning') {
          logger.warn('WebSocket warning', { code: msg.code, message: msg.message });
          return;
        }

        if (msg.type === 'subscribed') {
          logger.info('Subscribed to channel', { channel: msg.channel });
          return;
        }

        if (msg.type === 'pong') return;

        if (msg.channel === 'smart_money' && msg.data) {
          try {
            await this.processor.process(this.mapSmartMoney(msg.data));
          } catch (error) {
            logger.error('Failed processing smart_money message', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });

      ws.on('close', (code) => {
        logger.warn('WebSocket closed', { code });
        finish(fatal);
      });

      ws.on('error', (error) => {
        logger.error('WebSocket socket error', {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!settled && ws.readyState === WebSocket.CONNECTING) finish(undefined, error);
      });

      ws.on('ping', () => {
        try {
          ws.pong();
        } catch {
          /* ignore */
        }
      });
    });
  }

  mapSmartMoney(data) {
    return {
      platform: data.platform || 'polymarket',
      trade_id: data.trade_id || data.id,
      market_id: data.market_id || data.condition_id,
      token_id: data.token_id,
      side: data.side || data.outcome,
      taker_side: data.taker_side,
      price: data.price,
      shares: data.shares || data.size,
      amount_usd: data.amount_usd ?? data.total ?? data.notional,
      taker_addr: data.taker_addr || data.wallet,
      maker_addr: data.maker_addr,
      wallet: data.wallet,
      wallet_name: data.wallet_name || data.trader_name,
      taker_name: data.taker_name,
      smart_lifetime_pnl: data.lifetime_pnl ?? data.smart_lifetime_pnl,
      title: data.title || data.market_title,
      source_url: data.source_url || data.market_url,
      executed_at: data.executed_at,
      timestamp: data.timestamp || data.ts,
    };
  }

  startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ action: 'heartbeat' }));
        } catch {
          /* ignore */
        }
      }
    }, 30000);
  }

  clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  stop() {
    this.running = false;
    this.clearHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
  }
}
