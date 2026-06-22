import {
  Accordion,
  AccordionItem,
  Button,
  FormTextarea,
  Group,
  itemVariants,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  MultiSelectDropdown,
  pageVariants,
  Row,
  Window,
} from '@codycon/ism-library';
import { invoke } from '@tauri-apps/api/core';
import { readText as readClipboardText } from '@tauri-apps/plugin-clipboard-manager';
import { motion } from 'framer-motion';
import { Ban, Play, RotateCcw, ScanSearch, UserSquare2, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import AnimationIcon from '../../assets/roblox_icons/Animation.png';
import DecalIcon from '../../assets/roblox_icons/Decal.png';
import MeshIcon from '../../assets/roblox_icons/MeshPart.png';
import SoundIcon from '../../assets/roblox_icons/Sound.png';
import VideoIcon from '../../assets/roblox_icons/VideoFrame.png';
import { useConfig } from '../../contexts/ConfigContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useStudioConnectionState } from '../../contexts/StudioConnectionContext';
import { useSpooferStore } from '../../stores/spooferStore';
import { cn } from '../../utils/cn';
import { type PendingSpoofRetry, takeSpoofRetry } from '../../utils/jobTypes';
import { findPluginBridgePort } from '../../utils/pluginBridge';
import type { RbxInstance } from '../../utils/robloxPlaceParser';
import {
  loadCachedGroups,
  loadCachedUsers,
  logIsm,
  normalizeId,
  RobloxGroup,
  RobloxUserInfo,
  saveCachedGroups,
  validateCookieProfile,
} from '../../utils/robloxProfiles';
import { appendSpoofingLog } from '../../utils/spoofingLogs';
import { queueStudioReplacements } from '../../utils/studioBridge';
import { triggerStudioScan } from '../../utils/studioScan';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import ResultsModal from '../modals/ResultsModal';
import ExecutionLogs from './spoofing/ExecutionLogs';
import {
  type AudioQuotaDisplay,
  AvatarDropdown,
  GroupDropdown,
  parseAudioQuota,
} from './spoofing/ProfileDropdowns';

type SpooferRunContext = {
  selectedUserId?: string;
  selectedGroupId?: string;
  cookie?: string;
  apiKey?: string;
  spoofSounds?: boolean;
  uploadTypes?: string[];
  account?: { id: string; name: string; avatarUrl: string };
  group?: { id: string; name: string; iconUrl: string } | null;
  placeName?: string;
  assetTypes?: Record<string, string>;
};

type ApiKeyOwnerDetectResult = {
  ok: boolean;
  ownerUserId?: string | null;
  message?: string;
};

async function getStudioPlaceIdFallback(pluginPort: string): Promise<string> {
  try {
    const cached = window.localStorage.getItem('ISpooferMotion_LastStudioPlaceId') || '';
    if (/^\d+$/.test(cached) && cached !== '0') return cached;
  } catch {}

  // try to ping the studio plugin directly for the place id if the tauri state hasn't synced yet
  try {
    const activePort = await findPluginBridgePort(pluginPort);
    if (!activePort) return '';
    const response = await fetch(`http://localhost:${activePort}/studio-health?t=${Date.now()}`, {
      signal: AbortSignal.timeout(800),
      cache: 'no-store',
    });
    if (!response.ok) return '';
    const result = (await response.json()) as { studioPlaceId?: string };
    const placeId = String(result.studioPlaceId || '').trim();
    return /^\d+$/.test(placeId) && placeId !== '0' ? placeId : '';
  } catch {
    return '';
  }
}

export default function SpoofingView() {
  const { t } = useLanguage();
  const { studioPlaceId } = useStudioConnectionState();
  const { config, updateConfig, updateCategory } = useConfig();
  const {
    rootInstances,
    loadedFileName,
    selectedAssetIds,
    setSelectedAssetIds,
    spoofingLogs: logs,
    setSpoofingLogs: setLogs,
    isSpoofing,
    setIsSpoofing,
    spoofProgress,
    setSpoofProgress,
    lastReplacements,
    spoofCompletionVersion,
    isReplacing,
    replaceError,
    setReplaceError,
    setIsReplacing,
    activeSpooferJobId,
    lastAssetResults,
    keyframeWarningCount,
  } = useSpooferStore(
    useShallow((s) => ({
      rootInstances: s.rootInstances,
      loadedFileName: s.loadedFileName,
      selectedAssetIds: s.selectedAssetIds,
      setSelectedAssetIds: s.setSelectedAssetIds,
      spoofingLogs: s.spoofingLogs,
      setSpoofingLogs: s.setSpoofingLogs,
      isSpoofing: s.isSpoofing,
      setIsSpoofing: s.setIsSpoofing,
      spoofProgress: s.spoofProgress,
      setSpoofProgress: s.setSpoofProgress,
      lastReplacements: s.lastReplacements,
      spoofCompletionVersion: s.spoofCompletionVersion,
      isReplacing: s.isReplacing,
      replaceError: s.replaceError,
      setReplaceError: s.setReplaceError,
      setIsReplacing: s.setIsReplacing,
      activeSpooferJobId: s.activeSpooferJobId,
      lastAssetResults: s.lastAssetResults,
      keyframeWarningCount: s.keyframeWarningCount,
    })),
  );
  const [isScanningStudio, setIsScanningStudio] = useState(false);
  const [users, setUsers] = useState<RobloxUserInfo[]>(loadCachedUsers);
  const [groups, setGroups] = useState<RobloxGroup[]>(() =>
    loadCachedGroups(config.spoofing.selectedUser),
  );
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const initialMount = useRef(true);
  const [audioQuota, setAudioQuota] = useState<AudioQuotaDisplay>({
    status: 'idle',
  });
  const [pendingQuotaRun, setPendingQuotaRun] = useState<{
    assetIds: string[];
    audioCount: number;
    remaining: number;
    runContext?: SpooferRunContext;
  } | null>(null);

  const handleRunSpooferRef = useRef<
    (
      overrideAssetIds?: string[],
      skipQuotaWarning?: boolean,
      runContext?: SpooferRunContext,
    ) => Promise<void>
  >(async () => {});
  const failedAssetResults = lastAssetResults.filter((result) => result.success === false);
  const failedAssetIds = Array.from(
    new Set(
      failedAssetResults
        .map((result) => String(result.id || '').replace(/\D/g, ''))
        .filter((id) => id.length > 0),
    ),
  );

  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (Object.keys(lastReplacements).length > 0) {
      setResultsModalOpen(true);
    }
  }, [spoofCompletionVersion, lastReplacements]);

  useEffect(() => {
    const cookie = config.spoofing.cookie.trim();
    if (!cookie || config.spoofing.selectedUser === 'none') {
      setAudioQuota({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setAudioQuota({ status: 'loading' });
    invoke<unknown>('fetch_audio_quota', { cookie, autoDetect: false })
      .then((payload) => {
        if (cancelled) return;
        setAudioQuota(parseAudioQuota(payload) || { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setAudioQuota({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [spoofCompletionVersion, config.spoofing.cookie, config.spoofing.selectedUser]);

  useEffect(() => {
    const refreshUsers = () => setUsers(loadCachedUsers());
    window.addEventListener('storage', refreshUsers);
    window.addEventListener('focus', refreshUsers);
    return () => {
      window.removeEventListener('storage', refreshUsers);
      window.removeEventListener('focus', refreshUsers);
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !config.advanced.clipboardMonitoring) return;

    let lastClipboardText = '';

    const pollClipboard = async () => {
      try {
        const text = await readClipboardText();
        if (text && text !== lastClipboardText) {
          lastClipboardText = text;

          // silently watch the clipboard for roblox asset URLs, and auto-queue them if they are new
          const robloxUrlRegex =
            /(?:roblox\.com\/(?:library|catalog)\/|create\.roblox\.com\/store\/asset\/)(\d+)/i;
          const match = text.match(robloxUrlRegex);

          if (match && match[1]) {
            const assetId = match[1];

            const currentTargets = config.spoofing.extraAssetIds
              .split(/[\s,\n]+/)
              .map((t) => t.trim())
              .filter(Boolean);
            if (!currentTargets.includes(assetId)) {
              currentTargets.push(assetId);
              updateConfig('spoofing', 'extraAssetIds', currentTargets.join('\n'));

              import('@tauri-apps/plugin-notification')
                .then(({ sendNotification }) => {
                  sendNotification({
                    title: 'ISpooferMotion',
                    body: `Auto-queued copied asset ID: ${assetId}`,
                  });
                })
                .catch(() => {});

              window.clipboardSpoofAssetId = assetId;
              window.setTimeout(() => {
                document.dispatchEvent(
                  new CustomEvent('trigger-clipboard-spoof', {
                    detail: { assetId },
                  }),
                );
              }, 0);
            }
          }
        }
      } catch {}
    };

    const intervalId = setInterval(() => void pollClipboard(), 1500);
    return () => clearInterval(intervalId);
  }, [config.advanced.clipboardMonitoring, config.spoofing.extraAssetIds, updateConfig]);

  useEffect(() => {
    const userId = config.spoofing.selectedUser;
    const cachedGroups = loadCachedGroups(userId);
    setGroups(cachedGroups);

    if (!config.spoofing.cookie || !userId || userId === 'none') {
      setLoadingGroups(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setLoadingGroups(true);
        const rawGroups = await invoke<RobloxGroup[]>('get_manageable_groups', {
          cookie: config.spoofing.cookie,
        });
        const groupIds = rawGroups.map((g) => String(g.id));
        const iconMap = await invoke<Record<string, string>>('get_group_icons_batch', {
          groupIds,
        }).catch(() => ({}) as Record<string, string>);

        const withIcons = rawGroups.map((group) => ({
          ...group,
          iconUrl: iconMap[String(group.id)] || undefined,
        }));
        if (!cancelled) {
          setGroups(withIcons);
          saveCachedGroups(userId, withIcons);
          const selectedGroupExists = withIcons.some(
            (group) => normalizeId(group.id) === normalizeId(config.spoofing.selectedGroup),
          );
          if (config.spoofing.selectedGroup !== 'none' && !selectedGroupExists) {
            updateConfig('spoofing', 'selectedGroup', 'none');
          }
        }
      } catch {
        if (!cancelled) setGroups(cachedGroups);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [config.spoofing.cookie, config.spoofing.selectedUser, updateConfig]);

  const handleSelectedUserChange = async (userId: string) => {
    if (!userId || userId === 'none') {
      updateCategory('spoofing', {
        selectedUser: 'none',
        selectedGroup: 'none',
        cookie: '',
      });
      setGroups([]);
      return;
    }

    let profileCookie = '';
    try {
      const secrets = await invoke<Record<string, Record<string, unknown>>>('load_profile_secrets');
      const storedProfileCookie = secrets?.profileCookies?.[userId];
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : secrets?.cookie;
      if (typeof candidate === 'string' && candidate) {
        const result = await validateCookieProfile(candidate);
        if (normalizeId(result.user.id) === normalizeId(userId)) {
          profileCookie = result.cookie;
        }
      }
    } catch {
      logIsm('warn', 'The saved cookie for this Roblox profile could not be restored.', true);
    }

    updateCategory('spoofing', {
      selectedUser: userId,
      selectedGroup: 'none',
      cookie: profileCookie,
    });
    setGroups(loadCachedGroups(userId));
  };

  const spoofOptions = [
    {
      value: 'animation',
      assetType: 'animation',
      label: 'Animations',
      icon: AnimationIcon,
    },
    { value: 'audio', assetType: 'audio', label: 'Audio', icon: SoundIcon },
    { value: 'images', assetType: 'image', label: 'Images', icon: DecalIcon },
    { value: 'meshes', assetType: 'mesh', label: 'Meshes', icon: MeshIcon },
    { value: 'videos', assetType: 'video', label: 'Videos', icon: VideoIcon },
  ];

  const selectedSpoofTypes = spoofOptions
    .filter((option) => config.spoofing[option.value as keyof typeof config.spoofing])
    .map((option) => option.value);

  const handleSpoofTypesChange = (values: string[]) => {
    const changes: Record<string, boolean> = {};
    spoofOptions.forEach((option) => {
      changes[option.value] = values.includes(option.value);
    });
    updateCategory('spoofing', changes);
  };

  const buildRetryRunContext = async (retry: PendingSpoofRetry): Promise<SpooferRunContext> => {
    const selectedUserId = retry.selectedUserId || config.spoofing.selectedUser;
    let cookie = config.spoofing.cookie.trim();
    let apiKey = config.spoofing.apiKey.trim();

    try {
      const secrets =
        await invoke<Record<string, Record<string, unknown> | unknown>>('load_profile_secrets');
      if (typeof secrets?.apiKey === 'string') {
        apiKey = secrets.apiKey;
      }

      const profileCookies = secrets?.profileCookies;
      const storedProfileCookie =
        profileCookies &&
        typeof profileCookies === 'object' &&
        !Array.isArray(profileCookies) &&
        selectedUserId
          ? (profileCookies as Record<string, unknown>)[selectedUserId]
          : undefined;
      const candidate =
        typeof storedProfileCookie === 'string' && storedProfileCookie
          ? storedProfileCookie
          : typeof secrets?.cookie === 'string'
            ? secrets.cookie
            : cookie;

      if (candidate) {
        const result = await validateCookieProfile(candidate);
        if (
          !selectedUserId ||
          selectedUserId === 'none' ||
          normalizeId(result.user.id) === normalizeId(selectedUserId)
        ) {
          cookie = result.cookie;
        }
      }
    } catch {
      logIsm('warn', 'The saved cookie for this retry could not be restored.', true);
    }

    return {
      selectedUserId,
      selectedGroupId: retry.selectedGroupId ?? config.spoofing.selectedGroup,
      cookie,
      apiKey,
      spoofSounds: retry.spoofSounds ?? config.spoofing.audio,
      uploadTypes: retry.uploadTypes ?? config.spoofing.uploadTypes,
      account: retry.account,
      group: retry.group,
      assetTypes: retry.assetTypes,
    };
  };

  const handleCancelSpoofer = async () => {
    if (!activeSpooferJobId) return;
    try {
      await invoke('spoofer_cancel', { jobId: activeSpooferJobId });
      setLogs((prev) => appendSpoofingLog(prev, '[WARN] Spoofing cancellation requested.\n'));
    } catch (error) {
      logIsm('warn', `Could not cancel spoofer: ${String(error)}`, true);
    }
  };

  const handleScanStudio = async () => {
    setIsScanningStudio(true);
    try {
      const port =
        (await findPluginBridgePort(config.advanced.pluginPort)) ||
        config.advanced.pluginPort ||
        '14285';
      setLogs((prev) => appendSpoofingLog(prev, '[INFO] Scanning Roblox Studio for assets...\n'));
      await triggerStudioScan(port);
      setLogs((prev) => appendSpoofingLog(prev, '[SUCCESS] Studio scan complete.\n'));
    } catch (error) {
      logIsm('error', `Studio scan failed: ${String(error)}`, true);
    } finally {
      setIsScanningStudio(false);
    }
  };

  const handleRetryReplacement = async () => {
    if (Object.keys(lastReplacements).length === 0) return;

    setIsReplacing(true);
    setReplaceError(false);
    try {
      await queueStudioReplacements(lastReplacements, config.advanced.pluginPort);
      setLogs((prev) => appendSpoofingLog(prev, '[SUCCESS] Queued replacements for Studio.\n'));
    } catch (error) {
      setLogs((prev) =>
        appendSpoofingLog(prev, `[WARN] Studio replacement queueing failed: ${String(error)}\n`),
      );
      setReplaceError(true);
    } finally {
      setIsReplacing(false);
    }
  };

  const validateApiKeyForRun = async (apiKey: string, selectedUser: string): Promise<boolean> => {
    if (apiKey.length < 20) {
      logIsm(
        'warn',
        'Add an Open Cloud API key with Assets read/write access before spoofing.',
        true,
      );
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          '[WARN] Open Cloud API key missing. Create a key with Assets read/write permissions for the selected user or group.\n',
        ),
      );
      return false;
    }

    try {
      const result = await invoke<ApiKeyOwnerDetectResult>('detect_opencloud_api_key_owner', {
        key: apiKey,
      });
      const message = result.message || 'No validation details returned.';
      if (!result.ok && /invalid|unauthorized/i.test(message)) {
        logIsm('warn', message, true);
        setLogs((prev) => appendSpoofingLog(prev, `[WARN] ${message}\n`));
        return false;
      }

      if (result.ok) {
        if (
          result.ownerUserId &&
          selectedUser !== 'none' &&
          normalizeId(result.ownerUserId) !== normalizeId(selectedUser)
        ) {
          // warn them if the api key belongs to a different user than the one they selected
          setLogs((prev) =>
            appendSpoofingLog(
              prev,
              `[WARN] Open Cloud API key appears to belong to user ${result.ownerUserId}, while the selected profile is ${selectedUser}. Group uploads can still work if the key has creator access.\n`,
            ),
          );
        } else {
          setLogs((prev) =>
            appendSpoofingLog(prev, '[INFO] Open Cloud API key preflight passed.\n'),
          );
        }
      } else {
        setLogs((prev) =>
          appendSpoofingLog(
            prev,
            `[WARN] Could not fully verify the Open Cloud API key (${message}). Continuing; Roblox will reject uploads if the key lacks Assets read/write permissions.\n`,
          ),
        );
      }
      return true;
    } catch (error) {
      setLogs((prev) =>
        appendSpoofingLog(
          prev,
          `[WARN] Open Cloud API key preflight failed (${String(error)}). Continuing; Roblox will reject uploads if the key is invalid.\n`,
        ),
      );
      return true;
    }
  };

  const handleRunSpoofer = async (
    overrideAssetIds?: string[],
    skipQuotaWarning = false,
    runContext?: SpooferRunContext,
  ) => {
    const cookie = (runContext?.cookie ?? config.spoofing.cookie).trim();
    const apiKey = (runContext?.apiKey ?? config.spoofing.apiKey).trim();

    const selectedUser = runContext?.selectedUserId ?? config.spoofing.selectedUser;
    const selectedGroup = runContext?.selectedGroupId ?? config.spoofing.selectedGroup;
    const spoofSounds = runContext?.spoofSounds ?? config.spoofing.audio;
    const uploadTypes = runContext?.uploadTypes ?? config.spoofing.uploadTypes;
    if (cookie.length < 50) {
      logIsm('warn', 'Add a valid Roblox cookie before spoofing.', true);
      return;
    }

    try {
      await validateCookieProfile(cookie);
    } catch {
      logIsm('warn', 'Your Roblox cookie is invalid or expired. Update it before spoofing.', true);
      return;
    }

    const getAssetId = (asset: { assetId?: string; id?: string }) => {
      if ('assetId' in asset) return asset.assetId;
      return asset.id ?? '';
    };

    const extraIdsParsed = config.spoofing.extraAssetIds
      .split(/[\s,]+/)
      .map((id) => id.replace(/\D/g, ''))
      .filter((id) => id.length > 0);

    const extraIdsSet = new Set(extraIdsParsed);
    const assetInfoMap = new Map<string, { type: string; name: string }>();

    // recursively grab asset details from the parsed rbxl tree
    const gatherAllInfo = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          const id = getAssetId(asset);
          if (id && asset.type) {
            assetInfoMap.set(id, { type: asset.type, name: node.name });
          }
        }
        if (node.children) gatherAllInfo(node.children);
      }
    };
    gatherAllInfo(rootInstances);

    const shouldIncludeSelectedId = (id: string) => {
      const numId = parseInt(id, 10);
      if (isNaN(numId) || numId < 10000) return false;
      const type = assetInfoMap.get(id)?.type;
      if (type === 'plugin' && !config.advanced.enablePluginSpoofing) return false;
      return true;
    };

    const finalAssetIds = new Set<string>();
    if (overrideAssetIds) {
      overrideAssetIds.forEach((id) => {
        if (shouldIncludeSelectedId(id)) finalAssetIds.add(id);
      });
    } else {
      const hasExplicitSelection = selectedAssetIds.size > 0 || extraIdsSet.size > 0;
      selectedAssetIds.forEach((id) => {
        if (shouldIncludeSelectedId(id)) finalAssetIds.add(id);
      });
      extraIdsSet.forEach((id) => {
        if (shouldIncludeSelectedId(id)) finalAssetIds.add(id);
      });

      if (!hasExplicitSelection) {
        const selectedTypes = new Set(
          spoofOptions
            .filter((option) => selectedSpoofTypes.includes(option.value))
            .map((option) => option.assetType),
        );

        selectedTypes.add('script_ref');

        const gatherByType = (nodes: RbxInstance[]) => {
          for (const node of nodes) {
            for (const asset of node.assets) {
              if (selectedTypes.has(asset.type)) {
                const id = getAssetId(asset);
                if (id) finalAssetIds.add(id);
              }
            }
            if (node.children) gatherByType(node.children);
          }
        };
        gatherByType(rootInstances);
      }
    }

    if (finalAssetIds.size === 0) {
      logIsm('warn', 'Select at least one asset or asset type before spoofing.', true);
      return;
    }

    const audioAssetIds = new Set<string>();
    const gatherAudioIds = (nodes: RbxInstance[]) => {
      for (const node of nodes) {
        for (const asset of node.assets) {
          if (asset.type === 'audio') {
            const id = getAssetId(asset);
            if (id) audioAssetIds.add(id);
          }
        }
        if (node.children) gatherAudioIds(node.children);
      }
    };
    gatherAudioIds(rootInstances);
    const selectedAudioCount = Array.from(finalAssetIds).filter((id) =>
      audioAssetIds.has(id),
    ).length;
    if (
      !skipQuotaWarning &&
      audioQuota.status === 'ready' &&
      selectedAudioCount > audioQuota.remaining
    ) {
      setPendingQuotaRun({
        assetIds: Array.from(finalAssetIds),
        audioCount: selectedAudioCount,
        remaining: audioQuota.remaining,
        runContext,
      });
      return;
    }

    setLogs([]);
    const apiKeyReady = await validateApiKeyForRun(apiKey, selectedUser);
    if (!apiKeyReady) return;

    const finalAssetsPayload = Array.from(finalAssetIds).map((id) => {
      const info = assetInfoMap.get(id);
      const isManualPluginId = config.advanced.enablePluginSpoofing && extraIdsSet.has(id);
      const overrideType = runContext?.assetTypes?.[id];
      const normalizedOverrideType =
        overrideType &&
        ['animation', 'audio', 'mesh', 'image', 'script_ref', 'plugin'].includes(overrideType)
          ? overrideType
          : undefined;
      const type = normalizedOverrideType
        ? normalizedOverrideType
        : isManualPluginId
          ? 'plugin'
          : info?.type === 'plugin'
            ? 'animation'
            : info?.type || 'animation';
      const name = info?.name || `Asset ${id}`;
      return { id, type, name };
    });

    setIsSpoofing(true);
    setSpoofProgress(0);

    try {
      const currentUser = users.find((user) => String(user.id) === String(selectedUser));
      const currentGroup = groups.find((group) => String(group.id) === String(selectedGroup));
      const accountPayload = runContext?.account || {
        id: String(currentUser?.id || selectedUser),
        name: currentUser?.displayName || currentUser?.name || 'Unknown',
        avatarUrl: currentUser?.avatarUrl || '',
      };
      const groupPayload =
        selectedGroup !== 'none'
          ? runContext?.group ||
            (currentGroup
              ? {
                  id: String(currentGroup.id),
                  name: currentGroup.name,
                  iconUrl: currentGroup.iconUrl || '',
                }
              : {
                  id: String(selectedGroup),
                  name: 'Group upload',
                  iconUrl: '',
                })
          : null;
      const configuredPlaceIds = config.advanced.forcePlaceIds.trim();
      const studioPlaceIdFallback = configuredPlaceIds
        ? ''
        : studioPlaceId || (await getStudioPlaceIdFallback(config.advanced.pluginPort));

      await invoke('run_spoofer_action', {
        data: {
          assets: JSON.stringify(finalAssetsPayload),
          cookie,
          apiKey,
          groupId: selectedGroup !== 'none' ? selectedGroup : null,
          spoofSounds,
          uploadTypes,
          downloadPath: config.spoofing.downloadPath,
          forcePlaceIds: configuredPlaceIds || studioPlaceIdFallback,
          placeIdSearchLimit: config.advanced.placeIdSearchLimit,
          placeName: runContext?.placeName || loadedFileName,
          concurrent: config.advanced.concurrentSpoofing,
          maxConcurrency: config.advanced.maxConcurrency,
          skipOwned: config.advanced.skipOwned,
          excludedUserIds: config.advanced.excludedUserIds,
          excludedGroupIds: config.advanced.excludedGroupIds,
          skipExistingReplacements: true,
          existingReplacements: lastReplacements,
          account: accountPayload,
          group: groupPayload,
          preserveMetadata: config.spoofing.preserveMetadata,
          enableArchiveRecovery: config.advanced.enableArchiveRecovery,
          proxyUrl: config.advanced.proxyUrl,
        },
      });
    } catch (err) {
      logIsm('error', 'Failed to start spoofer: ' + err, true);
      setIsSpoofing(false);
    }
  };

  handleRunSpooferRef.current = handleRunSpoofer;

  const handleRetryFailedAssets = async () => {
    if (failedAssetIds.length === 0) return;

    const assetTypes = failedAssetResults.reduce<Record<string, string>>((acc, result) => {
      const id = String(result.id || '').replace(/\D/g, '');
      const type = String(result.type || result.assetType || '');
      if (id && type) acc[id] = type;
      return acc;
    }, {});

    setSelectedAssetIds(new Set(failedAssetIds));
    setLogs((prev) =>
      appendSpoofingLog(prev, `[INFO] Retrying ${failedAssetIds.length} failed asset(s)...\n`),
    );
    await handleRunSpooferRef.current(failedAssetIds, false, { assetTypes });
  };

  useEffect(() => {
    const handleClipboardSpoof = (event: Event) => {
      const assetId =
        event instanceof CustomEvent && typeof event.detail?.assetId === 'string'
          ? event.detail.assetId
          : null;
      if (!assetId) return;
      void handleRunSpooferRef.current([assetId], true);
    };
    document.addEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
    return () => document.removeEventListener('trigger-clipboard-spoof', handleClipboardSpoof);
  }, []);

  useEffect(() => {
    const retry = takeSpoofRetry();
    if (!retry) return;

    let cancelled = false;
    let timeout: number | undefined;
    const run = async () => {
      const retryContext = await buildRetryRunContext(retry);
      if (cancelled) return;

      const spoofingUpdates: Partial<typeof config.spoofing> = {
        selectedUser: retryContext.selectedUserId || 'none',
        selectedGroup: retryContext.selectedGroupId || 'none',
        audio: retryContext.spoofSounds ?? config.spoofing.audio,
        cookie: retryContext.cookie || config.spoofing.cookie,
      };
      if (retryContext.uploadTypes) {
        spoofingUpdates.uploadTypes = retryContext.uploadTypes;
      }
      updateCategory('spoofing', spoofingUpdates);
      setSelectedAssetIds(new Set(retry.assetIds));
      setLogs([`Retrying ${retry.assetIds.length} failed asset(s)...`]);

      timeout = window.setTimeout(() => {
        void handleRunSpooferRef.current(retry.assetIds, false, retryContext);
      }, 0);
    };

    void run();
    return () => {
      cancelled = true;
      if (timeout) window.clearTimeout(timeout);
    };
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
        <motion.div variants={itemVariants} className="w-full flex flex-col gap-8">
          <Accordion
            selectionMode="multiple"
            expandedKeys={config.ui.spoofingSections}
            onExpandedChange={(keys: string[]) => updateConfig('ui', 'spoofingSections', keys)}
            className="flex flex-col gap-6"
          >
            <AccordionItem
              value="targets"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <UserSquare2 size={18} className="text-primary" /> Targets
                </span>
              }
            >
              <Group>
                <AvatarDropdown
                  users={users}
                  value={config.spoofing.selectedUser}
                  onChange={handleSelectedUserChange}
                  loading={false}
                  audioQuota={audioQuota}
                  showAudioQuota={true}
                />

                <GroupDropdown
                  groups={groups}
                  value={config.spoofing.selectedGroup}
                  onChange={(value) => updateConfig('spoofing', 'selectedGroup', value)}
                  loading={loadingGroups}
                />

                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-text-primary px-1">
                    Select Assets to Spoof
                  </span>
                  <MultiSelectDropdown
                    options={spoofOptions}
                    values={selectedSpoofTypes}
                    onChange={handleSpoofTypesChange}
                    placeholder="Select asset types..."
                  />
                </div>
              </Group>
            </AccordionItem>

            <AccordionItem
              value="execution"
              title={
                <span className="flex items-center gap-3 font-semibold">
                  <Wand2 size={18} className="text-primary" /> Execution
                </span>
              }
            >
              <Group>
                <FormTextarea
                  label="Additional IDs to Spoof"
                  value={config.spoofing.extraAssetIds}
                  onChange={(val: string) => updateConfig('spoofing', 'extraAssetIds', val)}
                  placeholder="e.g. 123456789, 987654321"
                  style={{
                    height: '7.5rem',
                    maxHeight: '7.5rem',
                    minHeight: '7.5rem',
                    overflowY: 'auto',
                    resize: 'none',
                    overscrollBehavior: 'contain',
                  }}
                />

                {keyframeWarningCount > 0 && (
                  <div className="rounded-[var(--radius-md)] border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text-secondary">
                    {keyframeWarningCount} KeyframeSequence object
                    {keyframeWarningCount === 1 ? '' : 's'} in Studio must be published as
                    animations before they can be spoofed.
                  </div>
                )}

                <ExecutionLogs
                  logs={logs}
                  setLogs={setLogs}
                  lastReplacements={lastReplacements}
                  setResultsModalOpen={setResultsModalOpen}
                />

                <Row className="gap-2">
                  <Button
                    color={replaceError ? 'warning' : 'primary'}
                    className="flex-1 font-bold h-12 tracking-wide overflow-hidden relative"
                    onClick={() => {
                      if (replaceError) {
                        void handleRetryReplacement();
                      } else {
                        void handleRunSpoofer();
                      }
                    }}
                    disabled={isSpoofing || isReplacing || isScanningStudio}
                  >
                    <div className="relative z-10 flex items-center justify-center gap-2 w-full h-full">
                      {!isSpoofing && !isReplacing && !replaceError && (
                        <Play size={18} fill="currentColor" />
                      )}
                      <span>
                        {isReplacing
                          ? 'Replacing in Studio...'
                          : replaceError
                            ? 'Retry Replacement'
                            : isSpoofing
                              ? `Spoofing... ${Math.round(spoofProgress)}%`
                              : t('spoof.runSpoofer')}
                      </span>
                    </div>
                    {(isSpoofing || isReplacing) && (
                      <div
                        className="absolute left-0 top-0 bottom-0 bg-black/25 pointer-events-none"
                        style={{
                          width: `${spoofProgress}%`,
                          transition: 'width 50ms linear',
                        }}
                      />
                    )}
                  </Button>
                  <Button
                    variant="flat"
                    color={activeSpooferJobId ? 'danger' : undefined}
                    className={cn('h-12 px-6 font-semibold transition-all duration-300')}
                    startContent={activeSpooferJobId ? <Ban size={18} /> : <ScanSearch size={18} />}
                    onClick={() => {
                      if (activeSpooferJobId) {
                        void handleCancelSpoofer();
                      } else {
                        void handleScanStudio();
                      }
                    }}
                    disabled={
                      (!activeSpooferJobId && (isSpoofing || isReplacing)) || isScanningStudio
                    }
                  >
                    {activeSpooferJobId
                      ? 'Cancel'
                      : isScanningStudio
                        ? 'Scanning...'
                        : 'Scan Studio'}
                  </Button>
                  {failedAssetIds.length > 0 && !activeSpooferJobId && (
                    <Button
                      variant="flat"
                      color="warning"
                      className="h-12 px-4 font-semibold min-w-[10rem]"
                      startContent={<RotateCcw size={18} />}
                      onClick={() => void handleRetryFailedAssets()}
                      disabled={isSpoofing || isReplacing || isScanningStudio}
                    >
                      Retry Failed ({failedAssetIds.length})
                    </Button>
                  )}
                </Row>
              </Group>
            </AccordionItem>
          </Accordion>
        </motion.div>
      </Window>
      <ResultsModal isOpen={resultsModalOpen} onClose={() => setResultsModalOpen(false)} />

      <Modal
        isOpen={Boolean(pendingQuotaRun)}
        onOpenChange={(open: boolean) => !open && setPendingQuotaRun(null)}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>Audio quota exceeded</ModalHeader>
          <ModalBody>
            <p className="text-sm leading-6 text-text-secondary">
              This run includes{' '}
              <strong className="text-text-primary">{pendingQuotaRun?.audioCount ?? 0}</strong>{' '}
              audio uploads, but the selected profile has{' '}
              <strong className="text-text-primary">{pendingQuotaRun?.remaining ?? 0}</strong>{' '}
              remaining. Some audio assets may fail to upload. Continue anyway?
            </p>
          </ModalBody>
          <ModalFooter className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingQuotaRun(null)}>
              Cancel
            </Button>
            <Button
              color="warning"
              onClick={() => {
                const assetIds = pendingQuotaRun?.assetIds;
                const runContext = pendingQuotaRun?.runContext;
                setPendingQuotaRun(null);
                if (assetIds) void handleRunSpoofer(assetIds, true, runContext);
              }}
            >
              Continue Anyway
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </motion.div>
  );
}
