'use strict';

// --- Run state ---
let isPaused = false;
let isCancelled = false;
let abortController = new AbortController();

// Resolvers for promises that are waiting for the spoofer to resume.
const pauseResolvers = new Set();

// --- Control functions ---

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

/**
 * Resets all run controls at the start of a new run so a previously-paused
 * or cancelled run cannot block the next one.
 */
function resetRunControls() {
  isCancelled = false;
  abortController = new AbortController();
  resumeSpoofer();
}

// --- Check helpers (called inside workers) ---

function checkCancelled() {
  if (isCancelled) throw new Error('Operation cancelled');
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
