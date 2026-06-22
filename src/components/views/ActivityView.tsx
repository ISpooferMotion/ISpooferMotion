import { Accordion, AccordionItem, itemVariants, pageVariants, Window } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  FileText,
  Play,
  RotateCcw,
  Trash2,
  User2,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { queueSpoofRetry, type SpoofJob } from '../../utils/jobTypes';
import { logIsm } from '../../utils/robloxProfiles';

export default function ActivityView() {
  const { updateConfig } = useConfig();
  const [jobs, setJobs] = useState<SpoofJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const data = await invoke<SpoofJob[]>('get_jobs');
      const finalJobs = data ? [...data] : [];

      // Inject a fake job for UI testing in development mode
      if (import.meta.env.DEV) {
        finalJobs.push({
          id: 'fake-dev-job-123',
          status: 'partially_finished',
          startTime: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
          endTime: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
          durationMs: 1000 * 60 * 5,
          account: {
            id: '1',
            name: 'DevUser',
            avatarUrl:
              'https://tr.rbxcdn.com/38c6edcb50633730ff4cf39ac8859840/150/150/AvatarHeadshot/Png',
          },
          assetResults: [
            { id: '123456', success: true, newId: '654321', type: 'Animation' },
            { id: '111111', success: false, errorReason: 'Roblox API Error', type: 'Mesh' },
            { id: '222222', success: true, newId: '333333', type: 'Audio' },
          ],
          config: {
            assets: '123456, 111111, 222222',
            spoofSounds: true,
            downloadOnly: false,
            uploadTypes: ['animation', 'mesh', 'audio'],
          },
          logFilePath: '',
        });
      }

      setJobs(finalJobs);
    } catch (e) {
      logIsm('error', `Failed to load job history: ${e}`, true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleDelete = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('delete_job', { jobId });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (error) {
      logIsm('error', `Could not delete job: ${error}`, true);
    }
  };

  const handleOpenLog = async (logPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('open_job_log', { logPath });
    } catch (error) {
      logIsm('error', `Could not open log: ${error}`, true);
    }
  };

  const handleRedoJob = (job: SpoofJob, e: React.MouseEvent) => {
    e.stopPropagation();
    const assetIds = job.assetResults.map((r) => r.id);
    queueSpoofRetry({
      jobId: job.id,
      assetIds,
      selectedUserId: job.account?.id,
      selectedGroupId: job.config?.groupId ?? undefined,
      spoofSounds: job.config?.spoofSounds,
      uploadTypes: job.config?.uploadTypes,
      account: job.account,
      group: job.group,
    });
    updateConfig('ui', 'activeTab', 'spoofing');
  };

  const handleRetryFailed = (job: SpoofJob, e: React.MouseEvent) => {
    e.stopPropagation();
    const failedIds = job.assetResults.filter((r) => !r.success && !r.skipped).map((r) => r.id);
    if (failedIds.length === 0) return;
    queueSpoofRetry({
      jobId: job.id,
      assetIds: failedIds,
      selectedUserId: job.account?.id,
      selectedGroupId: job.config?.groupId ?? undefined,
      spoofSounds: job.config?.spoofSounds,
      uploadTypes: job.config?.uploadTypes,
      account: job.account,
      group: job.group,
    });
    updateConfig('ui', 'activeTab', 'spoofing');
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full"
    >
      <Window>
        <motion.div variants={itemVariants} className="w-full h-full flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-text-secondary">Loading history...</span>
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-text-secondary space-y-3">
                <Clock size={48} className="opacity-20" />
                <p>No job history found.</p>
                <p className="text-[13px] opacity-70">Jobs you run will appear here.</p>
              </div>
            ) : (
              <Accordion selectionMode="multiple" className="space-y-3 pb-8">
                {jobs.map((job) => {
                  const totalAssets = job.assetResults?.length || 0;
                  const failedAssets =
                    job.assetResults?.filter((r) => !r.success && !r.skipped).length || 0;

                  const dateStr = new Date(job.startTime).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  });

                  return (
                    <AccordionItem
                      key={job.id}
                      value={job.id}
                      className="bg-bg-elevated/30 border border-border-subtle/50 shadow-sm rounded-xl overflow-hidden mb-3"
                      title={
                        <div className="flex items-center justify-between w-full py-2 pr-3 pl-1">
                          <div className="flex items-center gap-4">
                            <div className="relative w-11 h-11 shrink-0">
                              {job.account?.avatarUrl ? (
                                <img
                                  src={job.account.avatarUrl}
                                  alt=""
                                  className="w-11 h-11 rounded-full border border-border-strong object-cover bg-bg-base shadow-sm"
                                />
                              ) : (
                                <div className="w-11 h-11 rounded-full border border-border-strong bg-bg-base flex items-center justify-center shadow-sm">
                                  <User2 size={20} className="text-text-muted" />
                                </div>
                              )}
                              {job.group?.iconUrl && (
                                <img
                                  src={job.group.iconUrl}
                                  alt=""
                                  className="w-[22px] h-[22px] rounded-full border-[2.5px] border-bg-elevated absolute -bottom-1 -right-1 object-cover bg-bg-base shadow-sm"
                                />
                              )}
                            </div>
                            <div className="flex flex-col items-start gap-[2px]">
                              <span className="text-[15px] font-semibold text-text-primary tracking-tight">
                                {job.group
                                  ? `Spoofed to ${job.group.name}`
                                  : `Spoofed to ${job.account?.name || 'Unknown'}`}
                              </span>
                              <span className="text-[13px] text-text-muted flex items-center gap-2">
                                {dateStr}
                                <span className="w-1 h-1 rounded-full bg-border-strong" />
                                <span className="font-medium text-text-secondary">
                                  {totalAssets} asset{totalAssets !== 1 ? 's' : ''}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      }
                    >
                      <div className="px-4 pb-4 pt-3 border-t border-border-subtle/30 bg-bg-base/20">
                        <div className="flex flex-wrap items-center gap-5 mb-4 px-1">
                          <button
                            type="button"
                            onClick={(e) => handleRedoJob(job, e)}
                            className="flex items-center text-[13px] font-medium text-text-muted hover:text-primary transition-colors"
                          >
                            <Play size={14} className="mr-1.5" />
                            Redo Job
                          </button>
                          {failedAssets > 0 && (
                            <button
                              type="button"
                              onClick={(e) => handleRetryFailed(job, e)}
                              className="flex items-center text-[13px] font-medium text-text-muted hover:text-yellow-400 transition-colors"
                            >
                              <RotateCcw size={14} className="mr-1.5" />
                              Retry Failed ({failedAssets})
                            </button>
                          )}
                          {job.logFilePath && (
                            <button
                              type="button"
                              onClick={(e) => handleOpenLog(job.logFilePath, e)}
                              className="flex items-center text-[13px] font-medium text-text-muted hover:text-text-primary transition-colors"
                            >
                              <FileText size={14} className="mr-1.5" />
                              View Log
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleDelete(job.id, e)}
                            className="flex items-center text-[13px] font-medium text-text-muted hover:text-red-400 transition-colors ml-auto"
                          >
                            <Trash2 size={14} className="mr-1.5" />
                            Delete
                          </button>
                        </div>

                        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2 rounded-[var(--radius-md)] border border-border-subtle/30 p-2 bg-bg-base/30">
                          {job.assetResults?.map((res, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between p-2 rounded-md hover:bg-bg-elevated/30 text-[12px] transition-colors"
                            >
                              <div className="flex items-center gap-3 overflow-hidden">
                                {res.success ? (
                                  <CheckCircle2 size={14} className="text-green-500/70 shrink-0" />
                                ) : res.skipped ? (
                                  <div className="w-[14px] h-[14px] rounded-full border border-yellow-500/50 flex items-center justify-center shrink-0">
                                    <div className="w-[6px] h-[2px] bg-yellow-500/50 rounded-full" />
                                  </div>
                                ) : (
                                  <XCircle size={14} className="text-red-500/70 shrink-0" />
                                )}
                                <span className="font-mono text-text-secondary opacity-70 w-24 shrink-0">
                                  {res.id}
                                </span>
                                <span className="truncate text-text-primary max-w-[200px]">
                                  {res.name || 'Unknown Asset'}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                {res.newId && (
                                  <span className="font-mono text-green-400/80">→ {res.newId}</span>
                                )}
                                {res.errorReason && (
                                  <span
                                    className="text-red-400/80 max-w-[200px] truncate"
                                    title={res.errorReason}
                                  >
                                    {res.errorReason}
                                  </span>
                                )}
                                {res.reason && res.skipped && (
                                  <span className="text-yellow-500/80 max-w-[200px] truncate">
                                    {res.reason}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </div>
        </motion.div>
      </Window>
    </motion.div>
  );
}
