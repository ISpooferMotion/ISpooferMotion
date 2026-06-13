import { StatusPill } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import type { DiscordUser, StoredDiscordAuth } from '../../types/discordAuth';

export default function StatusBar() {
  const [discordUser, setDiscordUser] = useState<DiscordUser | null>(null);
  const { studioConnected } = useStudioConnectionState();

  useEffect(() => {
    invoke<StoredDiscordAuth | null>('load_discord_report_auth')
      .then((auth) => {
        if (auth?.user) setDiscordUser(auth.user);
      })
      .catch(() => {});
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4, ease: 'easeOut' }}
      className="h-8 w-full bg-transparent border-t border-border-subtle flex items-center justify-between px-4 shrink-0 z-50 select-none"
    >
      <div className="flex items-center gap-2">
        {discordUser && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-text-muted select-none uppercase tracking-wide">
              Logged in as:
            </span>
            <div className="flex items-center gap-1.5">
              {discordUser.avatarUrl ? (
                <img
                  src={discordUser.avatarUrl}
                  alt=""
                  className="w-4 h-4 rounded-full object-cover border border-border-subtle select-none pointer-events-none"
                  draggable={false}
                />
              ) : (
                <div className="w-4 h-4 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-[8px] font-bold text-text-secondary select-none">
                  {(discordUser.globalName || discordUser.username).charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-[11px] font-semibold text-text-secondary select-none">
                {discordUser.globalName || discordUser.username}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <StatusPill
          label={studioConnected ? 'Synced to Studio' : 'Not Synced to Studio'}
          tone={studioConnected ? 'primary' : 'neutral'}
          dot={false}
          className={`!border-transparent !bg-transparent !px-0 ${
            studioConnected ? '' : '!text-text-muted opacity-50'
          }`}
        />
      </div>
    </motion.div>
  );
}
