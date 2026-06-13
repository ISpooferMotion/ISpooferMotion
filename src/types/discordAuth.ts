export type DiscordUser = {
  id: string;
  username: string;
  globalName?: string | null;
  avatarUrl?: string | null;
  topRole?: {
    name: string;
    color: string | null;
  } | null;
  premiumType?: number | null;
  hasDevAccess?: boolean;
};

export type StoredDiscordAuth = {
  loginToken: string;
  user?: DiscordUser | null;
};
