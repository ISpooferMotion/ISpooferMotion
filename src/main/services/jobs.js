'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');

// --- Paths ---

function getJobsPath() {
  return path.join(app.getPath('userData'), 'ispoofer_jobs.json');
}

// --- Write queue (prevents concurrent writes from corrupting the jobs list) ---

let jobsWriteQueue = Promise.resolve();

function queueJobsWrite(operation) {
  const result = jobsWriteQueue.catch(() => {}).then(operation);
  jobsWriteQueue = result.catch(() => {});
  return result;
}

// --- Internal read (used inside the write queue, never call externally) ---

async function loadJobsUnlocked() {
  try {
    return JSON.parse(await fs.readFile(getJobsPath(), 'utf8')) || [];
  } catch {
    return [];
  }
}

// --- Public API ---

async function loadJobs() {
  await jobsWriteQueue.catch(() => {});
  return loadJobsUnlocked();
}

function saveJobRecord(job) {
  return queueJobsWrite(async () => {
    const jobs = await loadJobsUnlocked();
    const existingIndex = jobs.findIndex((j) => j.id === job.id);
    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      jobs.unshift(job);
    }
    // Keep at most 50 jobs in history.
    if (jobs.length > 50) jobs.length = 50;
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8').catch(() => {});
  });
}

function deleteJobRecord(id) {
  return queueJobsWrite(async () => {
    const jobs = (await loadJobsUnlocked()).filter((j) => j.id !== id);
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8').catch(() => {});
  });
}

module.exports = {
  loadJobs,
  saveJobRecord,
  deleteJobRecord,
};
