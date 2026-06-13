import { useEffect, useRef, useState } from 'react';
import { Box, Flex, VStack, HStack, Text, Button, Switch, Badge, Collapse } from '@chakra-ui/react';
import { Copy, Trash2, RefreshCw, Play } from 'lucide-react';

interface Log {
  id: number;
  text: string;
  level: string;
}

interface Job {
  id: string;
  timestamp: number;
  status: string;
  payload: any;
  output?: string;
  result?: { output?: string };
}

export default function ActivityView({ isActive }: { isActive: boolean }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [currentJobProgress, setCurrentJobProgress] = useState<string | null>(null);
  
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const history = await (window as any).electronAPI?.getJobs?.();
        if (history) setJobs(history);
      } catch (error) {
        console.error('Failed to load jobs', error);
      }
    };
    fetchJobs();

    const cleanupLog = (window as any).electronAPI?.onSpooferLog?.((data: any) => {
      let text = data?.message || data?.text || String(data);
      let level = data?.level || 'info';

      if (!data?.level) {
        const lower = text.toLowerCase();
        if (lower.includes('error') || lower.includes('failed') || lower.includes('invalid')) level = 'error';
        else if (lower.includes('success') || lower.includes('completed')) level = 'success';
        else if (lower.includes('warning') || lower.includes('skip')) level = 'warn';
      }

      setLogs((prev) => {
        const newLogs = [...prev, { id: Date.now() + Math.random(), text, level }];
        if (newLogs.length > 500) return newLogs.slice(newLogs.length - 500);
        return newLogs;
      });
    });

    const cleanupResult = (window as any).electronAPI?.onSpooferResult?.(() => {
      setCurrentJobProgress(null);
      fetchJobs();
    });

    const cleanupProgress = (window as any).electronAPI?.onSpooferProgress?.((data: any) => {
      if (data.total) {
        const phaseLabel = {
          preparing: 'Preparing',
          locations: 'Resolving download locations',
          download: 'Downloading',
          upload: 'Uploading',
        }[data.phase as string] || 'Processing';
        setCurrentJobProgress(`${phaseLabel}: ${data.current} / ${data.total}`);
      }
    });

    const handleClearSession = () => {
      setLogs([]);
      setCurrentJobProgress('Initializing...');
    };

    window.addEventListener('clear-session', handleClearSession);

    return () => {
      cleanupLog?.();
      cleanupResult?.();
      cleanupProgress?.();
      window.removeEventListener('clear-session', handleClearSession);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && viewportRef.current) {
      viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const copyLogs = () => {
    const text = logs.map((l) => l.text).join('\n');
    navigator.clipboard.writeText(text);
  };

  const redoJob = (job: Job) => {
    if (window.confirm('Are you sure you want to redo this job with its exact original settings?')) {
      (window as any).electronAPI?.runSpooferAction?.(job.payload);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (window.confirm('Permanently delete this job history?')) {
      await (window as any).electronAPI?.deleteJob?.(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  };

  const retryFailed = (job: Job, failedEntriesText: string) => {
    if (window.confirm(`Re-run only the ${failedEntriesText.split('\n').filter(Boolean).length} failed asset(s) from this job with the same settings?`)) {
      if (job.payload) {
        (window as any).electronAPI?.runSpooferAction?.({ ...job.payload, animationId: failedEntriesText });
      }
    }
  };

  if (!isActive) return null;

  return (
    <Flex direction="column" h="100%" p="24px" gap="24px" overflow="hidden">
      <Box flex={1} overflowY="auto" pr="12px" sx={{
        '&::-webkit-scrollbar': { width: '8px' },
        '&::-webkit-scrollbar-thumb': { bg: 'discord.input', borderRadius: '4px' },
        '&::-webkit-scrollbar-track': { bg: 'transparent' }
      }}>
        <VStack spacing="16px" align="stretch">
          {!currentJobProgress && jobs.length === 0 && (
            <Flex direction="column" align="center" justify="center" h="200px">
              <Text color="discord.darkMuted" fontSize="14px" fontWeight={500}>No recent activity. Start an upload to see it here!</Text>
            </Flex>
          )}

          {currentJobProgress && (
            <Box bg="discord.card" borderRadius="8px" p="16px" border="1px solid" borderColor="discord.border" boxShadow="0 2px 10px rgba(0,0,0,0.1)">
              <HStack justify="space-between" mb="8px">
                <Text fontWeight={700} color="discord.text" fontSize="14px">Upload Job • {new Date().toLocaleTimeString()}</Text>
                <Badge bg="brand.500" color="brand.contrast" px="8px" py="2px" borderRadius="4px" textTransform="uppercase" fontSize="10px" fontWeight={800}>{currentJobProgress.split(':')[0]}...</Badge>
              </HStack>
              <Text fontSize="13px" color="discord.muted">{currentJobProgress}</Text>
            </Box>
          )}

          {jobs.map((job) => (
            <JobCard key={job.id} job={job} redoJob={redoJob} deleteJob={deleteJob} retryFailed={retryFailed} />
          ))}
        </VStack>
      </Box>

      <Flex direction="column" h="250px" bg="discord.card" borderRadius="8px" border="1px solid" borderColor="discord.border" overflow="hidden" flexShrink={0} boxShadow="0 4px 12px rgba(0,0,0,0.15)">
        <HStack justify="space-between" p="12px 16px" borderBottom="1px solid" borderColor="discord.border" bg="discord.card">
          <Text fontSize="12px" fontWeight={700} color="discord.darkMuted" textTransform="uppercase" letterSpacing="0.5px">Backend Spoofer Logs</Text>
          <HStack spacing="12px">
            <Button size="xs" variant="ghost" color="discord.muted" _hover={{ bg: 'discord.background', color: 'discord.text' }} onClick={copyLogs} h="24px" px="8px" fontSize="12px">Copy</Button>
            <Button size="xs" variant="ghost" color="red.400" _hover={{ bg: 'discord.background', color: 'red.500' }} onClick={() => setLogs([])} h="24px" px="8px" fontSize="12px">Clear</Button>
            <HStack spacing="8px" ml="8px">
              <Text fontSize="12px" color="discord.muted" fontWeight={500}>Auto-scroll</Text>
              <Switch size="sm" colorScheme="brand" isChecked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            </HStack>
          </HStack>
        </HStack>
        <Box ref={viewportRef} flex={1} p="16px" bg="discord.inputDark" overflowY="auto" sx={{
          '&::-webkit-scrollbar': { width: '8px' },
          '&::-webkit-scrollbar-thumb': { bg: 'discord.input', borderRadius: '4px' },
          '&::-webkit-scrollbar-track': { bg: 'transparent' }
        }}>
          {logs.map((log) => (
            <Text key={log.id} fontSize="13px" color={log.level === 'error' ? '#fa777c' : log.level === 'success' ? '#57f287' : log.level === 'warn' ? '#fee75c' : '#949ba4'} fontFamily="'Consolas', 'Courier New', monospace" whiteSpace="pre-wrap" lineHeight="1.5">
              {log.text}
            </Text>
          ))}
        </Box>
      </Flex>
    </Flex>
  );
}

function parseJobSummary(output: string) {
  if (!output) return null;
  const total = output.match(/Total (?:animations|sounds):\s*(\d+)/i)?.[1];
  const downloaded = output.match(/Downloaded:\s*(\d+)/i)?.[1];
  const uploaded = output.match(/Uploaded:\s*(\d+)/i)?.[1];
  const mode = /Download-Only/i.test(output) ? 'Download-Only' : 'Upload';
  return { total, downloaded, uploaded, mode };
}

function extractFailedEntries(output: string, payload: any) {
  if (!output || !payload?.animationId) return null;
  const failedIds = new Set();
  const failurePattern = /(?:Download Failed|Upload Failed|UPLOAD FAILED|DOWNLOAD FAILED)[^(]*\(ID:\s*(\d+)\)/gi;
  let m;
  while ((m = failurePattern.exec(output))) {
    failedIds.add(m[1]);
  }
  if (failedIds.size === 0) return null;
  return payload.animationId.split('\n').filter((line: string) => {
    const idMatch = line.match(/\[(\d+)\]/);
    return idMatch && failedIds.has(idMatch[1]);
  }).join('\n') || null;
}

function JobCard({ job, redoJob, deleteJob, retryFailed }: { job: Job; redoJob: (j: Job) => void; deleteJob: (id: string) => void; retryFailed: (j: Job, text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const output = job.output || job.result?.output || '';

  let statusText = 'Completed';
  let badgeColor = 'green.500';
  let badgeBg = 'rgba(87, 242, 135, 0.1)';
  if (job.status === 'processing') { statusText = 'Processing...'; badgeColor = 'brand.500'; badgeBg = 'rgba(88, 101, 242, 0.1)'; }
  else if (job.status === 'partial') { statusText = 'Completed with some errors'; badgeColor = 'yellow.400'; badgeBg = 'rgba(254, 231, 92, 0.1)'; }
  else if (job.status === 'error') { statusText = 'Failed or Cancelled'; badgeColor = 'red.400'; badgeBg = 'rgba(250, 119, 124, 0.1)'; }

  const summary = parseJobSummary(output);
  const failedEntries = extractFailedEntries(output, job.payload);

  const collapsedInfo = summary
    ? [summary.mode && `Mode: ${summary.mode}`, summary.total && `Total: ${summary.total}`, summary.downloaded && `Downloaded: ${summary.downloaded}`, summary.uploaded && `Uploaded: ${summary.uploaded}`].filter(Boolean).join(' · ')
    : null;

  return (
    <Box bg="discord.card" borderRadius="8px" border="1px solid" borderColor="discord.border" p="16px" cursor="pointer" onClick={() => setExpanded(!expanded)} _hover={{ bg: 'discord.background' }} transition="all 0.2s ease" boxShadow="0 2px 8px rgba(0,0,0,0.05)">
      <HStack justify="space-between" mb="8px">
        <Text fontWeight={700} color="discord.text" fontSize="14px">Upload Job • {new Date(job.timestamp).toLocaleString()}</Text>
        <Badge bg={badgeBg} color={badgeColor} px="8px" py="2px" borderRadius="4px" textTransform="uppercase" fontSize="10px" fontWeight={800}>{job.status.toUpperCase()}</Badge>
      </HStack>
      
      <Text fontSize="13px" color="discord.text" fontWeight={500}>{statusText}</Text>
      {collapsedInfo && <Text fontSize="12px" color="discord.darkMuted" mt="4px">{collapsedInfo}</Text>}

      <HStack mt="16px" onClick={(e) => e.stopPropagation()} spacing="8px">
        {output && <Button size="sm" variant="solid" bg="discord.input" color="discord.muted" _hover={{ bg: 'discord.inputDark', color: 'discord.text' }} leftIcon={<Copy size={14} />} onClick={() => navigator.clipboard.writeText(output)} h="28px" fontSize="12px" px="12px">Copy Output</Button>}
        <Button size="sm" variant="solid" bg="discord.input" color="discord.muted" _hover={{ bg: 'discord.inputDark', color: 'discord.text' }} leftIcon={<RefreshCw size={14} />} onClick={() => redoJob(job)} h="28px" fontSize="12px" px="12px">Redo</Button>
        {failedEntries && (
          <Button size="sm" variant="solid" bg="rgba(254, 231, 92, 0.1)" color="yellow.400" _hover={{ bg: 'rgba(254, 231, 92, 0.2)' }} leftIcon={<Play size={14} />} onClick={() => retryFailed(job, failedEntries)} h="28px" fontSize="12px" px="12px">
            Retry Failed ({failedEntries.split('\n').filter(Boolean).length})
          </Button>
        )}
        <Button size="sm" variant="solid" bg="rgba(250, 119, 124, 0.1)" color="red.400" _hover={{ bg: 'rgba(250, 119, 124, 0.2)' }} leftIcon={<Trash2 size={14} />} onClick={() => deleteJob(job.id)} h="28px" fontSize="12px" px="12px">Delete</Button>
      </HStack>

      <Collapse in={expanded} animateOpacity>
        <Box mt="16px" p="16px" bg="discord.inputDark" borderRadius="6px" border="1px solid" borderColor="discord.border">
          <Text fontSize="12px" fontFamily="'Consolas', 'Courier New', monospace" whiteSpace="pre-wrap" color="#949ba4" lineHeight="1.5">
            {output || 'No additional output details available.'}
          </Text>
        </Box>
      </Collapse>
    </Box>
  );
}
