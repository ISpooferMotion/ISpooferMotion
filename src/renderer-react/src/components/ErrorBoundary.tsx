import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Flex, Text, Button, Box } from '@chakra-ui/react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public async componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    try {
      const appVersion = await (window as any).electronAPI?.getAppVersion?.() || '1.0.0';
      const osInfo = await (window as any).electronAPI?.getOsInfo?.() || 'Unknown OS';

      await fetch('https://ispoofermotion.com/api/crash-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          errorName: error.name,
          errorMessage: error.message,
          stackTrace: errorInfo.componentStack + '\n\n' + (error.stack || ''),
          appVersion,
          appType: 'V1',
          osInfo,
        }),
      });
    } catch (e) {
      console.error('Failed to submit crash report:', e);
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Flex direction="column" align="center" justify="center" h="100vh" w="100vw" bg="discord.background" color="discord.text" p={8} textAlign="center">
          <Text fontSize="3xl" fontWeight="bold" mb={4}>Oops, something broke.</Text>
          <Text color="discord.muted" maxW="md" mb={6}>
            ISpooferMotion encountered a fatal error and could not continue. 
            A crash report has been silently sent to the developers.
          </Text>
          <Box bg="discord.card" p={4} borderRadius="md" maxW="2xl" w="full" textAlign="left" overflow="auto" maxH="48" fontFamily="monospace" fontSize="sm" mb={6}>
            <Text color="red.400" fontWeight="semibold">{this.state.error?.name}: {this.state.error?.message}</Text>
          </Box>
          <Button colorScheme="brand" onClick={() => window.location.reload()}>
            Reload Application
          </Button>
        </Flex>
      );
    }

    return this.props.children;
  }
}
