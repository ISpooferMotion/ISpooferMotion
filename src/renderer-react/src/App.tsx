import { useState } from 'react';
import { Flex, Box } from '@chakra-ui/react';
import DevConsoleGate from './components/DevConsoleGate';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ActivityView from './views/ActivityView';
import ProfilesView from './views/ProfilesView';
import SettingsView from './views/SettingsView';
import SpooferView from './views/SpooferView';

export default function App() {
  const [currentView, setCurrentView] = useState('spoofer');

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
