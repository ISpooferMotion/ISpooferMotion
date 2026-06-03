'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { inspect } = require('node:util');

const DEVELOPER_MODE = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const KEEP_DOWNLOADS_ON_FAILURE = false;
const LOG_TO_FILE = true;

const REDACTED_COOKIE = '{Cookie:Here}';
const REDACTED_API_KEY = '{ApiKey:Here}';
const SENSITIVE_PATTERNS = [
  [/"robloxCookie"\s*:\s*"[^"]*"/gi, '"robloxCookie":"{Cookie:Here}"'],
  [/\.ROBLOSECURITY=[^;\s,}"]*/gi, REDACTED_COOKIE],
  [/_\|WARNING:[^|]*\|_[^,}\s"]*/gi, REDACTED_COOKIE],
  [/ROBLOSECURITY[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, `ROBLOSECURITY:${REDACTED_COOKIE}$1`],
  [/X-CSRF-TOKEN[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, `X-CSRF-TOKEN:${REDACTED_COOKIE}$1`],
  [/"X-CSRF-TOKEN"\s*:\s*"[^"]*"/gi, '"X-CSRF-TOKEN":"{Cookie:Here}"'],
  [/Bearer\s+[^\s,;},"]*([,}"\s]|$)/gi, `Bearer ${REDACTED_COOKIE}$1`],
  [/Authorization[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, `Authorization:${REDACTED_COOKIE}$1`],
  [/"Authorization"\s*:\s*"[^"]*"/gi, '"Authorization":"{Cookie:Here}"'],
  [/"x-api-key"\s*:\s*"[^"]*"/gi, '"x-api-key":"{ApiKey:Here}"'],
  [/x-api-key[=:]\s*[^\s,;},"]*([,}"\s]|$)/gi, `x-api-key:${REDACTED_API_KEY}$1`],
  [/"openCloudApiKey"\s*:\s*"[^"]*"/gi, '"openCloudApiKey":"{ApiKey:Here}"'],
  [/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"{ApiKey:Here}"'],
  [/Cookie[=:]\s*[^};"]*([};"]\s*|$)/gi, `Cookie:${REDACTED_COOKIE}$1`],
  [/"Cookie"\s*:\s*"[^"]*"/gi, '"Cookie":"{Cookie:Here}"'],
  [
    /"(?:session|token|accessToken|refreshToken)"\s*:\s*"[^"]*"/gi,
    (match) => match.replace(/:\s*"[^"]*"/, `:"${REDACTED_COOKIE}"`),
  ],
];

let fileLoggingInitialized = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

function toLogString(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }
  return inspect(value, {
    depth: 6,
    colors: false,
    compact: false,
    breakLength: 120,
    maxArrayLength: 250,
    maxStringLength: 8000,
  });
}

function sanitizeLogMessage(message) {
  if (message == null) return message;

  let sanitized = typeof message === 'string' ? message : toLogString(message);
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function formatLogMessage(level, args) {
  const timestamp = new Date().toISOString();
  const message = args.map((arg) => sanitizeLogMessage(toLogString(arg))).join(' ');
  return `[${timestamp}] [${level}] ${message}`;
}

async function writeToLogFile(message, logFilePath) {
  if (!LOG_TO_FILE || !logFilePath) return;

  try {
    await fs.appendFile(logFilePath, `${message}\n`, 'utf8');
  } catch {
    // Never let logging failure break app flow or recursively log itself.
  }
}

async function initializeFileLogging(logsDir) {
  if (!LOG_TO_FILE || fileLoggingInitialized) return null;

  try {
    const logsDirectory = path.resolve(logsDir);
    await fs.mkdir(logsDirectory, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(logsDirectory, `debug-${stamp}.txt`);

    const originals = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    const patchConsole = (method, level) => {
      console[method] = (...args) => {
        originals[method](...args);
        void writeToLogFile(formatLogMessage(level, args), logFilePath);
      };
    };

    patchConsole('log', 'LOG');
    patchConsole('warn', 'WARN');
    patchConsole('error', 'ERROR');

    fileLoggingInitialized = true;
    console.log(`[LOG FILE] Logging initialized: ${logFilePath}`);
    return logFilePath;
  } catch (err) {
    console.error('Failed to initialize file logging:', err);
    return null;
  }
}

async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  const attempts = Math.max(1, Number.parseInt(retries, 10) || 1);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (isNonRetryableError(err)) throw err;
      if (typeof onRetryAttempt === 'function') {
        await onRetryAttempt(attempt, attempts, err);
      }
      if (attempt < attempts) await sleep(delayMs);
    }
  }

  throw new Error(`After ${attempts} attempts: ${lastError?.message || lastError}`, {
    cause: lastError,
  });
}

function markNonRetryableError(error, code = 'NON_RETRYABLE') {
  const normalizedError = error instanceof Error ? error : new Error(String(error || code));
  normalizedError.nonRetryable = true;
  normalizedError.code = normalizedError.code || code;
  return normalizedError;
}

function isNonRetryableError(error) {
  if (error?.nonRetryable === true) return true;
  if (error?.name === 'AbortError') return true;
  if (error?.message === 'Operation cancelled') return true;
  return false;
}

async function clearDownloadsDirectory(directoryPath, skipIfEnabled = KEEP_DOWNLOADS_ON_FAILURE) {
  if (skipIfEnabled) {
    if (DEVELOPER_MODE)
      console.log('(Dev) Skipping directory clear: KEEP_DOWNLOADS_ON_FAILURE is enabled');
    return true;
  }

  try {
    const targetDir = path.resolve(directoryPath);
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(targetDir, { withFileTypes: true });

    await Promise.all(
      entries.map((entry) =>
        fs.rm(path.join(targetDir, entry.name), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        }),
      ),
    );

    if (DEVELOPER_MODE) console.log(`(Dev) Directory ${targetDir} cleared successfully.`);
    return true;
  } catch (err) {
    console.error(`Error clearing directory ${directoryPath}:`, err);
    return false;
  }
}

function sanitizeFilename(filename) {
  return (
    String(filename || 'untitled')
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[.\s]+$/g, '')
      .slice(0, 180) || 'untitled'
  );
}

function normalizeRobloxCookie(cookieValue) {
  if (typeof cookieValue !== 'string') return '';

  let normalized = cookieValue.trim().replace(/^['"]+|['"]+$/g, '');
  const prefixedMatch = normalized.match(/(?:^|;\s*)\.ROBLOSECURITY=([^;]+)/i);

  if (prefixedMatch?.[1]) normalized = prefixedMatch[1].trim();
  normalized = normalized
    .replace(/^\.ROBLOSECURITY=/i, '')
    .replace(/[;\r\n]+$/g, '')
    .trim();

  return normalized;
}

function buildRobloxCookieHeader(cookieValue) {
  const normalized = normalizeRobloxCookie(cookieValue);
  return normalized ? `.ROBLOSECURITY=${normalized}` : '';
}

module.exports = {
  retryAsync,
  markNonRetryableError,
  isNonRetryableError,
  clearDownloadsDirectory,
  sanitizeFilename,
  normalizeRobloxCookie,
  buildRobloxCookieHeader,
  initializeFileLogging,
  sanitizeLogMessage,
  DEVELOPER_MODE,
  KEEP_DOWNLOADS_ON_FAILURE,
  LOG_TO_FILE,
};
