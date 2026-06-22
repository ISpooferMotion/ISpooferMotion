import { Accordion, AccordionItem, itemVariants, pageVariants, Window } from '@codycon/ism-library';
import { motion } from 'framer-motion';
import { Globe, Settings2, SlidersHorizontal, User2 } from 'lucide-react';

import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import AccountSection from './settings/AccountSection';
import DebugSection from './settings/DebugSection';
import GeneralSection from './settings/GeneralSection';
import QuickSettingsSection from './settings/QuickSettingsSection';

export default function SettingsView() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

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
          <Accordion
            selectionMode="multiple"
            expandedKeys={config.ui.settingsSections}
            onExpandedChange={(keys: string[]) => updateConfig('ui', 'settingsSections', keys)}
            className="flex flex-col gap-6"
          >
            <AccordionItem
              value="account"
              aria-label="Account"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <User2 size={18} className="text-primary" /> Account
                </span>
              }
            >
              <AccountSection />
            </AccordionItem>

            <AccordionItem
              value="general"
              aria-label={t('settings.general')}
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Globe size={18} className="text-primary" /> {t('settings.general')}
                </span>
              }
            >
              <GeneralSection />
            </AccordionItem>

            <AccordionItem
              value="quickSettings"
              aria-label="Quick Settings"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <SlidersHorizontal size={18} className="text-primary" /> Quick Settings
                </span>
              }
            >
              <QuickSettingsSection />
            </AccordionItem>

            <AccordionItem
              value="debug"
              aria-label="Debug & Display"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Settings2 size={18} className="text-primary" /> Debug & Display
                </span>
              }
            >
              <DebugSection />
            </AccordionItem>
          </Accordion>
        </motion.div>
      </Window>
    </motion.div>
  );
}
