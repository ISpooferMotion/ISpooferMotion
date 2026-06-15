import './index.css';
import './utils/debugLogger';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigProvider } from './contexts/ConfigContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { StudioConnectionProvider } from './contexts/StudioConnectionContext';
import { ThemeProvider } from './contexts/ThemeContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // we really don't want it randomly refetching when users alt-tab back into the app
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const savedTheme = localStorage.getItem('theme') || 'dark';
// force the theme early on so we don't flashbang the user with light mode on load
if (savedTheme === 'dark' || savedTheme === 'custom') {
  document.documentElement.classList.add('dark');
} else {
  document.documentElement.classList.remove('dark');
}

// This prevents native tooltips from showing up and overlapping our custom UI tooltips
function TitleAttributeGuard({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const clearTitles = (root: ParentNode) => {
      root.querySelectorAll?.('[title]').forEach((el) => el.removeAttribute('title'));
    };
    clearTitles(document);
    // kinda hacky, but this observer catches any new elements that get added dynamically and strips their titles too
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          mutation.target.removeAttribute('title');
        }
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            node.removeAttribute('title');
            clearTitles(node);
          }
        });
      });
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);

  return children;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <ConfigProvider>
        <StudioConnectionProvider>
          <ThemeProvider>
            <TitleAttributeGuard>
              <main className="text-text-primary bg-bg-base min-h-screen h-full font-sans transition-colors duration-300">
                <QueryClientProvider client={queryClient}>
                  <ErrorBoundary>
                    <App />
                  </ErrorBoundary>
                  {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
                </QueryClientProvider>
              </main>
            </TitleAttributeGuard>
          </ThemeProvider>
        </StudioConnectionProvider>
      </ConfigProvider>
    </LanguageProvider>
  </React.StrictMode>,
);
