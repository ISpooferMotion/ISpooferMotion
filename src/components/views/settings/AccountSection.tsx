import { Button, Group } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useDiscordLogin } from '../../../hooks/useDiscordLogin';
import { type StoredDiscordAuth } from '../../../types/discordAuth';
import { logIsm } from '../../../utils/robloxProfiles';

export default function AccountSection() {
  const [discordAuth, setDiscordAuth] = useState<StoredDiscordAuth | null>(null);

  useEffect(() => {
    invoke<StoredDiscordAuth | null>('load_discord_report_auth')
      .then((auth) => setDiscordAuth(auth ?? null))
      .catch(() => {});
  }, []);

  const {
    loginState,
    errorMessage: loginError,
    startLogin,
    cancelLogin,
  } = useDiscordLogin((auth) => {
    setDiscordAuth(auth);
    logIsm('success', 'Account connected! Cloud themes will now sync.');
  });

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
                  {discordAuth.user?.globalName ||
                    discordAuth.user?.username ||
                    'Unknown User'}
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
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted leading-relaxed">
              Connect your ISM account to sync cloud themes. Your browser will open to
              authenticate.
            </p>
            {loginState === 'waiting' ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2 size={16} className="animate-spin text-primary" />
                  Waiting for browser authentication...
                </div>
                <button
                  onClick={cancelLogin}
                  className="text-xs text-text-muted hover:text-text-secondary underline self-start"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button
                  color="primary"
                  variant="solid"
                  className="font-semibold"
                  onClick={startLogin}
                  disabled={loginState === 'opening'}
                >
                  {loginState === 'opening' ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Opening browser...
                    </>
                  ) : (
                    'Connect Account'
                  )}
                </Button>
                {loginState === 'error' && loginError && (
                  <p className="text-xs text-red-400 px-1">{loginError}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Group>
  );
}
