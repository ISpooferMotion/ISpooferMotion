import { Accordion, AccordionItem, Button, pageVariants } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence,motion } from 'framer-motion';
import { CheckCircle2, Clock, FileText, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { queueSpoofRetry,type SpoofJob } from '../../utils/jobTypes';
import { logIsm } from '../../utils/robloxProfiles';

export default function ActivityView() {
  const { updateConfig } = useConfig();
  const [jobs, setJobs] = useState<SpoofJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      const data = await invoke<SpoofJob[]>('get_jobs');
      setJobs(data || []);
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

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="h-full w-full flex flex-col p-6 overflow-y-auto overflow-x-hidden relative"
    >
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary mb-1">
            Job History
          </h1>
          <p className="text-[13px] text-text-secondary">
            Review past spoofing jobs and easily retry failed assets.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
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
          <Accordion type="multiple" className="space-y-3 pb-8">
            <AnimatePresence initial={false}>
              {jobs.map((job) => {
                const totalAssets = job.assetResults?.length || 0;
                const successfulAssets = job.assetResults?.filter((r) => r.success).length || 0;
                const failedAssets =
                  job.assetResults?.filter((r) => !r.success && !r.skipped).length || 0;
                const date = new Date(job.startTime).toLocaleString();

                return (
                  <motion.div
                    key={job.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <AccordionItem
                      value={job.id}
                      className="bg-bg-elevated/40 border border-border-subtle rounded-[var(--radius-lg)] overflow-hidden"
                      trigger={
                        <div className="flex items-center justify-between w-full p-4 hover:bg-bg-elevated/60 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-full bg-bg-base border border-border-strong">
                              {job.status === 'successful' ? (
                                <CheckCircle2 size={18} className="text-green-500" />
                              ) : job.status === 'partially_finished' ? (
                                <CheckCircle2 size={18} className="text-yellow-500" />
                              ) : (
                                <XCircle size={18} className="text-red-500" />
                              )}
                            </div>
                            <div className="flex flex-col items-start gap-1">
                              <span className="text-[14px] font-medium text-text-primary">
                                Spoof Job • {totalAssets} asset{totalAssets !== 1 ? 's' : ''}
                              </span>
                              <span className="text-[12px] text-text-muted flex items-center gap-2">
                                {date}
                                <span>•</span>
                                {formatDuration(job.durationMs)}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <div className="flex gap-2 text-[12px] font-medium">
                              <span className="text-green-500/90">{successfulAssets} OK</span>
                              {failedAssets > 0 && (
                                <span className="text-red-500/90">{failedAssets} Failed</span>
                              )}
                            </div>
                            {job.account && (
                              <div className="flex items-center gap-1.5 opacity-70">
                                {job.account.avatarUrl && (
                                  <img
                                    src={job.account.avatarUrl}
                                    alt=""
                                    className="w-4 h-4 rounded-full"
                                  />
                                )}
                                <span className="text-[11px] truncate max-w-[100px]">
                                  {job.account.name}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      }
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-border-subtle/50 bg-bg-base/30">
                        <div className="flex flex-wrap gap-2 mb-4">
                          <Button variant="secondary" size="sm" onClick={(e: React.MouseEvent) => handleRedoJob(job, e)}>
                            <Play size={14} className="mr-1.5" />
                            Redo Job
                          </Button>
                          {failedAssets > 0 && (
                            <Button variant="primary" size="sm" onClick={(e: React.MouseEvent) => handleRetryFailed(job, e)}>
                              <RotateCcw size={14} className="mr-1.5" />
                              Retry Failed ({failedAssets})
                            </Button>
                          )}
                          {job.logFilePath && (
                            <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => handleOpenLog(job.logFilePath, e)}>
                              <FileText size={14} className="mr-1.5" />
                              View Log
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={(e: React.MouseEvent) => handleDelete(job.id, e)} className="ml-auto text-red-500/80 hover:bg-red-500/10">
                            <Trash2 size={14} className="mr-1.5" />
                            Delete
                          </Button>
                        </div>

                        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-2 rounded-[var(--radius-md)] border border-border-subtle/50 p-2 bg-bg-base/50">
                          {job.assetResults?.map((res, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between p-2 rounded-md hover:bg-bg-elevated/40 text-[12px]"
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
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Accordion>
        )}
      </div>
    </motion.div>
  );
}
