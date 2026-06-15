import { useEffect, useRef, useState } from 'react';
import { Box, Flex, VStack, HStack, Text, Button, Input, Switch, Avatar, Divider, InputGroup, InputRightElement } from '@chakra-ui/react';
import { Trash2, Plus, Key } from 'lucide-react';

export default function ProfilesView({ isActive }: { isActive: boolean }) {
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  const [profileName, setProfileName] = useState('');
  const [cookie, setCookie] = useState('');
  const [autoDetectCookie, setAutoDetectCookie] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');

  const [robloxData, setRobloxData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [deleteState, setDeleteState] = useState<'confirm' | null>(null);
  const deleteTimeoutRef = useRef<any>(null);

  useEffect(() => {
    loadProfiles();
    return () => clearTimeout(deleteTimeoutRef.current);
  }, []);

  async function loadProfiles() {
    try {
      const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
      if (secrets) {
        setProfiles(secrets.profiles || {});
        let newActiveId = secrets.activeProfileId;
        if (!secrets.profiles[newActiveId]) {
          const remaining = Object.keys(secrets.profiles);
          if (remaining.length > 0) newActiveId = remaining[0];
        }
        setActiveId(newActiveId);
        applyProfileToState(newActiveId, secrets.profiles);
      }
    } catch (error) {
      console.error('Failed to load profiles', error);
    }
  }

  function applyProfileToState(id: string, allProfiles: any) {
    setDeleteState(null);
    const profile = allProfiles[id];
    if (profile) {
      setProfileName(profile.name || 'Unnamed Profile');
      setCookie(profile.cookie || '');
      setAutoDetectCookie(profile.autoDetectCookie ?? true);
      setGroupId(profile.groupId || '');
      setApiKey(profile.apiKey || '');
      fetchRobloxData(profile.cookie, profile.groupId, id, profile.autoDetectCookie ?? true);
    } else {
      setRobloxData(null);
    }
  }

  async function fetchRobloxData(cookieVal: string, groupIdVal: string, profileId = activeId, autoDetect = autoDetectCookie) {
    if (!cookieVal && !autoDetect) {
      setRobloxData(null);
      return;
    }
    setIsLoading(true);
    try {
      const data = await (window as any).electronAPI?.getRobloxProfile?.({
        cookie: cookieVal,
        groupId: groupIdVal,
        autoDetect,
        profileId,
      });
      setRobloxData(data);
    } catch {
      setRobloxData(null);
    }
    setIsLoading(false);
  }

  const makeUniqueProfileName = (name: string, excludeId: string | null = null) => {
    const baseName = String(name || 'Unnamed Profile').trim() || 'Unnamed Profile';
    const existingNames = new Set(
      Object.entries(profiles)
        .filter(([id]) => id !== excludeId)
        .map(([, profile]) => String(profile.name || '').trim().toLowerCase())
    );
    if (!existingNames.has(baseName.toLowerCase())) return baseName;

    let index = 2;
    let candidate = `${baseName} ${index}`;
    while (existingNames.has(candidate.toLowerCase())) {
      index += 1;
      candidate = `${baseName} ${index}`;
    }
    return candidate;
  };

  const updateProfile = async (updates: any) => {
    if (!activeId) return;
    const normalizedUpdates = { ...updates };
    if (normalizedUpdates.name !== undefined) {
      normalizedUpdates.name = makeUniqueProfileName(normalizedUpdates.name, activeId);
    }
    const newProfiles = { ...profiles };
    newProfiles[activeId] = { ...newProfiles[activeId], ...normalizedUpdates };
    setProfiles(newProfiles);

    if (normalizedUpdates.name !== undefined) setProfileName(normalizedUpdates.name);
    if (normalizedUpdates.cookie !== undefined) setCookie(normalizedUpdates.cookie);
    if (normalizedUpdates.autoDetectCookie !== undefined) setAutoDetectCookie(normalizedUpdates.autoDetectCookie);
    if (normalizedUpdates.groupId !== undefined) setGroupId(normalizedUpdates.groupId);
    if (normalizedUpdates.apiKey !== undefined) setApiKey(normalizedUpdates.apiKey);

    await (window as any).electronAPI?.saveProfileSecrets?.({
      action: 'patchProfile',
      profileId: activeId,
      secrets: normalizedUpdates,
    });

    window.dispatchEvent(new Event('profile-changed'));

    if (normalizedUpdates.cookie !== undefined || normalizedUpdates.groupId !== undefined || normalizedUpdates.autoDetectCookie !== undefined) {
      const p = newProfiles[activeId];
      fetchRobloxData(p.cookie, p.groupId, activeId, p.autoDetectCookie ?? true);
    }
  };

  const createProfile = async () => {
    const newId = `profile_${Date.now()}`;
    const newProfile = {
      name: makeUniqueProfileName('New Profile'),
      cookie: '',
      autoDetectCookie: true,
      apiKey: '',
      groupId: '',
    };
    await (window as any).electronAPI?.saveProfileSecrets?.({
      action: 'saveProfile',
      profileId: newId,
      secrets: newProfile,
    });
    const updatedProfiles = { ...profiles, [newId]: newProfile };
    setProfiles(updatedProfiles);
    // Set active immediately after saving the profile so both writes are grouped
    // as close together as possible. If the app crashes between them, the worst
    // outcome is a saved but non-active profile (recoverable from ProfilesView).
    await (window as any).electronAPI?.saveProfileSecrets?.({ action: 'setActive', profileId: newId }).catch(() => {});
    setActiveId(newId);
    applyProfileToState(newId, updatedProfiles);
    window.dispatchEvent(new Event('profile-changed'));
  };

  const saveApiKey = async () => {
    if (!activeId) return;
    const trimmed = apiKey.trim();
    setApiKey(trimmed);
    if (!trimmed) {
      await updateProfile({ apiKey: '' });
      setApiKeyStatus('API key removed.');
      return;
    }

    setApiKeyStatus('Checking API key…');
    try {
      const result = await (window as any).electronAPI?.validateOpenCloudApiKey?.(trimmed);
      if (!result?.ok) {
        setApiKeyStatus(result?.message || 'API key is invalid.');
        return;
      }
      await updateProfile({ apiKey: trimmed });
      const ownerHint = result.ownerUserId ? ` Detected API key owner: user ${result.ownerUserId}. Uploads will target this user unless a group is set.` : '';
      setApiKeyStatus((result.message || 'API key saved.') + ownerHint);
    } catch (err: any) {
      setApiKeyStatus(`Could not validate API key: ${err.message}`);
    }
  };

  const handleDeleteClick = async () => {
    if (Object.keys(profiles).length <= 1) return;

    if (deleteState !== 'confirm') {
      setDeleteState('confirm');
      deleteTimeoutRef.current = setTimeout(() => setDeleteState(null), 3000);
      return;
    }

    clearTimeout(deleteTimeoutRef.current);
    setDeleteState(null);
    await (window as any).electronAPI?.saveProfileSecrets?.({
      action: 'deleteProfile',
      profileId: activeId,
    });
    loadProfiles();
  };

  const selectProfile = async (id: string) => {
    if (!profiles[id]) return;
    await (window as any).electronAPI?.saveProfileSecrets?.({ action: 'setActive', profileId: id });
    setActiveId(id);
    applyProfileToState(id, profiles);
    window.dispatchEvent(new Event('profile-changed'));
  };

  const profileCount = Object.keys(profiles).length;
  const canDelete = profileCount > 1;

  if (!isActive) return null;

  return (
    <Flex h="100%" w="100%" p="24px" gap="24px" align="stretch">
      {/* Profile List */}
      <Flex direction="column" w="260px" bg="discord.card" borderRadius="8px" p="16px" boxShadow="0 2px 10px rgba(0,0,0,0.1)">
        <Text fontWeight={800} fontSize="12px" color="discord.darkMuted" textTransform="uppercase" mb="12px" letterSpacing="0.5px">Profiles</Text>
        <Box flex={1} overflowY="auto" sx={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-thumb': { bg: 'discord.input', borderRadius: '4px' },
          '&::-webkit-scrollbar-track': { bg: 'transparent' }
        }}>
          <VStack spacing="4px" align="stretch">
            {Object.entries(profiles).map(([id, profile]) => (
              <Button
                key={id}
                variant={id === activeId ? 'solid' : 'ghost'}
                bg={id === activeId ? 'brand.500' : 'transparent'}
                color={id === activeId ? 'brand.contrast' : 'discord.muted'}
                justifyContent="flex-start"
                _hover={{ bg: id === activeId ? 'brand.600' : 'discord.background', color: id === activeId ? 'brand.contrast' : 'discord.text' }}
                onClick={() => selectProfile(id)}
                size="sm"
                borderRadius="4px"
                fontWeight={500}
              >
                {profile.name || 'Unnamed Profile'}
              </Button>
            ))}
          </VStack>
        </Box>
        <Button mt="16px" variant="solid" bg="discord.input" color="discord.muted" _hover={{ bg: 'discord.inputDark', color: 'discord.text' }} leftIcon={<Plus size={16} />} onClick={createProfile} borderRadius="4px" fontSize="13px" h="36px">
          New Profile
        </Button>
      </Flex>

      {/* Profile Details */}
      <Flex direction="column" flex={1} bg="discord.card" borderRadius="8px" p="32px" overflowY="auto" boxShadow="0 2px 10px rgba(0,0,0,0.1)">
        <VStack spacing="32px" align="stretch" maxW="600px" mx="auto" w="100%">
          <HStack justify="space-between">
            <Input
              variant="unstyled"
              value={profileName}
              onChange={(e) => updateProfile({ name: e.target.value })}
              placeholder="Profile Name"
              fontSize="28px"
              fontWeight={800}
              color="discord.text"
              _placeholder={{ color: 'discord.darkMuted' }}
            />
            <Button
              colorScheme={deleteState === 'confirm' ? 'red' : 'gray'}
              variant={deleteState === 'confirm' ? 'solid' : 'ghost'}
              bg={deleteState === 'confirm' ? 'red.500' : 'transparent'}
              color={deleteState === 'confirm' ? 'discord.background' : 'discord.muted'}
              _hover={deleteState === 'confirm' ? { bg: 'discord.text' } : { bg: 'discord.background', color: 'discord.text' }}
              leftIcon={<Trash2 size={16} />}
              disabled={!canDelete}
              onClick={handleDeleteClick}
              size="sm"
              borderRadius="4px"
            >
              {deleteState === 'confirm' ? 'Confirm?' : 'Delete'}
            </Button>
          </HStack>

          <VStack spacing="20px" align="stretch">
            <Box>
              <HStack justify="space-between" mb="8px">
                <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} letterSpacing="0.5px">Roblox Cookie</Text>
                <HStack>
                  <Text fontSize="12px" color="discord.text" fontWeight={500}>Auto Detect</Text>
                  <Switch size="sm" colorScheme="brand" isChecked={autoDetectCookie} onChange={(e) => updateProfile({ autoDetectCookie: e.target.checked })} />
                </HStack>
              </HStack>
              <Input
                type="password"
                placeholder="WARNING: Do not share your cookie"
                value={cookie}
                disabled={autoDetectCookie}
                onChange={(e) => updateProfile({ cookie: e.target.value })}
                bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" fontSize="14px"
                _focus={{ boxShadow: 'none' }}
              />
            </Box>
            
            <Box>
              <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Roblox Group ID</Text>
              <Input
                placeholder="Leave blank for User uploads"
                value={groupId}
                onChange={(e) => updateProfile({ groupId: e.target.value.replace(/\D/g, '') })}
                bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" fontSize="14px"
                _focus={{ boxShadow: 'none' }}
              />
            </Box>

            <Box>
              <Text fontSize="12px" color="discord.darkMuted" textTransform="uppercase" fontWeight={800} mb="8px" letterSpacing="0.5px">Open Cloud API Key</Text>
              <InputGroup size="md">
                <Input
                  type="password"
                  placeholder="Required for Uploads"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setApiKeyStatus('Unsaved changes. Leave the field to validate and save.');
                  }}
                  onBlur={saveApiKey}
                  bg="discord.input" border="none" color="discord.text" borderRadius="4px" h="40px" fontSize="14px" pr="100px"
                  _focus={{ boxShadow: 'none' }}
                />
                <InputRightElement w="100px" h="40px">
                  <Button size="xs" variant="ghost" h="28px" mt="6px" color="discord.muted" _hover={{ bg: 'discord.background', color: 'discord.text' }} onClick={() => (window as any).electronAPI?.openExternal?.('https://create.roblox.com/dashboard/credentials')}>
                    Get Key
                  </Button>
                </InputRightElement>
              </InputGroup>
              {apiKeyStatus && <Text fontSize="12px" color="discord.darkMuted" mt="8px" fontWeight={500}>{apiKeyStatus}</Text>}
            </Box>
          </VStack>

          {(!!cookie || autoDetectCookie) && (
            <HStack bg="discord.input" borderRadius="8px" p="20px" spacing="24px" align="center" mt="8px" border="1px solid" borderColor="discord.border">
              <HStack spacing="16px">
                {robloxData?.user?.avatarUrl ? <Avatar src={robloxData.user.avatarUrl} size="md" /> : <Box w="48px" h="48px" borderRadius="24px" bg="discord.card" />}
                <Box>
                  <Text fontWeight={700} color="discord.text" fontSize="16px">{isLoading ? 'Loading...' : robloxData?.user?.name || 'Invalid Cookie'}</Text>
                  {robloxData?.user && <Text fontSize="13px" color="discord.muted" mt="2px">@{robloxData.user.name} · {robloxData.user.id}</Text>}
                </Box>
              </HStack>
              
              {(groupId || robloxData?.group) && (
                <>
                  <Divider orientation="vertical" h="48px" borderColor="discord.card" />
                  <HStack spacing="16px">
                    {robloxData?.group?.iconUrl ? <Avatar src={robloxData.group.iconUrl} size="md" borderRadius="8px" /> : <Box w="48px" h="48px" borderRadius="8px" bg="discord.card" />}
                    <Box>
                      <Text fontWeight={700} color="discord.text" fontSize="16px">{isLoading ? 'Loading...' : robloxData?.group?.name || 'Invalid Group ID'}</Text>
                      {robloxData?.group && <Text fontSize="13px" color="discord.muted" mt="2px">Group ID: {robloxData.group.id}</Text>}
                    </Box>
                  </HStack>
                </>
              )}
            </HStack>
          )}
        </VStack>
      </Flex>
    </Flex>
  );
}
