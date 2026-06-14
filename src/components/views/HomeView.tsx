import {
  Accordion,
  AccordionItem,
  Button,
  itemVariants,
  pageVariants,
  Section,
  Spinner,
  Window,
} from '@codycon/ism-library';
import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, Book, History, LifeBuoy } from 'lucide-react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import PollWidget from '../features/discord/PollWidget';

const DiscordIcon = ({ size = 20, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 127.14 96.36"
    fill="currentColor"
    className={className}
  >
    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77.7,77.7,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14h0C127.86,52.43,122.1,28.61,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.31,60,73.31,53s5-12.74,11.43-12.74S96.3,46,96.19,53,91.08,65.69,84.69,65.69Z" />
  </svg>
);

const YoutubeIcon = ({ size = 20, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const GithubIcon = ({ size = 20, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const renderDiscordContent = (
  text: string,
  attachments: { contentType?: string; url?: string }[] = [],
) => {
  let youtubeUrl = '';
  const ytRegex =
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = text.match(ytRegex);
  if (ytMatch) {
    youtubeUrl = ytMatch[1];
  }

  const emojiRegex = /<a?:([a-zA-Z0-9_]+):(\d+)>/g;
  const parts = text.split(emojiRegex);

  const elements: React.ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    elements.push(<span key={`text-${i}`}>{parts[i]}</span>);
    if (i + 1 < parts.length && i + 2 < parts.length) {
      const name = parts[i + 1];
      const id = parts[i + 2];
      elements.push(
        <img
          key={`emoji-${id}-${i}`}
          src={`https://cdn.discordapp.com/emojis/${id}.webp?size=44&quality=lossless`}
          alt={name}
          title={`:${name}:`}
          className="w-5 h-5 inline-block align-middle mx-0.5"
        />,
      );
    }
  }

  return (
    <>
      <div className="whitespace-pre-wrap break-words">{elements}</div>
      {youtubeUrl && (
        <div className="mt-3 rounded-lg overflow-hidden border border-border-subtle w-full aspect-video">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${youtubeUrl}?rel=0`}
            className="w-full h-full"
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            title="YouTube video player"
            frameBorder="0"
          />
        </div>
      )}
      {attachments.length > 0 &&
        attachments.map((att, idx) =>
          att.contentType?.startsWith('image/') ? (
            <img
              key={`att-${idx}`}
              src={att.url}
              className="mt-3 rounded-lg border border-border-subtle w-full max-h-80 object-contain bg-black/10"
              alt="Attachment"
            />
          ) : att.contentType?.startsWith('video/') ? (
            <video
              key={`att-${idx}`}
              src={att.url}
              controls
              className="mt-3 rounded-lg border border-border-subtle w-full aspect-video bg-black/10"
            />
          ) : null,
        )}
    </>
  );
};

export default function HomeView() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const { data: announcement, isLoading: loadingAnnouncement } = useQuery({
    queryKey: ['discord-announcements'],
    queryFn: async () => {
      if (!isTauriRuntime()) return null;
      const res = await invoke<{ data?: any }>('fetch_discord_announcements');
      return res?.data || null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: releasesData, isLoading: loading } = useQuery({
    queryKey: ['github-releases'],
    queryFn: async () => {
      const res = await fetch(
        'https://api.github.com/repos/ISpooferMotion/ISpooferMotion-V2/releases',
        {
          headers: { Accept: 'application/vnd.github+json' },
        },
      );
      if (!res.ok) throw new Error(`GitHub releases request failed: ${res.status}`);
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? data.slice(0, 3) : [];
    },
    enabled: isTauriRuntime(),
    staleTime: 5 * 60 * 1000,
  });

  const releases = releasesData || [];

  const parseChangelog = (body: string) => {
    if (!body) return null;
    const lines = body.split('\n');
    return lines
      .map((line) => line.trim())
      .map((line) => line.replace(/^#+\s*/g, ''))
      .map((line) => line.replace(/\*\*/g, ''))
      .filter((line) => !line.includes('| --- |') && !line.includes('|---|'))
      .filter(
        (line) =>
          !line.toLowerCase().includes('virus total') && !line.toLowerCase().includes('virustotal'),
      )
      .filter((line) => !line.startsWith('ISpooferMotion v'))
      .filter((line) => line.length > 0)
      .map((text, i) => {
        if (text.startsWith('- ') || text.startsWith('* ')) {
          return (
            <li key={i} className="ml-4 list-disc text-text-secondary text-sm py-0.5">
              {text.substring(2).trim()}
            </li>
          );
        }
        if (text.includes(':')) {
          const [title, ...rest] = text.split(':');
          return (
            <p key={i} className="text-text-primary text-sm mt-3 mb-1">
              <span className="font-bold text-primary">{title}:</span> {rest.join(':')}
            </p>
          );
        }
        return (
          <p key={i} className="text-text-secondary font-medium text-sm mt-2">
            {text}
          </p>
        );
      });
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full"
    >
      <Window>
        <motion.div variants={itemVariants} className="w-full flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-primary tracking-tight">{t('home.title')}</h1>
            <p className="text-sm text-text-muted font-medium">{t('home.subtitle')}</p>
          </div>

          <div className="grid gap-8 w-full">
            <Section
              title={t('home.helpTitle')}
              description={t('home.helpBody')}
              icon={
                <span className="text-primary">
                  <LifeBuoy size={18} />
                </span>
              }
            >
              <div className="p-6 flex flex-row gap-3 flex-wrap items-center">
                <Button
                  variant="flat"
                  className="font-medium min-w-[140px] flex-1 hover:!text-white hover:!bg-[#5865F2]"
                  onClick={() => open('https://discord.gg/gySZcrm686')}
                >
                  <DiscordIcon size={18} />
                  {t('home.discordBtn')}
                </Button>

                <Button
                  variant="flat"
                  className="font-medium min-w-[140px] flex-1 hover:!text-white hover:!bg-[#FF0000]"
                  onClick={() => open('https://www.youtube.com/watch?v=K4iY_8IXE_Q')}
                >
                  <YoutubeIcon size={18} />
                  {t('home.tutorial')}
                </Button>

                <Button
                  variant="flat"
                  className="font-medium min-w-[140px] flex-1 hover:!text-white hover:!bg-blue-500"
                  onClick={() => open('https://www.incredidev.com/ism/wiki/v2')}
                >
                  <Book size={18} />
                  {t('home.wiki')}
                </Button>

                <Button
                  variant="flat"
                  className="font-medium min-w-[140px] flex-1 hover:!text-white hover:!bg-[#333]"
                  onClick={() => open('https://github.com/ISpooferMotion/ISpooferMotion-V2')}
                >
                  <GithubIcon size={18} />
                  {t('home.github')}
                </Button>
              </div>
            </Section>

            <PollWidget />

            <div className="flex flex-col gap-4 w-full">
              <div className="flex flex-col gap-1 mb-1">
                <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
                  <span className="text-primary">
                    <Bell size={18} />
                  </span>
                  Recent Announcements
                </h2>
              </div>
              <div className="w-full">
                <AnimatePresence mode="wait">
                  {loadingAnnouncement ? (
                    <motion.div
                      key="loading-announcement"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-2 text-text-muted p-6 border border-border-subtle rounded-[var(--radius-lg)] bg-bg-surface"
                    >
                      <Spinner size="sm" color="current" />
                      <span className="text-sm">Fetching announcements...</span>
                    </motion.div>
                  ) : announcement ? (
                    <motion.div
                      key="announcement"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="flex flex-col gap-3 p-4 border border-border-subtle rounded-[var(--radius-lg)] bg-bg-surface"
                    >
                      <div className="flex items-center gap-3">
                        {announcement.author.avatar ? (
                          <img
                            src={announcement.author.avatar}
                            alt="Author"
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-bg-elevated flex items-center justify-center shrink-0">
                            <DiscordIcon size={16} className="text-text-muted" />
                          </div>
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-text-primary truncate">
                            {announcement.author.username}
                          </span>
                          <span className="text-[11px] text-text-muted">
                            {new Date(announcement.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
                        {renderDiscordContent(announcement.content, announcement.attachments)}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="no-announcement"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-center p-6 border border-border-subtle rounded-[var(--radius-lg)] bg-bg-surface"
                    >
                      <span className="text-sm text-text-muted">No recent announcements.</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="flex flex-col gap-4 w-full">
              <div className="flex flex-col gap-1 mb-1">
                <h2 className="text-base font-semibold text-text-primary flex items-center gap-2">
                  <span className="text-primary">
                    <History size={18} />
                  </span>
                  {t('home.recentUpdates')}
                </h2>
              </div>
              <div className="w-full">
                <AnimatePresence mode="wait">
                  {loading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-2 text-text-muted p-6 border border-border-subtle rounded-[var(--radius-lg)] bg-bg-surface"
                    >
                      <Spinner size="sm" color="current" />
                      <span className="text-sm">{t('home.fetchingChangelogs')}</span>
                    </motion.div>
                  ) : releases.length > 0 ? (
                    <motion.div
                      key="content"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <Accordion
                        className="flex flex-col gap-2"
                        expandedKeys={config.ui.homeUpdateSections}
                        onExpandedChange={(keys: any) =>
                          updateConfig('ui', 'homeUpdateSections', keys)
                        }
                      >
                        {releases.map((release, index) => (
                          <AccordionItem
                            key={index.toString()}
                            value={index.toString()}
                            title={<span className="font-bold text-primary">{release.name}</span>}
                            subtitle={
                              <span className="text-text-muted font-mono">
                                {new Date(release.published_at).toLocaleDateString()}
                              </span>
                            }
                          >
                            <div className="flex flex-col">{parseChangelog(release.body)}</div>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                      className="text-sm text-text-muted p-6 border border-border-subtle rounded-[var(--radius-lg)] bg-bg-surface"
                    >
                      {t('home.noUpdates')}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      </Window>
    </motion.div>
  );
}
