import { useEffect, useRef, useState, useMemo } from 'react';
import { Box, Flex, VStack, HStack, Text, Button, Textarea, Input, Switch, Select, NumberInput, NumberInputField, NumberInputStepper, NumberIncrementStepper, NumberDecrementStepper, Collapse, Badge, InputGroup, InputRightElement, IconButton, Tooltip } from '@chakra-ui/react';
import { FolderOpen, Key, Hash, Settings2, Play, Pause, Square, MonitorUp } from 'lucide-react';

export default function SpooferView({ isActive }: { isActive: boolean }) {
  const [animationId, setAnimationId] = useState('');
  const [robloxCookie, setRobloxCookie] = useState('');
  const [openCloudApiKey, setOpenCloudApiKey] = useState('');
  const [groupId, setGroupId] = useState('');

  const [autoDetectCookie, setAutoDetectCookie] = useState(true);
  const [downloadOnly, setDownloadOnly] = useState(false);
  const [downloadFolder, setDownloadFolder] = useState('');

  const [maxPlaceIds, setMaxPlaceIds] = useState(10);
  const [maxPlaceIdRetries, setMaxPlaceIdRetries] = useState(3);
  const [overridePlaceId, setOverridePlaceId] = useState('');
  const [placeSearchInput, setPlaceSearchInput] = useState('');
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [placeSearchMessage, setPlaceSearchMessage] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<any[]>([]);
  const [uploadRetries, setUploadRetries] = useState(3);
  const [uploadRetryDelay, setUploadRetryDelay] = useState(2000);

  const [outputData, setOutputData] = useState('');
  const [statusText, setStatusText] = useState('No run yet');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [inlineQuotaText, setInlineQuotaText] = useState('Checking quota...');
  const [inlineQuotaError, setInlineQuotaError] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);


  const getActiveProfileSettings = async () => {
    try {
      const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
      if (!secrets) return null;
      return secrets.profiles[secrets.activeProfileId];
    } catch {
      return null;
    }
  };

  const handleInputTextChange = (val: string) => {
    setAnimationId(val);
    setUploadComplete(false);
  };

  const hasAudio = useMemo(() => {
    return /\bTYPE\s*:\s*(SOUND|MIXED)\b/i.test(animationId) || /\[Type:Sound\]/i.test(animationId);
  }, [animationId]);

  useEffect(() => {
    let active = true;

    if (!hasAudio) {
      setInlineQuotaText('');
      setInlineQuotaError(false);
      return;
    }

    setInlineQuotaText('Checking quota...');
    setInlineQuotaError(false);

    (window as any).electronAPI?.getAudioQuota?.({ cookie: robloxCookie, autoDetect: autoDetectCookie })
      .then((result: any) => {
        if (!active) return;
        if (result && result.error) {
          setInlineQuotaError(true);
          setInlineQuotaText(`Quota error: ${result.error}`);
          return;
        }

        let used: number, capacity: number;
        if (Array.isArray(result.quotas)) {
          const quota = result.quotas.find((q: any) => String(q?.duration).toLowerCase() === 'month') || result.quotas[0];
          used = Number(quota?.usage ?? quota?.used ?? quota?.consumed ?? 0);
          capacity = Number(quota?.capacity ?? quota?.limit ?? quota?.total ?? 0);
        } else if (result.usage && typeof result.usage === 'object') {
          used = Number(result.usage.used ?? result.usage.usage ?? 0);
          capacity = Number(result.usage.capacity ?? result.usage.total ?? result.usage.limit ?? 0);
        } else {
          used = Number(result.usage ?? result.used ?? 0);
          capacity = Number(result.capacity ?? result.total ?? result.limit ?? 0);
        }

        if (!Number.isFinite(used) || !Number.isFinite(capacity) || capacity <= 0) {
          setInlineQuotaText('Quota data unavailable.');
        } else {
          const remaining = Math.max(0, capacity - used);
          setInlineQuotaText(`Audio quota: ${used.toLocaleString()} / ${capacity.toLocaleString()} used (${remaining.toLocaleString()} remaining)`);
        }
      })
      .catch((err: any) => {
        if (!active) return;
        setInlineQuotaError(true);
        setInlineQuotaText(`Quota error: ${err.message}`);
      });

    return () => { active = false; };
  }, [hasAudio, robloxCookie, autoDetectCookie]);

  useEffect(() => {
    const handleProfileChanged = async () => {
      const profile = await getActiveProfileSettings();
      if (profile) {
        setRobloxCookie(profile.cookie ?? '');
        setOpenCloudApiKey(profile.apiKey ?? '');
        setGroupId(profile.groupId ?? '');
        setAutoDetectCookie(profile.autoDetectCookie ?? true);
        setDownloadOnly(profile.downloadOnly ?? false);
        setDownloadFolder(profile.downloadFolder ?? '');
        setOverridePlaceId(profile.overridePlaceId ?? '');
        setPlaceSearchInput(profile.placeSearchInput ?? '');
      }
    };
    window.addEventListener('profile-changed', handleProfileChanged);
    handleProfileChanged();

    const cleanupStatus = (window as any).electronAPI?.onStatusUpdate?.((msg: string) => setStatusText(msg || 'Ready'));
    const cleanupResult = (window as any).electronAPI?.onSpooferResult?.((result: any) => {
      setRunning(false);
      setPaused(false);
      if (result) {
        const output = typeof result === 'string' ? result : result.output;
        if (output != null) setOutputData(String(output));
        const success = result.success !== false;
        setStatusText(success ? 'Complete' : 'Failed');
        if (success) setUploadComplete(true);
      }
    });

    const cleanupLocalhost = (window as any).electronAPI?.onLocalhostScanResults?.((data: any) => {
      if (data && data.text) {
        handleInputTextChange(data.text);
      }
    });

    return () => {
      window.removeEventListener('profile-changed', handleProfileChanged);
      cleanupStatus?.();
      cleanupResult?.();
      cleanupLocalhost?.();
    };
  }, []);

  const updateProfileValue = async (key: string, value: any) => {
    try {
      const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
      const activeId = secrets?.activeProfileId;
      if (!activeId) return;
      await (window as any).electronAPI?.saveProfileSecrets?.({
        action: 'patchProfile',
        profileId: activeId,
        secrets: { [key]: value },
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleRun = async () => {
    if (running) {
      (window as any).electronAPI?.cancelSpoofer?.();
      setRunning(false);
      setStatusText('Cancelled');
      return;
    }
    setUploadComplete(false);
    if (!animationId.trim()) { setStatusText('Paste at least one asset entry first.'); return; }
    if (downloadOnly && !downloadFolder) { setStatusText('Choose a download folder for Download only mode.'); return; }
    if (!downloadOnly && !openCloudApiKey) { setStatusText('Open Cloud API key is required for upload/spoofing.'); return; }
    if (!autoDetectCookie && !robloxCookie) { setStatusText('Enter a Roblox cookie or enable Auto detect cookie.'); return; }

    const normalizedApiKey = openCloudApiKey.trim();
    if (!downloadOnly) {
      setStatusText('Checking API key...');
      const apiKeyValidation = await (window as any).electronAPI?.validateOpenCloudApiKey?.(normalizedApiKey);
      if (!apiKeyValidation?.ok) {
        setApiKeyStatus(apiKeyValidation?.message || 'API key is invalid.');
        setStatusText('API key validation failed.');
        return;
      }
      setOpenCloudApiKey(normalizedApiKey);
      setApiKeyStatus(apiKeyValidation.message || 'API key saved.');
      await updateProfileValue('apiKey', normalizedApiKey);
    }

    setRunning(true); setPaused(false); setStatusText('Starting...'); setOutputData('');
    const profile = (await getActiveProfileSettings()) || {};

    const payload = {
      animationId, robloxCookie, apiKey: normalizedApiKey, groupId,
      enableSpoofing: !downloadOnly, downloadOnly, autoDetectCookie, downloadFolder,
      maxPlaceIds, maxPlaceIdRetries, overridePlaceId, uploadRetries, uploadRetryDelay,
      batchRetries: profile.defRetries ?? 3, batchRetryDelay: profile.defDelay ?? 5000,
      batchTimeoutMs: 15000, batchChunkSize: 50,
      downloadRetries: 2, downloadRetryDelayMs: 2000, downloadTimeoutMs: 15000,
      concurrentUploads: profile.concurrent ?? true, maxConcurrentUploads: profile.maxConcurrentUploads ?? 25,
      renamePrefix: profile.renameToggle ? (profile.renamePrefix ?? '') : '',
      renameSuffix: profile.renameToggle ? (profile.renameSuffix ?? '') : '',
      renameFind: profile.renameToggle ? (profile.renameFind ?? '') : '',
      renameReplace: profile.renameToggle ? (profile.renameReplace ?? '') : '',
      maxConcurrentDownloads: profile.maxConcurrentDownloads ?? 20,
      desktopNotifications: profile.notifications ?? true,
    };
    (window as any).electronAPI?.runSpooferAction?.(payload);
  };

  const handlePauseResume = () => {
    if (!running) return;
    if (paused) { (window as any).electronAPI?.resumeSpoofer?.(); setPaused(false); setStatusText('Resuming...'); }
    else { (window as any).electronAPI?.pauseSpoofer?.(); setPaused(true); setStatusText('Paused'); }
  };

  const handlePushToStudio = () => {
    if (!outputData) return;
    setStatusText('Pushing to Studio...');
    (window as any).electronAPI?.pushToStudio?.(outputData).then((res: any) => {
      setStatusText(res?.ok || res === true ? 'Pushed to Studio!' : 'Failed to push to Studio.');
    }).catch((err: any) => {
      setStatusText('Failed to push to Studio.');
    });
  };

  const handleSelectFolder = async () => {
    const result = await (window as any).electronAPI?.selectFolder?.();
    if (result && !result.canceled && result.filePaths?.length > 0) {
      const folder = result.filePaths[0];
      setDownloadFolder(folder);
      await updateProfileValue('downloadFolder', folder);
    }
  };

  const handleSearchPlaces = async () => {
    const raw = placeSearchInput.trim();
    if (!raw) return;
    setPlaceSearchLoading(true);
    setPlaceSearchMessage('Searching...');
    setPlaceSuggestions([]);
    try {
      const res = await (window as any).electronAPI?.searchPlaceIds?.({
        input: raw,
        creatorType: '', // Auto-detected by backend
        maxPlaceIds: 50,
        cookie: robloxCookie,
        autoDetect: autoDetectCookie
      });
      if (res && res.places) {
        setPlaceSuggestions(res.places);
        setPlaceSearchMessage(res.message || `Found ${res.places.length} places.`);
      } else {
        setPlaceSearchMessage('No places found.');
      }
    } catch (err: any) {
      setPlaceSearchMessage(err.message || 'Error searching places.');
    }
    setPlaceSearchLoading(false);
  };

  if (!isActive) return null;

  return (
    <Flex h="100%" w="100%" overflow="hidden" bg="discord.background">
      {/* Main Workspace */}
      <Flex flex={1} direction="column" p="32px" gap="24px" position="relative">
        <HStack justify="space-between">
          <Text fontWeight={800} fontSize="28px" color="discord.text">Asset Spoofer</Text>
        </HStack>

        <Textarea
          placeholder="Paste your Asset IDs here...&#10;Supports [assetId], [name], and [User:123]"
          value={animationId}
          onChange={(e) => handleInputTextChange(e.target.value)}
          flex={1}
          bg="discord.input"
          color="discord.text"
          border="1px solid"
          borderColor="discord.border"
          borderRadius="8px"
          fontFamily="'Consolas', 'Courier New', monospace"
          fontSize="14px"
          p="20px"
          lineHeight="1.6"
          _hover={{ borderColor: 'discord.border' }}
          _focus={{ borderColor: 'brand.500', boxShadow: 'none' }}
          resize="none"
          sx={{
            '&::-webkit-scrollbar': { width: '8px' },
            '&::-webkit-scrollbar-thumb': { bg: 'discord.card', borderRadius: '4px' },
            '&::-webkit-scrollbar-track': { bg: 'transparent' }
          }}
        />

        {inlineQuotaText && (
          <Text fontSize="12px" color={inlineQuotaError ? 'red.400' : 'discord.muted'} mt="-16px" mb="8px" ml="4px" fontWeight={500}>
            {inlineQuotaText}
          </Text>
        )}

        <Box h="200px" bg="discord.inputDark" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border" overflowY="auto" sx={{
          '&::-webkit-scrollbar': { width: '8px' },
          '&::-webkit-scrollbar-thumb': { bg: 'discord.card', borderRadius: '4px' },
          '&::-webkit-scrollbar-track': { bg: 'transparent' }
        }}>
          <Text fontSize="13px" whiteSpace="pre-wrap" wordBreak="break-word" color={outputData ? "discord.muted" : "discord.darkMuted"} fontFamily="'Consolas', 'Courier New', monospace" m={0} lineHeight="1.5">
            {outputData || 'Waiting for spoofer output...'}
          </Text>
        </Box>

        <HStack justify="space-between" align="center" bg="discord.card" p="16px 20px" borderRadius="8px" boxShadow="0 2px 10px rgba(0,0,0,0.1)">
          <Text fontSize="14px" color="discord.text" fontWeight={600}>{statusText}</Text>
          <HStack spacing="12px">
            {running && (
              <Button size="sm" variant="solid" bg="discord.input" color="discord.text" _hover={{ bg: 'discord.inputDark' }} onClick={handlePauseResume} h="36px" px="20px" borderRadius="4px" fontWeight={600} leftIcon={paused ? <Play size={16} /> : <Pause size={16} />}>
                {paused ? 'Resume' : 'Pause'}
              </Button>
            )}
            {uploadComplete ? (
              <Button size="sm" colorScheme="brand" onClick={handlePushToStudio} minW="140px" h="36px" borderRadius="4px" fontWeight={600} leftIcon={<MonitorUp size={16} />}>
                Push to Studio
              </Button>
            ) : (
              <Button size="sm" colorScheme={running ? 'red' : 'brand'} onClick={handleRun} minW="140px" h="36px" borderRadius="4px" fontWeight={600} leftIcon={running ? <Square size={14} fill="currentColor" /> : <Play size={16} />}>
                {running ? 'Cancel' : 'Start Upload'}
              </Button>
            )}
          </HStack>
        </HStack>
      </Flex>

      {/* Right Sidebar */}
      <VStack w="320px" bg="discord.card" p="24px" spacing="24px" borderLeft="1px solid" borderColor="discord.border" overflowY="auto" align="stretch" sx={{
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-thumb': { bg: 'discord.input', borderRadius: '4px' },
        '&::-webkit-scrollbar-track': { bg: 'transparent' }
      }}>
        <Text fontWeight={800} fontSize="12px" color="discord.darkMuted" textTransform="uppercase" letterSpacing="0.5px">Quick Setup</Text>
        
        <VStack spacing="16px" align="stretch">
          <Box>
            <HStack mb="8px"><Key size={14} color="#949ba4" /><Text fontSize="12px" color="discord.muted" fontWeight={600}>Roblox Cookie {autoDetectCookie ? '(Auto)' : ''}</Text></HStack>
            <Input size="sm" type="password" disabled={autoDetectCookie} value={robloxCookie} onChange={(e) => { setRobloxCookie(e.target.value); updateProfileValue('cookie', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'brand.500' }} />
          </Box>
          <Box>
            <HStack mb="8px"><Key size={14} color="#949ba4" /><Text fontSize="12px" color="discord.muted" fontWeight={600}>Open Cloud API Key</Text></HStack>
            <InputGroup size="sm">
              <Input type="password" disabled={downloadOnly} value={openCloudApiKey} onChange={(e) => { setOpenCloudApiKey(e.target.value); setApiKeyStatus('Unsaved changes...'); }} onBlur={async () => { const t = openCloudApiKey.trim(); setOpenCloudApiKey(t); await updateProfileValue('apiKey', t); setApiKeyStatus('Saved.'); }} bg="discord.input" border="none" color="discord.text" pr="80px" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
              <InputRightElement w="80px" h="36px">
                <Button size="xs" variant="ghost" h="24px" mt="6px" color="discord.muted" _hover={{ bg: 'discord.background', color: 'discord.text' }} onClick={() => (window as any).electronAPI?.openExternal?.('https://create.roblox.com/dashboard/credentials')}>Get Key</Button>
              </InputRightElement>
            </InputGroup>
            {apiKeyStatus && <Text fontSize="11px" color="discord.darkMuted" mt="4px" fontWeight={500}>{apiKeyStatus}</Text>}
          </Box>
          <Box>
            <HStack mb="8px"><Hash size={14} color="#949ba4" /><Text fontSize="12px" color="discord.muted" fontWeight={600}>Group ID (Blank for user)</Text></HStack>
            <Input size="sm" disabled={downloadOnly} value={groupId} onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); setGroupId(n); updateProfileValue('groupId', n); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'brand.500' }} />
          </Box>
          
          <Collapse in={downloadOnly} animateOpacity>
            <Box>
              <HStack mb="8px"><FolderOpen size={14} color="#949ba4" /><Text fontSize="12px" color="discord.muted" fontWeight={600}>Download Folder</Text></HStack>
              <InputGroup size="sm">
                <Input readOnly value={downloadFolder} placeholder="Select a folder..." bg="discord.input" border="none" color="discord.text" pr="40px" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none' }} />
                <InputRightElement w="40px" h="36px">
                  <IconButton aria-label="Select Folder" icon={<FolderOpen size={14} />} size="xs" variant="ghost" h="24px" mt="6px" color="discord.muted" _hover={{ bg: 'discord.background', color: 'discord.text' }} onClick={handleSelectFolder} />
                </InputRightElement>
              </InputGroup>
            </Box>
          </Collapse>

          <VStack spacing="12px" align="stretch" mt="8px">
            <HStack justify="space-between"><Text fontSize="13px" color="discord.text" fontWeight={500}>Auto detect cookie</Text><Switch colorScheme="brand" size="sm" isChecked={autoDetectCookie} onChange={(e) => { setAutoDetectCookie(e.target.checked); updateProfileValue('autoDetectCookie', e.target.checked); }} /></HStack>
            <HStack justify="space-between"><Text fontSize="13px" color="discord.text" fontWeight={500}>Download only</Text><Switch colorScheme="brand" size="sm" isChecked={downloadOnly} onChange={(e) => { setDownloadOnly(e.target.checked); updateProfileValue('downloadOnly', e.target.checked); }} /></HStack>
          </VStack>
        </VStack>

        <Box h="1px" bg="discord.border" my="16px" />
        
        <VStack spacing="16px" align="stretch">
          <Box>
            <Text fontSize="12px" color="discord.muted" mb="8px" fontWeight={600}>Search Place (URL or ID)</Text>
            <HStack>
              <Input size="sm" placeholder="e.g. 12345 or Roblox URL" value={placeSearchInput} onChange={(e) => { setPlaceSearchInput(e.target.value); updateProfileValue('placeSearchInput', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'brand.500' }} />
              <Button size="sm" colorScheme="brand" h="36px" onClick={handleSearchPlaces} isLoading={placeSearchLoading} minW="80px">Search</Button>
            </HStack>
            {placeSearchMessage && <Text fontSize="11px" color="discord.muted" mt="8px">{placeSearchMessage}</Text>}
          </Box>
          <Collapse in={placeSuggestions.length > 0}>
            <VStack maxH="200px" overflowY="auto" spacing="4px" align="stretch" sx={{ '&::-webkit-scrollbar': { width: '4px' }, '&::-webkit-scrollbar-thumb': { bg: 'discord.input', borderRadius: '4px' } }}>
              {placeSuggestions.map((p: any) => (
                <HStack key={p.placeId} p="8px" bg="discord.input" borderRadius="4px" cursor="pointer" _hover={{ bg: 'brand.500' }} onClick={() => { setOverridePlaceId(p.placeId); updateProfileValue('overridePlaceId', p.placeId); }}>
                  <Box>
                    <Text fontSize="12px" color="discord.text" fontWeight={600}>{p.name || 'Unknown'}</Text>
                    <Text fontSize="11px" color="discord.muted">ID: {p.placeId}</Text>
                  </Box>
                </HStack>
              ))}
            </VStack>
          </Collapse>
          <Box>
            <Text fontSize="12px" color="discord.muted" mb="8px" fontWeight={600}>Override Place ID</Text>
            <Input size="sm" placeholder="Leave blank to use Group/User default" value={overridePlaceId} onChange={(e) => { const n = e.target.value.replace(/\D/g, ''); setOverridePlaceId(n); updateProfileValue('overridePlaceId', n); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="36px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'brand.500' }} />
          </Box>
        </VStack>
      </VStack>
    </Flex>
  );
}
