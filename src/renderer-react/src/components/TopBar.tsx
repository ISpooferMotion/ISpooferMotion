import { useEffect, useState } from 'react';
import { Flex, Box, Text, IconButton, Menu, MenuButton, MenuList, MenuItem, Button, Tooltip, Image } from '@chakra-ui/react';
import { Minus, X, ChevronDown } from 'lucide-react';
import appIcon from '../assets/app_icon.png';

function formatVersionTag(version: string) {
  const value = String(version || '1.3.15').replace(/^-?v/i, '');
  return `v${value.replace(/-hotfix\./i, '.hotfix.')}`;
}

const DiscordIcon = (props: any) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" {...props}>
    <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.03.03.03.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.02.06.03.09.02c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"/>
  </svg>
);

export default function TopBar() {
  const [profilesInfo, setProfilesInfo] = useState({ activeId: null as string | null, profiles: {} as Record<string, any> });
  const [version, setVersion] = useState('');

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
        if (secrets) {
          setProfilesInfo({
            activeId: secrets.activeProfileId,
            profiles: secrets.profiles || {},
          });
        }
      } catch (err) {
        console.error('Failed to load profiles for top bar', err);
      }
    };
    fetchProfiles();
    window.addEventListener('profile-changed', fetchProfiles);

    const fetchMeta = async () => {
      try {
        const appVersion = await (window as any).electronAPI?.getAppVersion?.();
        if (appVersion) setVersion(formatVersionTag(appVersion));
      } catch (err) {
        console.error('Failed to get app version for top bar', err);
      }
    };
    fetchMeta();

    return () => window.removeEventListener('profile-changed', fetchProfiles);
  }, []);

  const activeProfileName = profilesInfo.activeId && profilesInfo.profiles[profilesInfo.activeId] 
    ? profilesInfo.profiles[profilesInfo.activeId].name || 'Profile 1'
    : 'Profile 1';

  return (
    <Flex h="100%" pl="16px" justify="space-between" align="center" sx={{ WebkitAppRegion: 'drag' } as any} borderBottom="1px solid" borderColor="discord.border" bg="discord.topbar">
      <Flex gap="12px" align="center">
        <Image src={appIcon} boxSize="20px" borderRadius="4px" />
        <Text fontWeight={800} fontSize="13px" color="discord.text" letterSpacing="0.5px" textTransform="uppercase">ISpooferMotion</Text>
        <Text fontSize="11px" color="discord.darkMuted" letterSpacing="0.5px" pt="2px" fontWeight={600}>{version}</Text>
      </Flex>

      <Flex align="center" sx={{ WebkitAppRegion: 'no-drag' } as any} h="100%">
        <Menu placement="bottom-end">
          <MenuButton as={Button} size="sm" variant="ghost" rightIcon={<ChevronDown size={14} />} color="discord.muted" _hover={{ bg: 'discord.card', color: 'discord.text' }} _active={{ bg: 'discord.card' }} mr="8px" h="28px" px="12px" fontSize="12px" borderRadius="4px">
            {activeProfileName}
          </MenuButton>

          <MenuList bg="discord.inputDark" borderColor="discord.border" zIndex={10} p="8px" borderRadius="8px" boxShadow="0 8px 16px rgba(0,0,0,0.24)">
            <Box px="12px" py="8px"><Text fontSize="11px" fontWeight={800} color="discord.darkMuted" textTransform="uppercase" letterSpacing="0.5px">Profiles</Text></Box>
            {Object.entries(profilesInfo.profiles).map(([id, profile]: [string, any]) => (
              <MenuItem
                key={id}
                bg="transparent"
                _hover={{ bg: 'brand.500', color: 'brand.contrast', borderRadius: '4px' }}
                onClick={async () => {
                  await (window as any).electronAPI?.saveProfileSecrets?.({
                    action: 'setActive',
                    profileId: id,
                  });
                  setProfilesInfo((prev) => ({ ...prev, activeId: id }));
                  window.dispatchEvent(new Event('profile-changed'));
                }}
                px="12px" py="8px" mb="2px"
                color="discord.muted"
              >
                <Text fontSize="13px" fontWeight={500}>{profile.name || 'Unnamed Profile'}</Text>
              </MenuItem>
            ))}
          </MenuList>
        </Menu>

        <Tooltip label="Discord" placement="bottom" hasArrow bg="discord.inputDark" color="discord.muted" borderRadius="4px" fontSize="12px" px="10px" py="4px">
          <IconButton 
            aria-label="Discord"
            variant="ghost" 
            size="sm"
            h="100%" w="40px" borderRadius="0"
            color="discord.darkMuted"
            _hover={{ bg: 'discord.card', color: '#5865F2' }}
            onClick={() => (window as any).electronAPI?.openExternal?.('https://discord.gg/d5cJzAURBH')}
            icon={<DiscordIcon />}
          />
        </Tooltip>

        <IconButton 
          aria-label="Minimize"
          variant="ghost" 
          size="sm" 
          h="100%" w="46px" borderRadius="0"
          color="discord.darkMuted"
          _hover={{ bg: 'discord.card', color: 'discord.text' }}
          onClick={() => (window as any).electronAPI?.minimize?.()}
          icon={<Minus size={18} strokeWidth={2} />}
        />

        <IconButton 
          aria-label="Close"
          variant="ghost" 
          size="sm" 
          h="100%" w="46px" borderRadius="0"
          color="discord.darkMuted"
          _hover={{ bg: '#ed4245', color: '#fff' }}
          onClick={() => (window as any).electronAPI?.close?.()}
          icon={<X size={18} strokeWidth={2} />}
        />
      </Flex>
    </Flex>
  );
}
