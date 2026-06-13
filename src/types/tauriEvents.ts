export type TauriEventPayload<T> = {
  payload: T;
};

export type SpooferProgressPayload = {
  jobId?: string;
  progress: number;
  message?: string;
  current?: number;
  total?: number;
};

export type SpooferLogPayload = {
  jobId?: string;
  level?: string;
  message?: string;
};

export type SpooferAssetResult = {
  id?: string;
  type?: string;
  assetType?: string;
  name?: string;
  success?: boolean;
  newId?: string;
  stage?: string;
  errorReason?: string;
  skipped?: boolean;
  reason?: string;
};

export type SpooferResultPayload = {
  jobId?: string;
  success?: boolean;
  partial?: boolean;
  error?: string;
  output?: string;
  assetResults?: SpooferAssetResult[];
  results?: SpooferAssetResult[];
  replacements?: Record<string, string>;
  keyframe_warnings?: number;
};

export type SpooferStartedPayload = {
  jobId: string;
  job_id?: string;
  logFilePath?: string;
};

export type RoblosecurityUpdatedPayload = {
  oldCookie: string;
  newCookie: string;
};

export type MemoryPatchProgressPayload = {
  phase?: 'started' | 'scanning' | 'complete';
  regions_total?: number;
  regions_scanned?: number;
  chunks_total?: number;
  chunks_scanned?: number;
  bytes_scanned?: number;
  matches_found?: number;
  writes_completed?: number;
};

export type ScriptRefProgressPayload = {
  resolved?: number;
  total?: number;
};
