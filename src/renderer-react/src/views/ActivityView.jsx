import { useEffect, useRef, useState } from 'react';

export default function ActivityView({ isActive }) {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [currentJobProgress, setCurrentJobProgress] = useState(null);

  const terminalOutputRef = useRef(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const history = await window.electronAPI?.getJobs?.();
        if (history) setJobs(history);
      } catch (error) {
        console.error('Failed to load jobs', error);
      }
    };
    fetchJobs();

    const cleanupLog = window.electronAPI?.onSpooferLog?.((data) => {
      let text = data?.message || data?.text || String(data);
      let level = data?.level || 'info';

      if (!data?.level) {
        const lower = text.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid'))
          level = 'error';
        else if (lower.includes('success') || lower.includes('completed')) level = 'success';
        else if (lower.includes('warning') || lower.includes('skip')) level = 'warn';
      }

      setLogs((prev) => {
        const newLogs = [...prev, { id: Date.now() + Math.random(), text, level }];
        if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500);
        return newLogs;
      });
    });

    const cleanupResult = window.electronAPI?.onSpooferResult?.(() => {
      setCurrentJobProgress(null);
      fetchJobs();
    });

    const cleanupProgress = window.electronAPI?.onSpooferProgress?.((data) => {
      if (data.total) {
        const phaseLabel =
          {
            preparing: 'Preparing',
            locations: 'Resolving download locations',
            download: 'Downloading',
            upload: 'Uploading',
          }[data.phase] || 'Processing';
        setCurrentJobProgress(`${phaseLabel}: ${data.current} / ${data.total}`);
      }
    });

    const handleClearSession = () => {
      setLogs([]);
      setCurrentJobProgress('Initializing...');
    };

    window.addEventListener('clear-session', handleClearSession);

    return () => {
      cleanupLog && cleanupLog();
      cleanupResult && cleanupResult();
      cleanupProgress && cleanupProgress();
      window.removeEventListener('clear-session', handleClearSession);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const copyLogs = () => {
    const text = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text);
  };

  const redoJob = (job) => {
    if (
      window.confirm('Are you sure you want to redo this job with its exact original settings?')
    ) {
      window.electronAPI?.runSpooferAction?.(job.payload);
    }
  };

  const deleteJob = async (jobId) => {
    if (window.confirm('Permanently delete this job history?')) {
      await window.electronAPI?.deleteJob?.(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  };

  const retryFailed = (job, failedEntriesText) => {
    if (
      window.confirm(
        `Re-run only the ${failedEntriesText.split('\n').filter(Boolean).length} failed asset(s) from this job with the same settings?`,
      )
    ) {
      if (job.payload) {
        window.electronAPI?.runSpooferAction?.({
          ...job.payload,
          animationId: failedEntriesText,
        });
      }
    }
  };

  return (
    <section
      className={`view queue-view ${isActive ? 'is-active' : ''}`}
      data-view-panel="queue"
      aria-label="Activity"
    >
      <div className="activity-page" id="activity-page">
        <div className="activity-feed" id="activity-feed">
          {!currentJobProgress && jobs.length === 0 && (
            <div className="empty-feed-msg">
              No recent activity. Start an upload to see it here!
            </div>
          )}

          {currentJobProgress && (
            <div className="job-card expanded">
              <div className="job-card-header">
                <strong>Upload Job • {new Date().toLocaleTimeString()}</strong>
                <span className="job-status uploading">{currentJobProgress.split(':')[0]}...</span>
              </div>
              <div className="job-details">
                <span className="job-progress-text">{currentJobProgress}</span>
              </div>
              <div className="job-extended-details">
                Details will appear here when the job completes.
              </div>
            </div>
          )}

          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              redoJob={redoJob}
              deleteJob={deleteJob}
              retryFailed={retryFailed}
            />
          ))}
        </div>

        <div className="activity-terminal-container">
          <div className="terminal-header">
            <span>Backend Spoofer Logs</span>
            <div
              className="terminal-header-actions"
              style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
            >
              <button
                className="ui-button"
                id="copy-terminal-logs-btn"
                type="button"
                style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', minHeight: 0 }}
                onClick={copyLogs}
              >
                Copy Logs
              </button>
              <button
                className="ui-button ui-button-danger"
                id="clear-terminal-logs-btn"
                type="button"
                style={{ padding: '4px 8px', fontSize: '11px', height: 'auto', minHeight: 0 }}
                onClick={() => setLogs([])}
              >
                Clear
              </button>
              <label
                className="option-row inline-option terminal-toggle"
                htmlFor="terminal-autoscroll"
                style={{ margin: 0 }}
              >
                <span>Auto-scroll</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    id="terminal-autoscroll"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  <i></i>
                </span>
              </label>
            </div>
          </div>
          <div className="terminal-output" id="terminal-output" ref={terminalOutputRef}>
            {logs.map((log) => (
              <div key={log.id} className={`log-line ${log.level}`}>
                {log.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function parseJobSummary(output) {
  if (!output) return null;
  const total = output.match(/Total (?:animations|sounds):\s*(\d+)/i)?.[1];
  const downloaded = output.match(/Downloaded:\s*(\d+)/i)?.[1];
  const uploaded = output.match(/Uploaded:\s*(\d+)/i)?.[1];
  const mode = /Download-Only/i.test(output) ? 'Download-Only' : 'Upload';
  return { total, downloaded, uploaded, mode };
}

function extractFailedEntries(output, payload) {
  if (!output || !payload?.animationId) return null;
  // Find IDs that appear in failure lines
  const failedIds = new Set();
  const failurePattern =
    /(?:Download Failed|Upload Failed|UPLOAD FAILED|DOWNLOAD FAILED)[^(]*\(ID:\s*(\d+)\)/gi;
  let m;
  while ((m = failurePattern.exec(output))) {
    failedIds.add(m[1]);
  }
  if (failedIds.size === 0) return null;

  const filteredLines = payload.animationId
    .split('\n')
    .filter((line) => {
      const idMatch = line.match(/\[(\d+)\]/);
      return idMatch && failedIds.has(idMatch[1]);
    })
    .join('\n');

  return filteredLines || null;
}

function JobCard({ job, redoJob, deleteJob, retryFailed }) {
  const [expanded, setExpanded] = useState(false);

  // job.output is the flat text field; job.result is not used (legacy check kept for resilience)
  const output = job.output || job.result?.output || '';

  let statusText = 'Completed';
  if (job.status === 'processing') statusText = 'Interrupted / Processing…';
  else if (job.status === 'partial') statusText = 'Completed with some errors';
  else if (job.status === 'error') statusText = 'Failed or Cancelled';

  const summary = parseJobSummary(output);
  const failedEntries = extractFailedEntries(output, job.payload);

  const collapsedInfo = summary
    ? [
        summary.mode && `Mode: ${summary.mode}`,
        summary.total && `Total: ${summary.total}`,
        summary.downloaded && `Downloaded: ${summary.downloaded}`,
        summary.uploaded && `Uploaded: ${summary.uploaded}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div
      className={`job-card ${expanded ? 'expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="job-card-header">
        <strong>
          Upload Job · {new Date(job.timestamp).toLocaleTimeString()} (
          {new Date(job.timestamp).toLocaleDateString()})
        </strong>
        <span className={`job-status ${job.status}`}>
          {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
        </span>
      </div>

      {/* Collapsed summary - always visible even when not expanded */}
      <div className="job-details">
        <span className="job-progress-text">{statusText}</span>
        {collapsedInfo && (
          <span
            className="job-collapsed-meta"
            style={{ fontSize: '11px', opacity: 0.65, marginTop: '2px', display: 'block' }}
          >
            {collapsedInfo}
          </span>
        )}
      </div>

      <div
        className="job-actions"
        style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}
        onClick={(e) => e.stopPropagation()}
      >
        {output && (
          <button
            className="ui-button"
            id={`copy-job-logs-${job.id}`}
            onClick={() => navigator.clipboard.writeText(output)}
          >
            Copy Output
          </button>
        )}
        <button className="ui-button" id={`redo-job-${job.id}`} onClick={() => redoJob(job)}>
          Redo Job
        </button>
        {failedEntries && (
          <button
            className="ui-button"
            id={`retry-failed-${job.id}`}
            style={{ borderColor: 'var(--accent, #f59e0b)', color: 'var(--accent, #f59e0b)' }}
            onClick={() => retryFailed(job, failedEntries)}
            title={`Retry ${failedEntries.split('\n').filter(Boolean).length} failed asset(s)`}
          >
            ↺ Retry Failed ({failedEntries.split('\n').filter(Boolean).length})
          </button>
        )}
        <button
          className="ui-button ui-button-danger"
          id={`delete-job-${job.id}`}
          onClick={() => deleteJob(job.id)}
        >
          Delete
        </button>
      </div>

      <div className="job-extended-details">
        {output || 'No additional output details available.'}
      </div>
    </div>
  );
}
