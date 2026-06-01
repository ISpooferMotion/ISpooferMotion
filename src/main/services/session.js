'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');
const { DEVELOPER_MODE } = require('./common');

let sessionWriteQueue = Promise.resolve();

function getSessionPath() {
  return path.join(app.getPath('userData'), 'ispoofer_session.json');
}

function queueSessionWrite(operation) {
  const result = sessionWriteQueue.catch(() => {}).then(operation);
  sessionWriteQueue = result.catch(() => {});
  return result;
}

function saveSession(session) {
  const text = JSON.stringify(session, null, 2);
  return queueSessionWrite(async () => {
    try {
      await fs.writeFile(getSessionPath(), text, 'utf8');
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

module.exports = {
  getSessionPath,
  saveSession,
  loadSession,
  clearSession,
};
