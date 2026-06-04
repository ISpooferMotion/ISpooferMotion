#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findFile(dir, fileName, depth = 4) {
  if (!dir || depth < 0 || !fs.existsSync(dir)) return null;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return fullPath;
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName, depth - 1);
      if (found) return found;
    }
  }

  return null;
}

function resolveRcedit(root) {
  const localAppData = process.env.LOCALAPPDATA;
  const cached = findFile(
    localAppData && path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign'),
    process.arch === 'ia32' ? 'rcedit-ia32.exe' : 'rcedit-x64.exe',
    5,
  );
  if (cached) return cached;

  return findFile(path.join(root, 'node_modules'), 'rcedit.exe', 6);
}

module.exports = async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const root = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(root, 'src', 'assets', 'app_icon.ico');
  const rceditPath = resolveRcedit(root);

  if (!fs.existsSync(exePath)) throw new Error(`Windows executable not found: ${exePath}`);
  if (!fs.existsSync(iconPath)) throw new Error(`Windows icon not found: ${iconPath}`);
  if (!rceditPath)
    throw new Error('rcedit.exe was not found in the Electron Builder cache or node_modules.');

  const result = spawnSync(
    rceditPath,
    [
      exePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'CompanyName',
      'IncredibroXP',
      '--set-version-string',
      'FileDescription',
      'ISpooferMotion',
      '--set-version-string',
      'ProductName',
      'ISpooferMotion',
    ],
    { cwd: root, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `rcedit failed with exit code ${result.status}`,
    );
  }

  console.log(`[afterPack] Applied Windows icon to ${path.relative(root, exePath)}`);
};
