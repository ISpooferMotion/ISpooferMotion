import { useState, useEffect } from 'react';
import { Flex, Box, Text } from '@chakra-ui/react';
import DevConsoleGate from './components/DevConsoleGate';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ActivityView from './views/ActivityView';
import ProfilesView from './views/ProfilesView';
import SettingsView from './views/SettingsView';
import SpooferView from './views/SpooferView';

export default function App() {
  const [currentView, setCurrentView] = useState('spoofer');
  const [maintenance, setMaintenance] = useState({ mode: false, message: '' });

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('https://ispoofermotion.com/api/config');
        if (res.ok) {
          const data = await res.json();
          if (data.maintenanceMode) {
            setMaintenance({ mode: true, message: data.maintenanceMessage });
          }
        }
      } catch (e) {
        console.error('Failed to fetch config:', e);
      }
    };
    fetchConfig();
  }, []);

  if (maintenance.mode) {
    return (
      <Flex direction="column" align="center" justify="center" h="100vh" w="100vw" bg="discord.background" color="discord.text" p={8} textAlign="center">
        <Text fontSize="3xl" fontWeight="bold" mb={4}>Maintenance Break</Text>
        <Text color="discord.muted" maxW="md">
          {maintenance.message || "ISpooferMotion is currently down for maintenance. Please check back later!"}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex h="100vh" w="100vw" overflow="hidden">
      <Box w="72px" bg="discord.sidebar" flexShrink={0}>
        <Sidebar currentView={currentView} setCurrentView={setCurrentView} />
      </Box>

      <Flex flex={1} direction="column" bg="discord.background" overflow="hidden">
        <Box h="48px" flexShrink={0} w="100%">
          <TopBar />
        </Box>
        <Box flex={1} position="relative" overflow="hidden">
          <SpooferView isActive={currentView === 'spoofer'} />
          <ActivityView isActive={currentView === 'activity'} />
          <ProfilesView isActive={currentView === 'profiles'} />
          <SettingsView isActive={currentView === 'settings'} />
        </Box>
      </Flex>

      <DevConsoleGate />
    </Flex>
  );
}
