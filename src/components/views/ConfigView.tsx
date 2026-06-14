import {
  Accordion,
  AccordionItem,
  Button,
  FormDropdown,
  FormInput,
  FormToggle,
  Group,
  itemVariants,
  MultiSelectDropdown,
  pageVariants,
  Row,
  Window,
} from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownUp,
  ExternalLink,
  FolderSearch,
  Key,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import AnimationIcon from '../../assets/roblox_icons/Animation.png';
import DecalIcon from '../../assets/roblox_icons/Decal.png';
import MeshIcon from '../../assets/roblox_icons/MeshPart.png';
import ScriptIcon from '../../assets/roblox_icons/Script.png';
import SoundIcon from '../../assets/roblox_icons/Sound.png';
import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { reopenPluginPairing } from '../../utils/pluginBridge';
import {
  detectCookie,
  logIsm,
  mergeCachedUser,
  validateCookieProfile,
} from '../../utils/robloxProfiles';

type AuthStatus = 'idle' | 'loading' | 'success' | 'error';
type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

export default function ConfigView() {
  const { t } = useLanguage();
  const { config, updateConfig, updateCategory } = useConfig();
  const [manualCookieEdit, setManualCookieEdit] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [apiKeyStatus, setApiKeyStatus] = useState<AuthStatus>('idle');
  const autoDetectEnabled = config.advanced.autoCookieStudio || config.advanced.autoCookieBrowser;
  const cookieReadOnly = autoDetectEnabled && !manualCookieEdit;

  const uploadOptions = [
    { value: 'animation', assetType: 'animation', label: 'Animations', icon: AnimationIcon },
    { value: 'audio', assetType: 'audio', label: 'Audio', icon: SoundIcon },
    { value: 'image', assetType: 'image', label: 'Images', icon: DecalIcon },
    { value: 'mesh', assetType: 'mesh', label: 'Meshes', icon: MeshIcon },
    { value: 'script_ref', assetType: 'script_ref', label: 'Script Refs', icon: ScriptIcon },
  ];

  const getCookieDetectionMode = () => {
    if (config.advanced.autoCookieStudio) return 'studio';
    if (config.advanced.autoCookieBrowser) return 'browser';
    return 'none';
  };

  const applyValidatedCookie = (result: Awaited<ReturnType<typeof validateCookieProfile>>) => {
    mergeCachedUser(result.user);
    updateCategory('spoofing', {
      cookie: result.cookie,
      selectedUser: String(result.user.id),
      selectedGroup: 'none',
    });
    setAuthStatus('success');
    logIsm('info', 'Cookie validated for the selected profile.');
  };

  const runAutoDetect = async (mode: string) => {
    if (mode === 'none') return;
    setAuthStatus('loading');
    logIsm('info', `Auto detecting Roblox cookie from ${mode}.`);
    try {
      const detected = await detectCookie(
        mode as 'studio' | 'browser',
        config.spoofing.selectedUser === 'none' ? null : config.spoofing.selectedUser,
      );
      if (!detected) {
        setAuthStatus('idle');
        logIsm('info', 'No Roblox cookie was found.');
        return;
      }
      const result = await validateCookieProfile(detected);
      applyValidatedCookie(result);
    } catch {
      setAuthStatus('idle');
      logIsm('warn', 'Auto-detected cookie was invalid or expired.');
    }
  };

  const handleCookieDetectionChange = (val: string) => {
    updateCategory('advanced', {
      autoCookieStudio: val === 'studio',
      autoCookieBrowser: val === 'browser',
    });
    setManualCookieEdit(false);
    if (val !== 'none') {
      runAutoDetect(val);
    }
  };

  useEffect(() => {
    const cookie = config.spoofing.cookie.trim();
    if (cookieReadOnly) return;

    if (!cookie || cookie.length < 50) return;
    const timer = window.setTimeout(async () => {
      try {
        const result = await validateCookieProfile(cookie);
        applyValidatedCookie(result);
      } catch {
        setAuthStatus('idle');
        logIsm('warn', 'The manually entered Roblox cookie could not be validated.');
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [config.spoofing.cookie, cookieReadOnly]);

  const handleBrowseFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (selected && typeof selected === 'string') {
      updateConfig('spoofing', 'downloadPath', selected);
    }
  };

  const handleValidateApiKey = async () => {
    const key = config.spoofing.apiKey.trim();
    if (key.length < 20) {
      setApiKeyStatus('error');
      logIsm('warn', 'Paste an Open Cloud API key before validating.', true);
      return;
    }

    setApiKeyStatus('loading');
    try {
      const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
        key,
      });
      const message = result.message || 'No validation details returned.';
      if (result.ok) {
        setApiKeyStatus('success');
        logIsm('success', message, true);
      } else if (/invalid|unauthorized/i.test(message)) {
        setApiKeyStatus('error');
        logIsm('warn', message, true);
      } else {
        setApiKeyStatus('idle');
        logIsm('warn', `Could not fully verify the Open Cloud API key: ${message}`, true);
      }
    } catch (error) {
      setApiKeyStatus('error');
      logIsm('warn', `Open Cloud API key validation failed: ${String(error)}`, true);
    }
  };

  const handleOpenApiDashboard = async () => {
    await invoke('open_external', {
      url: 'https://create.roblox.com/dashboard/credentials?activeTab=ApiKeys',
    }).catch(() => null);
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
          <Accordion
            selectionMode="multiple"
            expandedKeys={config.ui.configSections}
            onExpandedChange={(keys: any) => updateConfig('ui', 'configSections', keys)}
            className="flex flex-col gap-6"
          >
            <AccordionItem
              value="credentials"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Key size={18} className="text-primary" /> Credentials
                  <AnimatePresence>
                    {authStatus === 'loading' && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center"
                      >
                        <Loader2 size={16} className="animate-spin text-text-muted" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </span>
              }
            >
              <Group>
                <motion.div initial={false} transition={{ duration: 0.3 }}>
                  <FormDropdown
                    label="Auto Detect Cookie"
                    options={[
                      { value: 'none', label: 'Disabled' },
                      { value: 'studio', label: 'Roblox Studio' },
                      { value: 'browser', label: 'Web Browser' },
                    ]}
                    value={getCookieDetectionMode()}
                    onChange={handleCookieDetectionChange}
                    width="w-[200px]"
                  />
                </motion.div>
                <motion.div
                  initial={false}
                  transition={{ duration: 0.3 }}
                  className="w-full"
                  onDoubleClick={() => {
                    if (autoDetectEnabled) {
                      updateCategory('advanced', {
                        autoCookieStudio: false,
                        autoCookieBrowser: false,
                      });
                      setManualCookieEdit(true);
                      logIsm('info', 'Auto Detect Cookie disabled for manual cookie editing.');
                    }
                  }}
                >
                  <FormInput
                    label="Roblox Cookie"
                    placeholder={
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={cookieReadOnly ? 'readonly' : 'manual'}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.15 }}
                          className="block"
                        >
                          {cookieReadOnly
                            ? 'Auto Detect Cookie enabled. Double-click to edit manually.'
                            : 'Paste .ROBLOSECURITY manually'}
                        </motion.span>
                      </AnimatePresence>
                    }
                    type="password"
                    readOnly={cookieReadOnly}
                    value={cookieReadOnly ? '' : config.spoofing.cookie}
                    onChange={(value: string) => updateConfig('spoofing', 'cookie', value)}
                    className={cookieReadOnly ? 'opacity-60' : ''}
                  />
                </motion.div>
                <FormInput
                  label={t('spoof.apiKey')}
                  placeholder={t('spoof.apiKeyPlaceholder')}
                  type="password"
                  value={config.spoofing.apiKey}
                  onChange={(value: string) => {
                    setApiKeyStatus('idle');
                    updateConfig('spoofing', 'apiKey', value);
                  }}
                  endContent={
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={handleValidateApiKey}
                        className="p-1 rounded text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                        aria-label="Validate Open Cloud API key"
                        title="Validate Open Cloud API key"
                        disabled={apiKeyStatus === 'loading'}
                      >
                        {apiKeyStatus === 'loading' ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <ShieldCheck
                            size={16}
                            className={
                              apiKeyStatus === 'success'
                                ? 'text-success'
                                : apiKeyStatus === 'error'
                                  ? 'text-danger'
                                  : undefined
                            }
                          />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenApiDashboard()}
                        className="p-1 rounded text-text-muted hover:text-primary transition-colors"
                        aria-label={t('spoof.openApiDashboard')}
                        title={t('spoof.openApiDashboard')}
                      >
                        <ExternalLink size={16} />
                      </button>
                    </div>
                  }
                />
              </Group>
            </AccordionItem>

            <AccordionItem
              value="assetProcessing"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <ArrowDownUp size={18} className="text-primary" /> Asset Processing
                </span>
              }
            >
              <Group>
                <FormToggle
                  label={t('settings.skipOwned')}
                  description={t('settings.skipOwnedDescription')}
                  checked={config.advanced.skipOwned}
                  onChange={(value: any) => updateConfig('advanced', 'skipOwned', value)}
                />

                <FormToggle
                  label="Preserve Original Metadata"
                  description="When uploading, duplicate the Name and Description of the original asset so it looks 1:1 on the Roblox catalog."
                  checked={config.spoofing.preserveMetadata}
                  onChange={(value: any) => updateConfig('spoofing', 'preserveMetadata', value)}
                />

                <FormToggle
                  label="Enable Archive Recovery (Slow)"
                  description="Automatically scrape the Wayback Machine to find Place IDs for deleted/private animations. Can add 10-30 seconds per failed asset."
                  checked={config.advanced.enableArchiveRecovery}
                  onChange={(value: any) =>
                    updateConfig('advanced', 'enableArchiveRecovery', value)
                  }
                />

                <div className="flex flex-col gap-1.5 pt-2">
                  <span className="text-[13px] font-semibold text-text-primary px-1">
                    Upload Configuration
                  </span>
                  <span className="text-xs text-text-muted px-1 mb-2">
                    Selected asset types will be downloaded AND uploaded. Unselected types will only
                    be downloaded.
                  </span>
                  <MultiSelectDropdown
                    options={uploadOptions}
                    values={config.spoofing.uploadTypes}
                    onChange={(values: any) => updateConfig('spoofing', 'uploadTypes', values)}
                    placeholder="Select asset types to upload..."
                  />
                </div>
                <div className="pt-2 pb-1">
                  <FormInput
                    label="Download Folder"
                    placeholder="Select where downloads should be saved..."
                    value={config.spoofing.downloadPath || ''}
                    onChange={(value: string) => updateConfig('spoofing', 'downloadPath', value)}
                    endContent={
                      <button
                        type="button"
                        onClick={handleBrowseFolder}
                        className="p-1 rounded text-text-muted hover:text-primary transition-colors"
                        aria-label="Browse folder"
                      >
                        <FolderSearch size={16} />
                      </button>
                    }
                  />
                </div>
              </Group>
            </AccordionItem>

            <AccordionItem
              value="routing"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Sliders size={18} className="text-primary" /> Routing and Limits
                </span>
              }
            >
              <Group>
                <Row>
                  <FormInput
                    label={t('settings.pluginPort')}
                    type="number"
                    value={config.advanced.pluginPort}
                    onChange={(value: string) => updateConfig('advanced', 'pluginPort', value)}
                  />

                  <FormInput
                    label={t('settings.forcePlaceIds')}
                    placeholder={t('settings.forcePlaceIdsPlaceholder')}
                    value={config.advanced.forcePlaceIds}
                    onChange={(value: string) => updateConfig('advanced', 'forcePlaceIds', value)}
                  />
                </Row>
                <Row>
                  <FormInput
                    label={t('settings.searchLimit')}
                    type="number"
                    value={config.advanced.placeIdSearchLimit}
                    onChange={(value: string) =>
                      updateConfig('advanced', 'placeIdSearchLimit', value)
                    }
                  />

                  <FormInput
                    label={t('settings.assetScanTimeout')}
                    type="number"
                    value={config.advanced.assetScanTimeout}
                    onChange={(value: string) =>
                      updateConfig('advanced', 'assetScanTimeout', value)
                    }
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
                      onChange={(value: any) =>
                        updateConfig('advanced', 'concurrentSpoofing', value)
                      }
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
            </AccordionItem>

            <AccordionItem
              value="exclusions"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <ShieldAlert size={18} className="text-primary" /> Exclusions
                </span>
              }
            >
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
                    onChange={(value: string) =>
                      updateConfig('advanced', 'excludedGroupIds', value)
                    }
                  />
                </Row>
              </Group>
            </AccordionItem>
          </Accordion>
        </motion.div>
      </Window>
    </motion.div>
  );
}
