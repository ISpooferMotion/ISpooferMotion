import { Button, Modal, ModalBody, ModalContent, ModalHeader } from '@codycon/ism-library';
import { motion, Variants } from 'framer-motion';
import { ArrowRight, Check, Copy, ListChecks, X } from 'lucide-react';
import { useState } from 'react';

import { useSpooferStore } from '../../stores/spooferStore';

export default function ResultsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { lastReplacements } = useSpooferStore();
  const [copied, setCopied] = useState(false);

  const replacementsArray = Object.entries(lastReplacements);

  const handleCopyAll = () => {
    const text = replacementsArray.map(([oldId, newId]) => `${oldId} -> ${newId}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const stagger: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.05 } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 10 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', stiffness: 400, damping: 28 },
    },
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} size="xl">
      <ModalContent>
        <ModalHeader className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <ListChecks className="text-primary" /> Spoofing Results
            </h2>
            <p className="text-sm font-medium text-text-secondary">
              {replacementsArray.length} asset IDs were spoofed.
            </p>
          </div>
          <Button
            variant="ghost"
            isIconOnly
            className="text-text-secondary hover:text-text-primary"
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </ModalHeader>
        <ModalBody className="pb-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary">Asset ID Mappings</span>
              {replacementsArray.length > 0 && (
                <Button size="sm" variant="flat" onClick={handleCopyAll} className="gap-2">
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                  {copied ? 'Copied!' : 'Copy All'}
                </Button>
              )}
            </div>

            {replacementsArray.length > 0 ? (
              <motion.div
                variants={stagger}
                initial="hidden"
                animate="show"
                className="flex flex-col gap-2 max-h-100 overflow-y-auto pr-2"
              >
                {replacementsArray.map(([oldId, newId]) => (
                  <motion.div
                    key={oldId}
                    variants={item}
                    className="flex items-center justify-between p-3 rounded-md bg-bg-surface border border-border-strong"
                  >
                    <div className="flex flex-col">
                      <span className="text-xs text-text-secondary font-medium">Original ID</span>
                      <span className="text-sm font-mono font-semibold text-danger">{oldId}</span>
                    </div>
                    <ArrowRight size={16} className="text-text-secondary opacity-50" />
                    <div className="flex flex-col text-right">
                      <span className="text-xs text-text-secondary font-medium">Spoofed ID</span>
                      <span className="text-sm font-mono font-semibold text-success">{newId}</span>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <div className="p-8 text-center text-text-secondary bg-bg-surface rounded-lg border border-border-strong border-dashed">
                No successful replacements to display.
              </div>
            )}

            <div className="rounded-md border border-primary/20 bg-primary/10 px-4 py-3 mt-2">
              <p className="text-sm font-medium text-text-primary">
                If the plugin or memory injection is active, these IDs have already been replaced in
                your Roblox Studio automatically!
              </p>
            </div>
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
