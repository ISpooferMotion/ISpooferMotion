import { Button, FormToggle, Group, Row } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, Trash2 } from 'lucide-react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { logIsm } from '../../../utils/robloxProfiles';

export default function DebugSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  async function handleClearCache(successMessage = 'Cache cleared.') {
    try {
      await Promise.all([
        invoke('clear_asset_cache'),
        invoke('clear_plugin_cache'),
        invoke('clear_app_cache'),
      ]);

      Object.keys(localStorage).forEach((key) => {
        if (
          key.startsWith('ISpooferMotion_DetectedGroups_') ||
          key === 'ISpooferMotion_AssetExplorerState'
        ) {
          localStorage.removeItem(key);
        }
      });
      sessionStorage.clear();
      logIsm('success', successMessage);
    } catch (err) {
      logIsm('error', `Failed to clear cache: ${String(err)}`);
    }
  }

  const handleCacheChange = async (enabled: boolean) => {
    updateConfig('debug', 'enableCache', enabled);
    if (enabled) {
      logIsm('success', 'Cache enabled.');
      return;
    }
    await handleClearCache('Cache disabled. Cached runtime data cleared.');
  };

  return (
    <Group>
      <Row>
        <FormToggle
          label={t('settings.debugMode')}
          checked={config.debug.debugMode}
          onChange={(v: boolean) => updateConfig('debug', 'debugMode', v)}
        />

        <FormToggle
          label={t('settings.enableCache')}
          checked={config.debug.enableCache}
          onChange={handleCacheChange}
        />
      </Row>
      <Row>
        <FormToggle
          label="Enable Experimental Tab"
          checked={config.debug.enableExperimentalTab}
          onChange={(v: boolean) => updateConfig('debug', 'enableExperimentalTab', v)}
        />
      </Row>
      <div className="mt-2 w-full flex gap-2">
        <Button
          label={t('settings.clearCache')}
          variant="bordered"
          fullWidth={true}
          startContent={<Trash2 size={16} />}
          onClick={() => void handleClearCache()}
        />

        <Button
          label="Open Logs Folder"
          variant="bordered"
          fullWidth={true}
          startContent={<FolderOpen size={16} />}
          onClick={() =>
            invoke('open_logs_folder').catch((err) =>
              logIsm('error', `Failed to open logs folder: ${String(err)}`),
            )
          }
        />
      </div>
    </Group>
  );
}
