// @ts-nocheck
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';

const DEVELOPER_MODE = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
const KEEP_DOWNLOADS_ON_FAILURE = false;
const LOG_TO_FILE = true;

const REDACTED_COOKIE = '{Cookie:Here}';
const REDACTED_API_KEY = '{ApiKey:Here}';

const SENSITIVE_PATTERNS = [
  [/"robloxCookie"\s*:\s*"[^"]*"/gi, '"robloxCookie":"{Cookie:Here}"'],
  [/\.ROBLOSECURITY=[^;\s,"']*/gi, REDACTED_COOKIE],
  [/_\|WARNING:[^|]*\|_[^,}\s"]*/gi, REDACTED_COOKIE],
  [/ROBLOSECURITY[=:]\s*[^\s,;},"]*([\s,;"}\s]|$)/gi, `ROBLOSECURITY:${REDACTED_COOKIE}$1`],
  [/X-CSRF-TOKEN[=:]\s*[^\s,;},"]*([\s,;"}\s]|$)/gi, `X-CSRF-TOKEN:${REDACTED_COOKIE}$1`],
  [/"X-CSRF-TOKEN"\s*:\s*"[^"]*"/gi, '"X-CSRF-TOKEN":"{Cookie:Here}"'],
  [/Bearer\s+[^\s,;},"]*([\s,;"}\s]|$)/gi, `Bearer ${REDACTED_COOKIE}$1`],
  [/Authorization[=:]\s*[^\s,;},"]*([\s,;"}\s]|$)/gi, `Authorization:${REDACTED_COOKIE}$1`],
  [/"Authorization"\s*:\s*"[^"]*"/gi, '"Authorization":"{Cookie:Here}"'],
  [/"x-api-key"\s*:\s*"[^"]*"/gi, '"x-api-key":"{ApiKey:Here}"'],
  [/x-api-key[=:]\s*[^\s,;},"]*([\s,;"}\s]|$)/gi, `x-api-key:${REDACTED_API_KEY}$1`],
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

function toLogString(value: any) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  return inspect(value, {
    depth: 6,
    colors: false,
    compact: false,
    breakLength: 120,
    maxArrayLength: 250,
    maxStringLength: 8000,
  });
}

function sanitizeLogMessage(message: any) {
  if (message == null) return message;
  let sanitized = typeof message === 'string' ? message : toLogString(message);
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function formatLogMessage(level: any, args: any[]) {
  const timestamp = new Date().toISOString();
  const message = args.map((arg) => sanitizeLogMessage(toLogString(arg))).join(' ');
  return `[${timestamp}] [${level}] ${message}`;
}

async function writeToLogFile(message: any, logFilePath: any) {
  if (!LOG_TO_FILE || !logFilePath) return;
  try {
    await fs.appendFile(logFilePath, `${message}\n`, 'utf8');
  } catch {}
}

async function initializeFileLogging(logsDir: any) {
  if (!LOG_TO_FILE || fileLoggingInitialized) return null;

  try {
    const logsDirectory = path.resolve(logsDir);
    await fs.mkdir(logsDirectory, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFilePath = path.join(logsDirectory, `debug-${stamp}.txt`);

    try {
      const allLogs = (await fs.readdir(logsDirectory))
        .filter((f) => f.startsWith('debug-') && f.endsWith('.txt'))
        .sort();
      const toDelete = allLogs.slice(0, Math.max(0, allLogs.length - 5));
      await Promise.all(toDelete.map((f) => fs.rm(path.join(logsDirectory, f), { force: true })));
    } catch {}

    const originals = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    const patchConsole = (method: any, level: any) => {
      (console as any)[method] = (...args: any[]) => {
        (originals as any)[method](...args);
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

function normalizeRobloxCookie(cookieValue: any) {
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

function buildRobloxCookieHeader(cookieValue: any) {
  const normalized = normalizeRobloxCookie(cookieValue);
  return normalized ? `.ROBLOSECURITY=${normalized}` : '';
}

const sleep = (ms: any) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

function markNonRetryableError(error: any, code = 'NON_RETRYABLE') {
  const normalized: any = error instanceof Error ? error : new Error(String(error || code));
  normalized.nonRetryable = true;
  normalized.code = normalized.code || code;
  return normalized;
}

function isNonRetryableError(error: any) {
  if (error?.nonRetryable === true) return true;
  if (error?.name === 'AbortError') return true;
  if (error?.message === 'Operation cancelled') return true;
  return false;
}

async function retryAsync(fn: any, retries: any = 3, delayMs = 1000, onRetryAttempt?: any) {
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

async function clearDownloadsDirectory(
  directoryPath: any,
  skipIfEnabled = KEEP_DOWNLOADS_ON_FAILURE,
) {
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

function sanitizeFilename(filename: any) {
  return (
    String(filename || 'untitled')
      .normalize('NFKC')

      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/[.\s]+$/g, '')
      .slice(0, 180) || 'untitled'
  );
}

export {
  buildRobloxCookieHeader,
  clearDownloadsDirectory,
  DEVELOPER_MODE,
  initializeFileLogging,
  isNonRetryableError,
  KEEP_DOWNLOADS_ON_FAILURE,
  LOG_TO_FILE,
  markNonRetryableError,
  normalizeRobloxCookie,
  retryAsync,
  sanitizeFilename,
  sanitizeLogMessage,
  sleep,
};
