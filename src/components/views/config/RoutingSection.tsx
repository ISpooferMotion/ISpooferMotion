import { Button, FormInput, FormToggle, Group, Row } from '@codycon/ism-library';
import { motion } from 'framer-motion';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { reopenPluginPairing } from '../../../utils/pluginBridge';
import { logIsm } from '../../../utils/robloxProfiles';
import PlaceIdSelector from '../../PlaceIdSelector';

export default function RoutingSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <Group>
      <div className="flex items-start gap-6 w-full">
        <div className="w-1/3 shrink-0">
          <FormInput
            label={t('settings.pluginPort')}
            type="number"
            value={config.advanced.pluginPort}
            onChange={(value: string) => updateConfig('advanced', 'pluginPort', value)}
          />
        </div>

        <div className="flex-1 min-w-0">
          <PlaceIdSelector
            label={t('settings.forcePlaceIds')}
            placeholder={t('settings.forcePlaceIdsPlaceholder')}
            value={config.advanced.forcePlaceIds}
            onChange={(value: string) => updateConfig('advanced', 'forcePlaceIds', value)}
          />
        </div>
      </div>
      <Row>
        <FormInput
          label={t('settings.searchLimit')}
          type="number"
          value={config.advanced.placeIdSearchLimit}
          onChange={(value: string) => updateConfig('advanced', 'placeIdSearchLimit', value)}
        />

        <FormInput
          label={t('settings.assetScanTimeout')}
          type="number"
          value={config.advanced.assetScanTimeout}
          onChange={(value: string) => updateConfig('advanced', 'assetScanTimeout', value)}
        />
      </Row>
      <Row>
        <FormInput
          label="Proxy URL"
          placeholder="http://user:pass@proxy:port"
          value={config.advanced.proxyUrl}
          onChange={(value: string) => updateConfig('advanced', 'proxyUrl', value)}
        />
      </Row>
      <div className="flex flex-col">
        <Row>
          <FormToggle
            label="Enable Concurrent Spoofing"
            description="Process multiple assets simultaneously to drastically speed up large spoof jobs."
            checked={config.advanced.concurrentSpoofing}
            onChange={(value: boolean) => updateConfig('advanced', 'concurrentSpoofing', value)}
          />
        </Row>
        <motion.div
          initial={false}
          animate={{
            gridTemplateRows: config.advanced.concurrentSpoofing ? '1fr' : '0fr',
            opacity: config.advanced.concurrentSpoofing ? 1 : 0,
          }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="grid overflow-hidden"
          aria-hidden={!config.advanced.concurrentSpoofing}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-3">
              <Row>
                <FormInput
                  label="Max Concurrency"
                  type="number"
                  value={config.advanced.maxConcurrency.toString()}
                  onChange={(value: string) =>
                    updateConfig('advanced', 'maxConcurrency', parseInt(value, 10) || 100)
                  }
                />
              </Row>
            </div>
          </div>
        </motion.div>
      </div>
      <div className="pt-2">
        <Button
          type="button"
          color="primary"
          className="w-full font-bold h-12 tracking-wide overflow-hidden relative"
          aria-label={t('settings.rePairPlugin')}
          onClick={() => {
            void reopenPluginPairing().then(() =>
              logIsm('info', 'Studio plugin pairing reopened. Reconnect in Studio.'),
            );
          }}
        >
          {t('settings.rePairPlugin')}
        </Button>
      </div>
    </Group>
  );
}
