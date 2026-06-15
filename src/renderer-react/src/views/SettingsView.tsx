import { useEffect, useRef, useState } from 'react';
import { Box, Flex, VStack, HStack, Text, Button, Switch, Input, NumberInput, NumberInputField, NumberInputStepper, NumberIncrementStepper, NumberDecrementStepper, Collapse } from '@chakra-ui/react';
import { Paintbrush, Bell, UploadCloud, HardDrive, Trash2, FolderSearch } from 'lucide-react';

function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export default function SettingsView({ isActive }: { isActive: boolean }) {
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState(true);
  const [renameToggle, setRenameToggle] = useState(false);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [renameSuffix, setRenameSuffix] = useState('');
  const [renameFind, setRenameFind] = useState('');
  const [renameReplace, setRenameReplace] = useState('');
  const [concurrent, setConcurrent] = useState(false);
  const [maxConcurrentDownload, setMaxConcurrentDownload] = useState(32);
  const [maxConcurrent, setMaxConcurrent] = useState(12);
  const [uploadRetries, setUploadRetries] = useState(3);
  const [uploadRetryDelay, setUploadRetryDelay] = useState(2000);
  const [shareCacheData, setShareCacheData] = useState(true);

  const [colorHex, setColorHex] = useState('#10b981');
  const [uninstallStatus, setUninstallStatus] = useState('');

  async function fetchProfile() {
    try {
      const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
      if (!secrets) return;
      setActiveProfileId(secrets.activeProfileId);
      const profile = secrets.profiles[secrets.activeProfileId] || {};

      setNotifications(profile.notifications ?? true);
      setRenameToggle(profile.renameToggle ?? false);
      setRenamePrefix(profile.renamePrefix ?? '');
      setRenameSuffix(profile.renameSuffix ?? '');
      setRenameFind(profile.renameFind ?? '');
      setRenameReplace(profile.renameReplace ?? '');
      setConcurrent(profile.concurrent ?? true);
      setMaxConcurrentDownload(profile.maxConcurrentDownloads ?? 32);
      setMaxConcurrent(profile.maxConcurrentUploads ?? 12);
      setUploadRetries(profile.uploadRetries ?? 3);
      setUploadRetryDelay(profile.uploadRetryDelay ?? 2000);
      setShareCacheData(profile.shareCacheData ?? true);

      if (profile.colorR !== undefined) {
        const hex = rgbToHex(profile.colorR, profile.colorG, profile.colorB);
        setColorHex(hex);
        if (colorInputRef.current) colorInputRef.current.value = hex;
      }
    } catch (error) {
      console.error('Failed to load settings profile', error);
    }
  }

  useEffect(() => {
    fetchProfile();
    const handler = () => fetchProfile();
    window.addEventListener('profile-changed', handler);
    return () => window.removeEventListener('profile-changed', handler);
  }, []);

  async function updateSetting(key: string, val: any) {
    if (!activeProfileId) return;
    try {
      await (window as any).electronAPI?.saveProfileSecrets?.({
        action: 'patchProfile',
        profileId: activeProfileId,
        secrets: { [key]: val },
      });
    } catch (error) {
      console.error('Failed to update setting', error);
    }
  }

  const updateTimeoutRef = useRef<any>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  function handleColorChange(hex: string) {
    if (updateTimeoutRef.current) clearTimeout(updateTimeoutRef.current);
    updateTimeoutRef.current = setTimeout(async () => {
      window.dispatchEvent(new CustomEvent('preview-color-changed', { detail: { hex } }));
      const rgb = hexToRgb(hex);
      if (rgb && activeProfileId) {
        await updateSetting('colorR', rgb.r);
        await updateSetting('colorG', rgb.g);
        await updateSetting('colorB', rgb.b);
        window.dispatchEvent(new Event('profile-changed'));
      }
    }, 300);
  }

  const uninstallApp = async () => {
    if (!window.confirm('Are you sure you want to uninstall ISpooferMotion? This will delete all your settings, profiles, and data.')) return;
    setUninstallStatus('Starting uninstaller...');
    try {
      const result = await (window as any).electronAPI?.uninstallApp?.();
      if (result === true || result?.ok) {
        setUninstallStatus(result?.message || 'Uninstaller started.');
        return;
      }
      setUninstallStatus(result?.message || 'Could not start the uninstaller.');
    } catch (error: any) {
      setUninstallStatus(error.message || 'Could not start the uninstaller.');
    }
  };

  if (!isActive) return null;

  return (
    <Box position="absolute" inset={0} zIndex={100} bg="discord.background" overflowY="auto">
      <Flex h="100%" justify="center" align="flex-start" wrap="nowrap">
        {/* Settings Content */}
        <VStack p="48px" flex={1} maxW="780px" spacing="40px" align="stretch" sx={{
          '&::-webkit-scrollbar': { width: '8px' },
          '&::-webkit-scrollbar-thumb': { bg: 'discord.card', borderRadius: '4px' },
          '&::-webkit-scrollbar-track': { bg: 'transparent' }
        }}>
          <Text fontWeight={800} fontSize="28px" color="discord.text" mb="8px">App Preferences</Text>

          <VStack spacing="20px" align="stretch">
            <HStack mb="-8px"><Paintbrush size={18} color="discord.muted" /><Text fontWeight={800} color="discord.text" fontSize="16px">Appearance</Text></HStack>
            <Box h="1px" w="100%" bg="discord.border" />
            <HStack justify="space-between" align="center" bg="discord.card" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border">
              <Text fontSize="14px" color="discord.text" fontWeight={500}>Accent Color</Text>
              <input 
                ref={colorInputRef}
                type="color" 
                defaultValue={colorHex} 
                onChange={(e) => handleColorChange(e.target.value)}
                style={{ width: '60px', height: '30px', padding: 0, border: '1px solid #1e1f22', cursor: 'pointer', background: 'transparent', borderRadius: '4px' }}
              />
            </HStack>
          </VStack>

          <VStack spacing="20px" align="stretch">
            <HStack mb="-8px"><Bell size={18} color="discord.muted" /><Text fontWeight={800} color="discord.text" fontSize="16px">Notifications</Text></HStack>
            <Box h="1px" w="100%" bg="discord.border" />
            <HStack justify="space-between" align="center" bg="discord.card" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border">
              <Text fontSize="14px" color="discord.text" fontWeight={500}>Enable Desktop Notifications</Text>
              <Switch
                colorScheme="brand"
                isChecked={notifications}
                onChange={(e) => {
                  setNotifications(e.target.checked);
                  updateSetting('notifications', e.target.checked);
                }}
              />
            </HStack>
          </VStack>

          <VStack spacing="20px" align="stretch">
            <HStack mb="-8px"><UploadCloud size={18} color="discord.muted" /><Text fontWeight={800} color="discord.text" fontSize="16px">Upload Settings</Text></HStack>
            <Box h="1px" w="100%" bg="discord.border" />
            
            <HStack spacing="16px" p="20px" bg="discord.card" borderRadius="8px" align="stretch" border="1px solid" borderColor="discord.border">
              <Box flex={1}>
                <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Retries</Text>
                <NumberInput size="sm" min={1} max={10} value={uploadRetries} onChange={(_, val) => { setUploadRetries(val || 3); updateSetting('uploadRetries', val || 3); }}>
                  <NumberInputField bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                  <NumberInputStepper><NumberIncrementStepper border="none" color="discord.muted" /><NumberDecrementStepper border="none" color="discord.muted" /></NumberInputStepper>
                </NumberInput>
              </Box>
              <Box flex={1}>
                <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Delay (ms)</Text>
                <NumberInput size="sm" min={1000} step={1000} value={uploadRetryDelay} onChange={(_, val) => { setUploadRetryDelay(val || 2000); updateSetting('uploadRetryDelay', val || 2000); }}>
                  <NumberInputField bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                  <NumberInputStepper><NumberIncrementStepper border="none" color="discord.muted" /><NumberDecrementStepper border="none" color="discord.muted" /></NumberInputStepper>
                </NumberInput>
              </Box>
            </HStack>
            
            <HStack justify="space-between" align="center" bg="discord.card" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border">
              <Text fontSize="14px" color="discord.text" fontWeight={500}>Rename on Upload</Text>
              <Switch colorScheme="brand" isChecked={renameToggle} onChange={(e) => { setRenameToggle(e.target.checked); updateSetting('renameToggle', e.target.checked); }} />
            </HStack>
            
            <Collapse in={renameToggle} animateOpacity>
              <VStack spacing="16px" p="20px" bg="discord.card" borderRadius="8px" align="stretch" border="1px solid" borderColor="discord.border">
                <Box>
                  <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Name Prefix</Text>
                  <Input size="sm" value={renamePrefix} onChange={(e) => { setRenamePrefix(e.target.value); updateSetting('renamePrefix', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                </Box>
                <Box>
                  <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Name Suffix</Text>
                  <Input size="sm" value={renameSuffix} onChange={(e) => { setRenameSuffix(e.target.value); updateSetting('renameSuffix', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                </Box>
                <HStack spacing="16px">
                  <Box flex={1}>
                    <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Find in name</Text>
                    <Input size="sm" value={renameFind} onChange={(e) => { setRenameFind(e.target.value); updateSetting('renameFind', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                  </Box>
                  <Box flex={1}>
                    <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Replace with</Text>
                    <Input size="sm" value={renameReplace} onChange={(e) => { setRenameReplace(e.target.value); updateSetting('renameReplace', e.target.value); }} bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                  </Box>
                </HStack>
              </VStack>
            </Collapse>

            <HStack justify="space-between" align="center" bg="discord.card" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border">
              <Text fontSize="14px" color="discord.text" fontWeight={500}>Concurrency</Text>
              <Switch colorScheme="brand" isChecked={concurrent} onChange={(e) => { setConcurrent(e.target.checked); updateSetting('concurrent', e.target.checked); }} />
            </HStack>

            <Collapse in={concurrent} animateOpacity>
              <HStack spacing="16px" p="20px" bg="discord.card" borderRadius="8px" align="stretch" border="1px solid" borderColor="discord.border">
                <Box flex={1}>
                  <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Max Download Threads</Text>
                  <NumberInput size="sm" min={2} max={50} value={maxConcurrentDownload} onChange={(_, val) => { setMaxConcurrentDownload(val || 32); updateSetting('maxConcurrentDownloads', val || 32); }}>
                    <NumberInputField bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                    <NumberInputStepper><NumberIncrementStepper border="none" color="discord.muted" /><NumberDecrementStepper border="none" color="discord.muted" /></NumberInputStepper>
                  </NumberInput>
                </Box>
                <Box flex={1}>
                  <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Max Upload Threads</Text>
                  <NumberInput size="sm" min={2} max={50} value={maxConcurrent} onChange={(_, val) => { setMaxConcurrent(val || 12); updateSetting('maxConcurrentUploads', val || 12); }}>
                    <NumberInputField bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" _focus={{ boxShadow: 'none', border: '1px solid', borderColor: 'discord.muted' }} />
                    <NumberInputStepper><NumberIncrementStepper border="none" color="discord.muted" /><NumberDecrementStepper border="none" color="discord.muted" /></NumberInputStepper>
                  </NumberInput>
                </Box>
              </HStack>
            </Collapse>

            <HStack justify="space-between" align="center" bg="discord.card" p="16px" borderRadius="8px" border="1px solid" borderColor="discord.border">
              <Box>
                <Text fontSize="14px" color="discord.text" fontWeight={500}>Share Cache Data</Text>
                <Text fontSize="12px" color="discord.muted" mt="2px">Help improve asset discovery by sharing resolved asset/place ID pairs with ISpooferMotion servers.</Text>
              </Box>
              <Switch
                colorScheme="brand"
                isChecked={shareCacheData}
                onChange={(e) => {
                  setShareCacheData(e.target.checked);
                  updateSetting('shareCacheData', e.target.checked);
                }}
              />
            </HStack>
          </VStack>

          <VStack spacing="20px" align="stretch" mt="16px">
            <HStack mb="-8px"><HardDrive size={18} color="discord.muted" /><Text fontWeight={800} color="discord.text" fontSize="16px">System</Text></HStack>
            <Box h="1px" w="100%" bg="discord.border" />
            <HStack spacing="12px">
              <Button size="sm" bg="discord.card" color="discord.text" border="1px solid" borderColor="discord.border" _hover={{ bg: 'discord.input', color: 'discord.text' }} onClick={async () => await (window as any).electronAPI?.clearAppCache?.()} h="36px" px="16px" borderRadius="4px" leftIcon={<Trash2 size={16} />}>Clear App Data</Button>
              <Button size="sm" variant="ghost" bg="discord.card" color="discord.text" _hover={{ bg: 'discord.input' }} onClick={() => (window as any).electronAPI?.openDataFolder?.()} h="36px" px="16px" borderRadius="4px" leftIcon={<FolderSearch size={16} />}>Open Data Folder</Button>
              <Button size="sm" variant="ghost" bg="discord.card" color="discord.text" _hover={{ bg: 'discord.input' }} onClick={() => (window as any).electronAPI?.openLogsFolder?.()} h="36px" px="16px" borderRadius="4px" leftIcon={<FolderSearch size={16} />}>Open Logs Folder</Button>
            </HStack>
          </VStack>

        </VStack>
      </Flex>
    </Box>
  );
}
