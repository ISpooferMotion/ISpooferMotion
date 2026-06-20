// @ts-nocheck
'use strict';

import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';

function getJobsPath() {
  return path.join(app.getPath('userData'), 'ispoofer_jobs.json');
}

let jobsWriteQueue = Promise.resolve();

function queueJobsWrite(operation: unknown) {
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

function saveJobRecord(job: unknown) {
  return queueJobsWrite(async () => {
    const jobs = await loadJobsUnlocked();
    const existingIndex = jobs.findIndex((j: any) => j.id === job.id);
    if (existingIndex >= 0) {
      jobs[existingIndex] = job;
    } else {
      jobs.unshift(job);
    }

    if (jobs.length > 50) jobs.splice(50);
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8').catch(() => {});
  });
}

function deleteJobRecord(id: unknown) {
  return queueJobsWrite(async () => {
    const jobs = (await loadJobsUnlocked()).filter((j: any) => j.id !== id);
    await fs.writeFile(getJobsPath(), JSON.stringify(jobs, null, 2), 'utf8').catch(() => {});
  });
}

export {
  loadJobs,
  saveJobRecord,
  deleteJobRecord,
};
