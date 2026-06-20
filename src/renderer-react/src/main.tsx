import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, extendTheme } from '@chakra-ui/react';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Discord Onyx Theme Settings for Chakra UI
function getContrastColor(hex: string) {
  const hexCode = hex.replace('#', '');
  const r = parseInt(hexCode.substr(0, 2), 16);
  const g = parseInt(hexCode.substr(2, 2), 16);
  const b = parseInt(hexCode.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

function getBaseTheme(accentHex: string) {
  const contrastText = getContrastColor(accentHex);
  return extendTheme({
    config: {
      initialColorMode: 'dark',
      useSystemColorMode: false,
    },
    colors: {
      brand: {
        50: `${accentHex}10`,
        100: `${accentHex}20`,
        200: `${accentHex}40`,
        300: `${accentHex}60`,
        400: `${accentHex}80`,
        500: accentHex,
        600: `${accentHex}e0`, // darken later if needed
        700: `${accentHex}c0`,
        800: `${accentHex}a0`,
        900: `${accentHex}80`,
        contrast: contrastText,
      },
      discord: {
        text: '#dbdee1',
        muted: '#949ba4',
        darkMuted: '#4e5058',
        border: 'rgba(255, 255, 255, 0.06)',
        card: '#2b2d31',
        input: '#1e1f22',
        inputDark: '#111214',
        background: 'transparent',
        sidebar: '#111214',
        topbar: 'transparent',
      }
    },
    fonts: {
      heading: '"Outfit", system-ui, "Segoe UI", Roboto, sans-serif',
      body: '"Inter", system-ui, "Segoe UI", Roboto, sans-serif',
    },
    styles: {
      global: {
        body: {
          bg: 'transparent',
          color: 'discord.text',
        },
      },
    },
    components: {
      Button: {
        baseStyle: {
          fontWeight: 600,
          borderRadius: '10px',
        },
        variants: {
          solid: (props: any) => {
            if (props.colorScheme === 'brand') {
              return {
                bg: 'brand.500',
                color: 'brand.contrast',
                boxShadow: `0 4px 14px 0 ${accentHex}40`,
                _hover: { bg: 'brand.600', transform: 'translateY(-1px)', boxShadow: `0 6px 20px 0 ${accentHex}60`, _disabled: { bg: 'brand.500', transform: 'none' } },
                _active: { bg: 'brand.700', transform: 'translateY(1px)' }
              };
            }
            return {
              bg: 'rgba(255,255,255,0.05)',
              _hover: { bg: 'rgba(255,255,255,0.1)' }
            };
          }
        }
      },
      Badge: {
        baseStyle: {
          color: 'brand.contrast',
          borderRadius: '6px',
        }
      },
      Input: {
        variants: {
          outline: {
            field: {
              border: '1px solid',
              borderColor: 'discord.border',
              bg: 'discord.input',
              _hover: { borderColor: 'rgba(255,255,255,0.15)' },
              _focus: { borderColor: 'brand.500', boxShadow: 'none' }
            }
          }
        }
      }
    },
  });
}

function DynamicThemeProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColor] = useState('#10b981'); // Default Emerald Green

  useEffect(() => {
    async function fetchColor() {
      try {
        const secrets = await (window as any).electronAPI?.loadProfileSecrets?.();
        if (secrets && secrets.activeProfileId && secrets.profiles) {
          const p = secrets.profiles[secrets.activeProfileId];
          if (p && p.colorR !== undefined && p.colorG !== undefined && p.colorB !== undefined) {
            const hex = '#' + [p.colorR, p.colorG, p.colorB].map((x: number) => x.toString(16).padStart(2, '0')).join('');
            setAccentColor(hex);
          }
        }
      } catch (e) {
        console.error('Failed to load accent color', e);
      }
    }
    
    fetchColor();
    window.addEventListener('profile-changed', fetchColor);
    
    const handlePreview = (e: any) => setAccentColor(e.detail.hex);
    window.addEventListener('preview-color-changed', handlePreview);

    return () => {
      window.removeEventListener('profile-changed', fetchColor);
      window.removeEventListener('preview-color-changed', handlePreview);
    };
  }, []);

  const theme = React.useMemo(() => getBaseTheme(accentColor), [accentColor]);

  return (
    <ChakraProvider theme={theme}>
      {children}
    </ChakraProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DynamicThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </DynamicThemeProvider>
  </React.StrictMode>
);
