import { Accordion, AccordionItem, itemVariants, pageVariants, Window } from '@codycon/ism-library';
import { motion } from 'framer-motion';
import { ArrowDownUp, Key, ShieldAlert, Sliders } from 'lucide-react';

import { useConfig } from '../../contexts/ConfigContext';
import CredentialsSection from './config/CredentialsSection';
import ExclusionsSection from './config/ExclusionsSection';
import RoutingSection from './config/RoutingSection';
import UploadSection from './config/UploadSection';

export default function ConfigView() {
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
            expandedKeys={config.ui.configSections}
            onExpandedChange={(keys: string[]) => updateConfig('ui', 'configSections', keys)}
            className="flex flex-col gap-6"
          >
            <AccordionItem
              value="credentials"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Key size={18} className="text-primary" /> Credentials
                </span>
              }
            >
              <CredentialsSection />
            </AccordionItem>

            <AccordionItem
              value="assetProcessing"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <ArrowDownUp size={18} className="text-primary" /> Asset Processing
                </span>
              }
            >
              <UploadSection />
            </AccordionItem>

            <AccordionItem
              value="routing"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Sliders size={18} className="text-primary" /> Routing and Limits
                </span>
              }
            >
              <RoutingSection />
            </AccordionItem>

            <AccordionItem
              value="exclusions"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <ShieldAlert size={18} className="text-primary" /> Exclusions
                </span>
              }
            >
              <ExclusionsSection />
            </AccordionItem>
          </Accordion>
        </motion.div>
      </Window>
    </motion.div>
  );
}
