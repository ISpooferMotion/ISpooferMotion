'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app } = require('electron');

function getJobsPath() {
  return path.join(app.getPath('userData'), 'ispoofer_jobs.json');
}

let jobsWriteQueue = Promise.resolve();

function queueJobsWrite(operation) {
  const result = jobsWriteQueue.catch(() => {}).then(operation);
  jobsWriteQueue = result.catch(() => {});
  return result;
}

async function loadJobsUnlocked() {
  try {
    return JSON.parse(await fs.readFile(getJobsPath(), 'utf8')) || [];
  } catch {
    return [];
  }
}

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

    if (jobs.length > 50) jobs.splice(50);
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
