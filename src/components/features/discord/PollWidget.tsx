import { Button } from '@codycon/ism-library';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';

import { FeaturePollResponse } from '../../../types/discord';
import { isTauriRuntime } from '../../../utils/tauriRuntime';

export default function PollWidget() {
  const { data } = useQuery({
    queryKey: ['discord-poll'],
    queryFn: async (): Promise<FeaturePollResponse | null> => {
      if (!isTauriRuntime()) return null;
      try {
        return await invoke<FeaturePollResponse>('fetch_discord_poll');
      } catch (err) {
        return null;
      }
    },
    refetchInterval: 10000,
  });

  const poll = data?.poll;

  if (!poll || !poll.open) {
    return null;
  }

  const highestCount = Math.max(...Object.values(poll.counts), 1);

  const handleVoteOnDiscord = () => {
    if (poll.guildId && poll.channelId && poll.id) {
      open(`discord://-/channels/${poll.guildId}/${poll.channelId}/${poll.id}`).catch(() => {
        open(`https://discord.com/channels/${poll.guildId}/${poll.channelId}/${poll.id}`);
      });
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full mb-6">
      <div className="flex flex-col gap-1 mb-1">
        <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
          <span className="text-primary">
            <BarChart3 size={18} />
          </span>
          Active Community Poll
        </h2>
      </div>
      <div className="flex flex-col p-5 border border-border-subtle rounded-(--radius-lg) bg-bg-surface relative overflow-hidden">
        <div className="flex flex-col gap-2 mb-5 relative z-10">
          <h3 className="text-lg font-bold text-text-primary leading-tight">{poll.title}</h3>
          {poll.description && (
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{poll.description}</p>
          )}
          <span className="text-xs text-text-muted mt-1 font-medium flex items-center gap-1.5">
            {poll.allowMultiple ? 'Multiple selections allowed' : 'Select one option'}
            <span className="opacity-50">•</span>
            {poll.totalVoters} {poll.totalVoters === 1 ? 'vote' : 'votes'}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 relative z-10 mb-4">
          {poll.options.map((option) => {
            const count = poll.counts[option.id] || 0;
            const percentage =
              poll.totalVoters > 0 ? Math.round((count / poll.totalVoters) * 100) : 0;
            const fillWidth = highestCount > 0 ? (count / highestCount) * 100 : 0;

            return (
              <div
                key={option.id}
                className="group relative flex items-center justify-between w-full p-3.5 rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden"
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${fillWidth}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="absolute left-0 top-0 bottom-0 opacity-15 pointer-events-none bg-text-muted"
                />

                <div className="flex items-center gap-3 relative z-10 font-medium">
                  <span className="text-sm text-text-primary">{option.label}</span>
                </div>

                <div className="flex items-center gap-2 relative z-10">
                  <span className="text-xs font-semibold text-text-secondary">{percentage}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end relative z-10 pt-2 border-t border-border-subtle">
          <Button
            variant="solid"
            onClick={handleVoteOnDiscord}
            className="w-full sm:w-auto"
            startContent={<BarChart3 size={16} />}
          >
            Vote on Discord
          </Button>
        </div>
      </div>
    </div>
  );
}
