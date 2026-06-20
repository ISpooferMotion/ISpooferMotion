import { useEffect, useState } from 'react';
import { Box, Flex, VStack, IconButton, Tooltip } from '@chakra-ui/react';
import { Activity, User, Settings2, Heart, Wand2 } from 'lucide-react';

function formatVersionTag(version: string) {
  const value = String(version || '1.3.13-hotfix.2').replace(/^-?v/i, '');
  return `v${value.replace(/-hotfix\./i, '.hotfix.')}`;
}

interface SidebarProps {
  currentView: string;
  setCurrentView: (view: string) => void;
}

export default function Sidebar({ currentView, setCurrentView }: { currentView: string, setCurrentView: (v: string) => void }) {
  const ServerButton = ({ id, icon: Icon, color = "discord.muted" }: any) => {
    const isActive = currentView === id;
    return (
      <Box position="relative" w="48px" h="48px">
        {isActive && (
          <Box position="absolute" left="-16px" top="4px" bottom="4px" w="4px" bg="discord.text" borderRadius="0 4px 4px 0" />
        )}
        <Tooltip label={id.charAt(0).toUpperCase() + id.slice(1)} placement="right" hasArrow bg="discord.inputDark" color="discord.text" borderRadius="4px" fontSize="13px" fontWeight={600} px="12px" py="6px">
          <IconButton
            aria-label={id}
            icon={<Icon size={24} strokeWidth={isActive ? 2.5 : 2} />}
            w="48px" h="48px"
            bg={isActive ? 'brand.500' : 'discord.card'}
            color={isActive ? 'brand.contrast' : color}
            borderRadius={isActive ? '16px' : '24px'}
            transition="all 0.2s"
            _hover={{
              bg: isActive ? 'brand.500' : 'brand.500',
              color: 'brand.contrast',
              borderRadius: '16px'
            }}
            onClick={() => setCurrentView(id)}
          />
        </Tooltip>
      </Box>
    );
  };

  return (
    <Flex direction="column" h="100%" bg="discord.sidebar" backdropFilter="blur(20px)" borderRight="1px solid" borderColor="discord.border" align="center" py="12px" gap="8px" sx={{ WebkitAppRegion: 'drag' } as any}>
      <VStack spacing="8px" flex={1} sx={{ WebkitAppRegion: 'no-drag' } as any}>
        <ServerButton id="spoofer" icon={Wand2} />
        <ServerButton id="activity" icon={Activity} />
        <ServerButton id="profiles" icon={User} />
        
        <Box w="32px" h="2px" bg="discord.card" my="8px" borderRadius="2px" />
        
        <ServerButton id="settings" icon={Settings2} />
      </VStack>
    </Flex>
  );
}
