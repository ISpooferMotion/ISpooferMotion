#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist');
const jsonPath = path.join(outDir, 'virustotal-links.json');
const markdownPath = path.join(outDir, 'virustotal-links.md');
const apiKey = String(process.env.VIRUSTOTAL_API_KEY || '').trim();
const releaseTag = String(process.env.RELEASE_TAG || 'release').trim();
const allowedExtensions = ['.exe', '.rbxmx', '.dmg', '.zip', '.AppImage', '.deb'];
const assetPaths = fs
  .readdirSync(outDir)
  .filter((name) => allowedExtensions.some((ext) => name.endsWith(ext)))
  .map((name) => path.join(outDir, name));

function sha256File(filePath) {
  const digest = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  digest.update(data);
  return digest.digest('hex');
}

function writeReport(rows, skippedReason = '') {
  fs.mkdirSync(outDir, { recursive: true });
  const output = {
    releaseTag,
    skipped: Boolean(skippedReason),
    skippedReason,
    assets: rows,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const lines = [`### VirusTotal Scan Results`, ''];

  if (skippedReason) {
    lines.push(`VirusTotal upload was skipped: ${skippedReason}`, '');
  } else {
    lines.push('| Asset | SHA-256 | VirusTotal |', '| --- | --- | --- |');
    for (const row of rows) {
      lines.push(`| \`${row.name}\` | \`${row.sha256}\` | [View scan](${row.fileUrl}) |`);
    }
    lines.push('');
  }

  fs.writeFileSync(markdownPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${path.relative(root, jsonPath)} and ${path.relative(root, markdownPath)}`);
}

function makeFormData(boundary, filePath) {
  const filename = path.basename(filePath);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, fs.readFileSync(filePath), footer]);
}

async function vtJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'x-apikey': apiKey,
      'User-Agent': 'ISpooferMotion-GitHub-Release-Scanner',
      ...(options.headers || {}),
    },
    body: options.body,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (
    response.status === 409 &&
    payload &&
    payload.error &&
    payload.error.code === 'AlreadySubmittedError'
  ) {
    return { alreadySubmitted: true };
  }
  if (!response.ok)
    throw new Error(`VirusTotal API failed: HTTP ${response.status}: ${text.slice(0, 500)}`);
  return payload;
}

async function getUploadUrl(filePath) {
  const size = fs.statSync(filePath).size;
  if (size <= 32 * 1024 * 1024) return 'https://www.virustotal.com/api/v3/files';
  const response = await vtJson('https://www.virustotal.com/api/v3/files/upload_url');
  return response.data;
}

async function uploadFile(filePath) {
  const boundary = `----ISpooferMotionVT${crypto.randomUUID().replace(/-/g, '')}`;
  const body = makeFormData(boundary, filePath);
  const uploadUrl = await getUploadUrl(filePath);
  return vtJson(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function main() {
  const existingFiles = assetPaths.filter(
    (filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile(),
  );
  if (existingFiles.length === 0)
    throw new Error('No release assets were provided for VirusTotal upload.');

  const rows = existingFiles.map((filePath) => {
    const digest = sha256File(filePath);
    return {
      name: path.basename(filePath),
      sha256: digest,
      analysisId: '',
      fileUrl: `https://www.virustotal.com/gui/file/${digest}`,
      analysisUrl: '',
    };
  });

  if (!apiKey) {
    writeReport(rows, 'VIRUSTOTAL_API_KEY secret was not configured.');
    return;
  }

  for (const row of rows) {
    const filePath = existingFiles.find((candidate) => path.basename(candidate) === row.name);
    console.log(`Uploading ${row.name} to VirusTotal...`);
    try {
      const response = await uploadFile(filePath);
      if (response.alreadySubmitted) {
        console.log(`${row.name} is already being scanned by VirusTotal; using hash link.`);
      } else {
        row.analysisId = response && response.data && response.data.id ? response.data.id : '';
        row.analysisUrl = row.analysisId
          ? `https://www.virustotal.com/gui/analysis/${encodeURIComponent(row.analysisId)}`
          : '';
      }
    } catch (err) {
      console.warn(
        `Failed to upload ${row.name} to VirusTotal: ${err.message}. Using default hash link.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 16000));
  }

  writeReport(rows);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
