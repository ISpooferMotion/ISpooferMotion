import { Button } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { useDiscordLogin } from '../../hooks/useDiscordLogin';
import { type StoredDiscordAuth } from '../../types/discordAuth';

interface Props {
  onVerified: (auth: StoredDiscordAuth) => void;
}

export default function DiscordLoginScreen({ onVerified }: Props) {
  const [pendingAuth, setPendingAuth] = useState<StoredDiscordAuth | null>(null);

  const { loginState, errorMessage, startLogin, cancelLogin } = useDiscordLogin((auth) => {
    setPendingAuth(auth);
  });

  if (pendingAuth) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex flex-col items-center justify-center h-screen w-screen bg-bg-base text-text-primary p-8 font-sans antialiased relative z-50"
      >
        <div className="flex flex-col items-center gap-6 max-w-sm text-center">
          <div className="flex flex-col items-center gap-4">
            {pendingAuth.user?.avatarUrl ? (
              <img
                src={pendingAuth.user.avatarUrl}
                alt="Avatar"
                className="w-24 h-24 rounded-full border-4 border-bg-elevated shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-bg-elevated border-4 border-bg-elevated shadow-lg flex items-center justify-center text-3xl font-bold text-text-secondary">
                {(pendingAuth.user?.globalName || pendingAuth.user?.username || 'U')
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-2xl font-bold tracking-tight text-text-primary">
                {pendingAuth.user?.globalName || pendingAuth.user?.username || 'Unknown User'}
              </span>
              <span className="text-[15px] font-medium text-text-muted">Is this you?</span>
            </div>
          </div>

          <div className="flex flex-col gap-3 w-full mt-2">
            <Button
              color="primary"
              variant="solid"
              className="w-full font-semibold h-[42px]"
              onClick={() => onVerified(pendingAuth)}
            >
              Yes, continue
            </Button>
            <Button
              variant="bordered"
              color="danger"
              className="w-full h-[42px] border-border-subtle hover:border-red-500/50"
              onClick={async () => {
                await invoke('clear_discord_report_auth');
                setPendingAuth(null);
                cancelLogin();
              }}
            >
              No, switch account
            </Button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-screen w-screen bg-bg-base text-text-primary p-8 font-sans antialiased relative z-50"
    >
      <div className="flex flex-col items-center gap-6 max-w-sm text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="mb-2">
            <svg
              viewBox="0 0 127.14 96.36"
              xmlns="http://www.w3.org/2000/svg"
              className="w-16 h-16 text-[#5865F2]"
            >
              <path
                d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-19.32-72.1ZM42.63,65.22C36.14,65.22,30.8,59.3,30.8,52.05s5.15-13.17,11.83-13.17c6.74,0,12,5.92,11.83,13.17C54.46,59.3,49.27,65.22,42.63,65.22Zm41.88,0c-6.49,0-11.83-5.92-11.83-13.17s5.15-13.17,11.83-13.17c6.74,0,12,5.92,11.83,13.17C96.34,59.3,91.15,65.22,84.51,65.22Z"
                fill="currentColor"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary">Welcome</h1>
          <p className="text-[15px] text-text-muted leading-relaxed px-4">
            Connect your Discord account to continue. Your browser will open to authenticate.
          </p>
        </div>

        {loginState === 'waiting' ? (
          <div className="flex flex-col items-center gap-3 w-full mt-2">
            <div className="flex items-center justify-center gap-3 w-full h-[46px] bg-bg-elevated/50 rounded-[var(--radius-md)] border border-border-subtle text-[14px] font-medium text-text-secondary shadow-sm">
              <Loader2 size={18} className="animate-spin text-[#5865F2]" />
              Waiting for browser...
            </div>
            <button
              onClick={cancelLogin}
              className="text-[13px] text-text-muted hover:text-text-primary underline transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full mt-4">
            <Button
              className="w-full font-semibold h-[46px] text-[15px] border-none shadow-[0_0_20px_rgba(88,101,242,0.15)] transition-colors hover:bg-gray-100"
              style={{ backgroundColor: '#ffffff', color: '#000000' }}
              onClick={startLogin}
              disabled={loginState === 'opening'}
            >
              {loginState === 'opening' ? (
                <>
                  <Loader2 size={18} className="animate-spin mr-2" /> Opening browser...
                </>
              ) : (
                'Login with Discord'
              )}
            </Button>
            {loginState === 'error' && errorMessage && (
              <p className="text-[13px] text-red-400 mt-1">{errorMessage}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
