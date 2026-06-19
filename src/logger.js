/**
 * Tiny levelled logger with timestamps and structured context.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let currentLevel = LEVELS.info;

export function setLogLevel(level) {
  const resolved = LEVELS[level];
  if (resolved !== undefined) currentLevel = resolved;
}

function formatContext(context) {
  if (!context || Object.keys(context).length === 0) return '';
  try {
    return ' ' + JSON.stringify(context);
  } catch {
    return ' [unserializable context]';
  }
}

function log(level, message, context) {
  if (LEVELS[level] < currentLevel) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${formatContext(context)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message, context) => log('debug', message, context),
  info: (message, context) => log('info', message, context),
  warn: (message, context) => log('warn', message, context),
  error: (message, context) => log('error', message, context),
};
