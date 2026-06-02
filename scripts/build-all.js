#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function resolveCommand(command, args) {
  if (process.platform !== 'win32' || command !== 'npm') return { command, args };
  const npmCliPath = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCliPath)) throw new Error(`npm CLI not found: ${npmCliPath}`);
  return { command: process.execPath, args: [npmCliPath, ...args] };
}

function run(command, args, cwd = root) {
  console.log(`\n> ${[command, ...args].join(' ')}`);
  const invocation = resolveCommand(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(result.error);
    process.exit(result.status || 1);
  }
}

run('npm', ['run', 'clean']);
run('npm', ['run', 'build:plugin']);
run('npm', ['run', 'build']);

console.log('\nbuild complete');
