'use strict';

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';

const MAX_TRANSFER_DIAGNOSTICS = 10;

function getTransferDiagnosticsDirectory(userDataPath: any = null) {
  if (userDataPath) return path.join(userDataPath, 'failed-transfer-diagnostics');
  return path.join(app.getPath('userData'), 'failed-transfer-diagnostics');
}

function sanitizeDiagnosticSegment(value: any, fallback = 'unknown') {
  const safeValue = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  return safeValue || fallback;
}

function getSourceHostname(sourceUrl: any) {
  try {
    return new URL(String(sourceUrl || '')).hostname;
  } catch {
    return '';
  }
}

async function pruneTransferDiagnostics(directoryPath: any, maxEntries: any = MAX_TRANSFER_DIAGNOSTICS) {
  const diagnosticsDir = path.resolve(directoryPath);
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const entries = await fs.readdir(diagnosticsDir, { withFileTypes: true });
  const directories = entries
    .filter((entry: any) => entry.isDirectory())
    .map((entry: any) => entry.name)
    .sort()
    .reverse();

  await Promise.all(
    directories
      .slice(Math.max(0, Number(maxEntries) || MAX_TRANSFER_DIAGNOSTICS))
      .map((name: any) => fs.rm(path.join(diagnosticsDir, name), { recursive: true, force: true })),
  );
}

async function recordFailedTransferDiagnostic(details: any = {}, directoryPath: any = null) {
  const diagnosticsDir = path.resolve(directoryPath || getTransferDiagnosticsDirectory());
  const timestamp = new Date().toISOString();
  const recordName = [
    timestamp.replace(/[:.]/g, '-'),
    sanitizeDiagnosticSegment(details.assetMode, 'asset'),
    sanitizeDiagnosticSegment(details.assetId),
    crypto.randomUUID().slice(0, 8),
  ].join('_');
  const recordDir = path.join(diagnosticsDir, recordName);
  const payloadMetadata = details.payloadMetadata || {};
  const extension = /^\.[a-z0-9]+$/i.test(payloadMetadata.extension || '')
    ? payloadMetadata.extension
    : '.bin';

  try {
    await fs.mkdir(recordDir, { recursive: true });

    let payloadFile = '';
    if (details.filePath) {
      payloadFile = `payload${extension}`;
      await fs.copyFile(details.filePath, path.join(recordDir, payloadFile)).catch(() => {
        payloadFile = '';
      });
    }

    const metadata = {
      timestamp,
      assetId: String(details.assetId || ''),
      assetMode: String(details.assetMode || 'Asset'),
      detectedFormat: String(payloadMetadata.format || 'unknown'),
      extension,
      mimeType: String(payloadMetadata.mimeType || 'application/octet-stream'),
      byteSize: Number(payloadMetadata.byteSize) || 0,
      responseContentType: String(
        details.responseContentType || payloadMetadata.responseContentType || '',
      ),
      sourceHostname: getSourceHostname(details.sourceUrl),
      failureStage: String(details.failureStage || 'unknown'),
      error: String(details.error?.message || details.error || 'Unknown transfer failure'),
      payloadFile,
    };

    await fs.writeFile(
      path.join(recordDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8',
    );
    await pruneTransferDiagnostics(diagnosticsDir);
    return recordDir;
  } catch {
    await fs.rm(recordDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}

async function clearTransferDiagnostics(directoryPath: any = null) {
  const diagnosticsDir = path.resolve(directoryPath || getTransferDiagnosticsDirectory());
  await fs.rm(diagnosticsDir, { recursive: true, force: true });
  await fs.mkdir(diagnosticsDir, { recursive: true });
  return true;
}

export {
  MAX_TRANSFER_DIAGNOSTICS,
  clearTransferDiagnostics,
  getTransferDiagnosticsDirectory,
  pruneTransferDiagnostics,
  recordFailedTransferDiagnostic,
};
