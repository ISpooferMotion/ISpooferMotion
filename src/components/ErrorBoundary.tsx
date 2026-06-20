import { getVersion } from '@tauri-apps/api/app';
import { type as getOsType, version as getOsVersion } from '@tauri-apps/plugin-os';
import { Component, ErrorInfo, ReactNode } from 'react';

import { useConfigStore } from '../stores/configStore';
import { isTauriRuntime } from '../utils/tauriRuntime';

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

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    void (async () => {
      try {
        const { telemetryEnabled } = useConfigStore.getState().config.general;
        if (!telemetryEnabled) {
          return;
        }

        const appVersion = await getVersion();
        const osName = await getOsType();
        const osVersion = await getOsVersion();

        const baseUrl =
          import.meta.env.VITE_API_BASE_URL === undefined
            ? 'https://ispoofermotion.com'
            : import.meta.env.VITE_API_BASE_URL;

        const payload = {
          errorName: error.name,
          errorMessage: error.message,
          stackTrace: errorInfo.componentStack + '\n\n' + (error.stack || ''),
          appVersion,
          appType: 'V2',
          osInfo: `${osName} ${osVersion}`,
        };

        if (isTauriRuntime()) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          await tauriFetch(`${baseUrl}/api/app-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          await fetch(`${baseUrl}/api/app-errors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
      } catch (e) {
        console.error('Failed to submit crash report:', e);
      }
    })();
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-bg-base text-text-primary p-8 text-center space-y-4 font-sans antialiased">
          <div className="text-red-500 mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Oops, something broke.</h1>
          <p className="text-text-muted max-w-md">
            ISpooferMotion encountered a fatal error and could not continue.{' '}
            {useConfigStore.getState().config.general.telemetryEnabled
              ? 'A crash report has been silently sent to the developers.'
              : 'Crash reporting is disabled.'}
          </p>
          <div className="bg-bg-card border border-border p-4 rounded-xl mt-4 max-w-2xl text-left overflow-auto max-h-48 text-sm w-full font-mono shadow-inner">
            <div className="text-red-400 font-semibold mb-2">
              {this.state.error?.name}: {this.state.error?.message}
            </div>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-3 bg-primary text-primary-content font-semibold rounded-xl hover:bg-primary-hover transition-colors shadow-lg active:scale-95"
          >
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
