#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requireVirusTotal = process.argv.includes('--require-virustotal');
const minBytes = Number(process.env.MIN_RELEASE_ASSET_BYTES || 1024);
const errors = [];

function globFiles(dir, matcher) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) return [];
  return fs
    .readdirSync(fullDir)
    .map((name) => path.join(fullDir, name))
    .filter((file) => fs.statSync(file).isFile())
    .filter((file) => matcher(path.basename(file)));
}

function assertOne(label, files, options = {}) {
  const requiredBytes = Number(options.minBytes || minBytes);
  if (!files.length) {
    errors.push(`Missing ${label}.`);
    return;
  }
  for (const file of files) {
    const size = fs.statSync(file).size;
    if (size < requiredBytes)
      errors.push(`${path.relative(root, file)} is too small (${size} bytes).`);
    else console.log(`ok ${label}: ${path.relative(root, file)} (${size} bytes)`);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch (error) {
    errors.push(`${file} is not valid JSON: ${error.message}`);
    return null;
  }
}

assertOne(
  'managed app exe',
  globFiles(
    'dist',
    (name) => /^ISpooferMotion-App.*\.exe$/i.test(name) || /App.*\.exe$/i.test(name),
  ),
);
assertOne(
  'Roblox plugin rbxmx',
  globFiles('dist', (name) => /\.rbxmx$/i.test(name)),
);
assertOne(
  'release notes',
  globFiles('dist', (name) => name === 'release-notes.md'),
  { minBytes: 64 },
);

if (requireVirusTotal) {
  const vtReport = readJson('dist/virustotal-links.json');
  if (vtReport && vtReport.skipped) {
    errors.push(
      `VirusTotal upload was skipped: ${vtReport.skippedReason || 'no reason was provided'}.`,
    );
  }
  assertOne(
    'VirusTotal JSON report',
    globFiles('dist', (name) => name === 'virustotal-links.json'),
  );
  assertOne(
    'VirusTotal markdown report',
    globFiles('dist', (name) => name === 'virustotal-links.md'),
    { minBytes: 64 },
  );
}

if (errors.length) {
  console.error('\nRelease asset verification failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('\nrelease asset verification complete');
