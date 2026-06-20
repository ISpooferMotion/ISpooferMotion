import { FormInput, Group, Row } from '@codycon/ism-library';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';

export default function ExclusionsSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();

  return (
    <Group>
      <Row>
        <FormInput
          label={t('settings.excludedUsers')}
          placeholder={t('settings.excludedUsersPlaceholder')}
          value={config.advanced.excludedUserIds}
          onChange={(value: string) => updateConfig('advanced', 'excludedUserIds', value)}
        />

        <FormInput
          label={t('settings.excludedGroups')}
          placeholder={t('settings.excludedGroupsPlaceholder')}
          value={config.advanced.excludedGroupIds}
          onChange={(value: string) => updateConfig('advanced', 'excludedGroupIds', value)}
        />
      </Row>
    </Group>
  );
}
