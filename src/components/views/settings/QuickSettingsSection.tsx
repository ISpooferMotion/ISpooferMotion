import { FormToggle, Group } from '@codycon/ism-library';

import { useConfig } from '../../../contexts/ConfigContext';
import { AVAILABLE_QUICK_SETTINGS } from '../../layout/QuickSettingsMenu';

export default function QuickSettingsSection() {
  const { config, updateConfig } = useConfig();

  return (
    <Group>
      <div className="text-sm text-text-muted mb-3 font-medium px-5">
        Select which settings you want to appear in the Quick Settings menu located in the top bar.
      </div>
      <div className="flex flex-col gap-0 pb-2">
        {Object.entries(
          AVAILABLE_QUICK_SETTINGS.reduce(
            (acc, setting) => {
              const groupKey = `${setting.page} > ${setting.section}`;
              if (!acc[groupKey]) acc[groupKey] = [];
              acc[groupKey].push(setting);
              return acc;
            },
            {} as Record<string, typeof AVAILABLE_QUICK_SETTINGS>,
          ),
        ).map(([groupKey, settings]) => (
          <Group key={groupKey} title={groupKey} className="pt-2!">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {settings.map((setting) => (
                <FormToggle
                  key={setting.id}
                  label={setting.label}
                  checked={config.ui.quickSettings.includes(setting.id)}
                  onChange={(checked: boolean) => {
                    const newSettings = checked
                      ? [...config.ui.quickSettings, setting.id]
                      : config.ui.quickSettings.filter((id) => id !== setting.id);
                    updateConfig('ui', 'quickSettings', newSettings);
                  }}
                />
              ))}
            </div>
          </Group>
        ))}
      </div>
    </Group>
  );
}
