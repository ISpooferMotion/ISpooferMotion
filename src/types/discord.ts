export interface FeaturePollOption {
  id: string;
  label: string;
}

export interface FeaturePoll {
  id: string;
  guildId?: string;
  channelId?: string;
  title: string;
  description: string;
  options: FeaturePollOption[];
  allowMultiple: boolean;
  durationHours: number;
  open: boolean;
  createdAt: number;
  closedAt?: number;
  lastSyncedAt?: number;
  counts: Record<string, number>;
  totalVoters: number;
  appVoters: number;
  discordVoters: number;
  selected: string[];
}

export interface FeaturePollResponse {
  poll: FeaturePoll | null;
}
