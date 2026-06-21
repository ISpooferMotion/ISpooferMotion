'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { DEVELOPER_MODE } from './common';

function getSessionPath() {
  return path.join(app.getPath('userData'), 'ispoofer_session.json');
}

let sessionWriteQueue = Promise.resolve();

function queueSessionWrite(operation: any) {
  const result = sessionWriteQueue.catch(() => {}).then(operation);
  sessionWriteQueue = result.catch(() => {});
  return result;
}

function saveSession(session: any) {
  // Capture a snapshot reference; stringify is deferred until the write actually
  // executes so that any intermediate queued writes see the freshest data.
  const sessionSnapshot = session;
  return queueSessionWrite(async () => {
    try {
      await fs.writeFile(getSessionPath(), JSON.stringify(sessionSnapshot, null, 2), 'utf8');
    } catch (err) {
      if (DEVELOPER_MODE) console.warn('(Dev) Failed to save session:', err);
    }
  });
}

async function loadSession() {
  try {
    await sessionWriteQueue.catch(() => {});
    return JSON.parse(await fs.readFile(getSessionPath(), 'utf8'));
  } catch {
    return null;
  }
}

function clearSession() {
  return queueSessionWrite(() => fs.rm(getSessionPath(), { force: true }).catch(() => {}));
}

export {
  saveSession,
  loadSession,
  clearSession,
};
