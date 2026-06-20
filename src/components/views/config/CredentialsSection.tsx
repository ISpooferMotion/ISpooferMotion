import { FormDropdown, FormInput, Group } from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';
import { useConfigStore } from '../../../stores/configStore';
import {
  detectCookie,
  logIsm,
  mergeCachedUser,
  validateCookieProfile,
} from '../../../utils/robloxProfiles';

type AuthStatus = 'idle' | 'loading' | 'success' | 'error';
type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

export default function CredentialsSection() {
  const { t } = useLanguage();
  const { config, updateConfig, updateCategory } = useConfig();
  const [manualCookieEdit, setManualCookieEdit] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('idle');
  const [apiKeyStatus, setApiKeyStatus] = useState<AuthStatus>('idle');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle');
  const { saveSecrets } = useConfigStore();

  const autoDetectEnabled = config.advanced.autoCookieStudio || config.advanced.autoCookieBrowser;
  const cookieReadOnly = autoDetectEnabled && !manualCookieEdit;

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

    // Auto-save the newly validated profile directly to the OS keyring
    void saveSecrets();
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
      void runAutoDetect(val);
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

  const handleSaveProfile = async () => {
    setSaveStatus('saving');
    await saveSecrets();
    setSaveStatus('success');
    logIsm('success', 'Profile credentials saved successfully.', true);
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  return (
    <Group>
      <motion.div initial={false} transition={{ duration: 0.3 }}>
        <FormDropdown
          label={
            <span className="flex items-center gap-2">
              Auto Detect Cookie
              <AnimatePresence>
                {authStatus === 'loading' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                  >
                    <Loader2 size={14} className="animate-spin text-primary" />
                  </motion.div>
                )}
              </AnimatePresence>
            </span>
          }
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

      <div className="flex w-full mt-2">
        <button
          type="button"
          onClick={() => void handleSaveProfile()}
          disabled={saveStatus === 'saving'}
          className="flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50"
        >
          {saveStatus === 'saving' ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          {saveStatus === 'success' ? 'Saved!' : 'Save Credentials'}
        </button>
      </div>
    </Group>
  );
}
