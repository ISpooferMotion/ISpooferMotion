import { Button, Group } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

import { type StoredDiscordAuth } from '../../../types/discordAuth';
import { logIsm } from '../../../utils/robloxProfiles';

export default function AccountSection() {
  const [discordAuth, setDiscordAuth] = useState<StoredDiscordAuth | null>(null);

  useEffect(() => {
    invoke<StoredDiscordAuth | null>('load_discord_report_auth')
      .then((auth) => setDiscordAuth(auth ?? null))
      .catch(() => {});
  }, []);

  return (
    <Group>
      <div className="flex flex-col gap-4 px-1 pb-1">
        {discordAuth?.user ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {discordAuth.user?.avatarUrl ? (
                <img
                  src={discordAuth.user.avatarUrl}
                  alt="Avatar"
                  className="w-9 h-9 rounded-full border border-border-subtle"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-sm font-bold text-text-secondary">
                  {(discordAuth.user?.globalName || discordAuth.user?.username || 'U')
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-text-primary">
                  {discordAuth.user?.globalName || discordAuth.user?.username || 'Unknown User'}
                </span>
                <span className="text-xs text-text-muted">
                  Connected · Cloud themes sync enabled
                </span>
              </div>
            </div>
            <Button
              variant="bordered"
              color="danger"
              className="text-xs font-medium shrink-0"
              onClick={async () => {
                await invoke('clear_discord_report_auth');
                setDiscordAuth(null);
                logIsm('info', 'Account disconnected.');
                window.dispatchEvent(new Event('discord-disconnected'));
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted leading-relaxed">
              You are not connected. Please restart the app to log in.
            </p>
          </div>
        )}
      </div>
    </Group>
  );
}
