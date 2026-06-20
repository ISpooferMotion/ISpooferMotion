// @ts-nocheck
'use strict';

let isPaused = false;
let isCancelled = false;
let abortController = new AbortController();

const pauseResolvers = new Set();

export function pauseSpoofer() {
  isPaused = true;
}

export function resumeSpoofer() {
  isPaused = false;
  for (const resolve of pauseResolvers) resolve();
  pauseResolvers.clear();
}

export function cancelSpoofer() {
  isCancelled = true;
  abortController.abort();
  resumeSpoofer();
}

function resetRunControls() {
  isCancelled = false;
  abortController = new AbortController();
  resumeSpoofer();
}

export function checkCancelled() {
  if (isCancelled) throw new Error('Operation cancelled');
}

export async function checkPaused() {
  checkCancelled();
  if (!isPaused) return;
  await new Promise((resolve) => pauseResolvers.add(resolve));
  checkCancelled();
}

export function getAbortSignal() {
  return abortController.signal;
}



export {};
