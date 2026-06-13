import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@codycon/ism-library';
import { useQuery } from '@tanstack/react-query';
import { motion, Variants } from 'framer-motion';
import { Code, Heart, Rocket, X } from 'lucide-react';

export default function CreditsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data, isLoading: loading } = useQuery({
    queryKey: ['supporters'],
    queryFn: async () => {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const res = await tauriFetch('https://www.incredidev.com/api/supporters', { method: 'GET' });
      return (await res.json()) as { supporters?: string[]; boosters?: string[] };
    },
    staleTime: 5 * 60 * 1000,
  });

  const supporters = data?.supporters || [];
  const boosters = data?.boosters || [];

  const stagger: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 28 } },
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="lg">
      <ModalContent>
        <ModalHeader className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-base font-bold tracking-tight text-text-primary">ISpooferMotion</p>
            <p className="text-xs text-text-muted font-normal">
              A tool for spoofing Roblox game assets
            </p>
          </div>
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            className="-mr-1 text-text-muted hover:text-text-primary"
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </ModalHeader>

        <ModalBody>
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-6"
          >
            <motion.div
              variants={item}
              className="rounded-[var(--radius-lg)] bg-bg-elevated border border-border-subtle p-5 flex flex-col gap-5"
            >
              <p className="text-[10px] font-bold tracking-widest uppercase text-text-muted flex items-center gap-2">
                <Code size={12} /> Developers
              </p>

              {[
                {
                  avatar: 'https://github.com/IncrediDev.png',
                  name: '@IncredibroXP',
                  sub: 'aka @IncrediDev',
                  role: 'Main Developer',
                  roleColor: 'text-primary',
                },
                {
                  avatar: 'https://github.com/codycon.png',
                  name: '@codycon',
                  sub: '',
                  role: 'Contributor',
                  roleColor: 'text-text-secondary',
                },
              ].map((dev) => (
                <div key={dev.name} className="flex items-center gap-4">
                  <img
                    src={dev.avatar}
                    alt={dev.name}
                    className="w-11 h-11 rounded-full border border-border-subtle object-cover"
                  />

                  <div className="flex flex-col">
                    <span className="font-semibold text-sm text-text-primary tracking-tight">
                      {dev.name}{' '}
                      {dev.sub && (
                        <span className="font-normal text-text-muted text-xs">{dev.sub}</span>
                      )}
                    </span>
                    <span className={`text-xs font-medium ${dev.roleColor}`}>{dev.role}</span>
                  </div>
                </div>
              ))}
            </motion.div>

            <motion.div variants={item} className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-3">
                <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted flex items-center gap-2">
                  <Heart size={11} className="text-rose-500" /> Supporters
                </h3>
                {loading ? (
                  <div className="flex flex-col gap-2 mt-1">
                    {[75, 50].map((w) => (
                      <div
                        key={w}
                        className={`h-2 rounded-full bg-border-strong/40 animate-pulse`}
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                ) : supporters.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 text-[13px] font-medium text-text-primary">
                    {supporters.map((name, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-rose-400/70 shrink-0" />
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs italic text-text-muted">Be the first!</p>
                )}
              </div>

              <div className="flex flex-col gap-3 border-l border-border-subtle pl-4">
                <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted flex items-center gap-2">
                  <Rocket size={11} className="text-violet-500" /> Boosters
                </h3>
                {loading ? (
                  <div className="flex flex-col gap-2 mt-1">
                    {[65, 45].map((w) => (
                      <div
                        key={w}
                        className={`h-2 rounded-full bg-border-strong/40 animate-pulse`}
                        style={{ width: `${w}%` }}
                      />
                    ))}
                  </div>
                ) : boosters.length > 0 ? (
                  <ul className="flex flex-col gap-1.5 text-[13px] font-medium text-text-primary">
                    {boosters.map((name, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-violet-400/70 shrink-0" />
                        {name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs italic text-text-muted">Be the first!</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
