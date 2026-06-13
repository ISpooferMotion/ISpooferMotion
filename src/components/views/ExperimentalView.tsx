import {
  Accordion,
  AccordionItem,
  FormToggle,
  Group,
  itemVariants,
  pageVariants,
  Row,
  Window,
} from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { Cpu, LayoutTemplate } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../contexts/ConfigContext';
import { type StoredDiscordAuth } from '../../types/discordAuth';
import { isMemoryInjectionSupported } from '../../utils/tauriRuntime';

export default function ExperimentalView() {
  const { config, updateConfig } = useConfig();
  const [hasDevAccess, setHasDevAccess] = useState(false);
  const [memoryInjectionSupported, setMemoryInjectionSupported] = useState(false);

  useEffect(() => {
    isMemoryInjectionSupported().then(setMemoryInjectionSupported);
  }, []);

  useEffect(() => {
    const fetchDiscordState = async () => {
      try {
        const auth = await invoke<StoredDiscordAuth | null>('load_discord_report_auth');
        setHasDevAccess(Boolean(auth?.user?.hasDevAccess));
      } catch (e) {}
    };
    void fetchDiscordState();
  }, []);

  return (
    <motion.div
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className="w-full h-full"
    >
      <Window>
        <div className="flex flex-col w-full h-full p-8 pb-32 overflow-y-auto custom-scrollbar">
          <motion.div variants={itemVariants} className="w-full flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-bold text-primary tracking-tight">
                Experimental Features
              </h1>
              <p className="text-sm text-text-muted font-medium leading-relaxed">
                The features listed here are in active development, unstable, and may be removed in
                the future.
              </p>
            </div>

            <Accordion
              selectionMode="multiple"
              defaultExpandedKeys={['appFeatures', 'spooferFeatures']}
              className="flex flex-col gap-6"
            >
              <AccordionItem
                value="appFeatures"
                aria-label="App Features"
                title={
                  <span className="flex items-center gap-3 font-semibold">
                    <LayoutTemplate size={18} className="text-primary" /> App Features
                  </span>
                }
              >
                <Group>
                  <Row>
                    <FormToggle
                      label="Auto Scroll Sections"
                      checked={config.ui.autoScrollSections}
                      onChange={(v) => updateConfig('ui', 'autoScrollSections', v)}
                    />
                  </Row>
                </Group>
              </AccordionItem>

              <AccordionItem
                value="spooferFeatures"
                aria-label="Spoofer Features"
                title={
                  <span className="flex items-center gap-3 font-semibold">
                    <Cpu size={18} className="text-primary" /> Spoofer Features
                  </span>
                }
              >
                <Group>
                  <Row>
                    <FormToggle
                      label="Clipboard Monitoring"
                      description="Silently monitor your clipboard for Roblox asset URLs and auto-queue them for spoofing."
                      checked={config.advanced.clipboardMonitoring}
                      onChange={(v) => updateConfig('advanced', 'clipboardMonitoring', v)}
                    />
                  </Row>
                  <Row>
                    <FormToggle
                      label="Spoof Plugins"
                      description="[WIP] Attempt to spoof plugin assets."
                      checked={config.advanced.enablePluginSpoofing}
                      onChange={(v) => updateConfig('advanced', 'enablePluginSpoofing', v)}
                    />
                  </Row>
                  <Row>
                    <FormToggle
                      label="Memory Injection"
                      description={
                        memoryInjectionSupported
                          ? '[DANGEROUS] Windows only. Overwrites exact numeric asset IDs in Studio memory (same digit length). Run with the same elevation as Studio. Plugin bridge is used for other cases.'
                          : 'Memory injection is only available on Windows. Use the plugin bridge on this platform.'
                      }
                      checked={
                        memoryInjectionSupported ? config.advanced.memoryInjectionEnabled : false
                      }
                      onChange={(v) => {
                        if (!hasDevAccess || !memoryInjectionSupported) return;
                        updateConfig('advanced', 'memoryInjectionEnabled', v);
                      }}
                    />
                  </Row>
                </Group>
              </AccordionItem>
            </Accordion>
          </motion.div>
        </div>
      </Window>
    </motion.div>
  );
}
