'use strict';

let isPaused = false;
let isCancelled = false;
const pauseResolvers = new Set();
let abortController = new AbortController();

function pauseSpoofer() {
  isPaused = true;
}

function resumeSpoofer() {
  isPaused = false;
  for (const resolve of pauseResolvers) resolve();
  pauseResolvers.clear();
}

function cancelSpoofer() {
  isCancelled = true;
  abortController.abort();
  resumeSpoofer();
}

function resetRunControls() {
  isCancelled = false;
  abortController = new AbortController();
  resumeSpoofer();
}

function checkCancelled() {
  if (isCancelled) {
    throw new Error('Operation cancelled');
  }
}

async function checkPaused() {
  checkCancelled();
  if (!isPaused) return;
  await new Promise((resolve) => pauseResolvers.add(resolve));
  checkCancelled();
}

function getAbortSignal() {
  return abortController.signal;
}

module.exports = {
  pauseSpoofer,
  resumeSpoofer,
  cancelSpoofer,
  resetRunControls,
  checkCancelled,
  checkPaused,
  getAbortSignal,
};
