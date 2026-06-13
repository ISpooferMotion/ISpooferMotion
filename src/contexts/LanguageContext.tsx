import { create } from 'zustand';

import { getTranslation } from '../utils/i18n';

interface LanguageState {
  lang: string;
  setLang: (lang: string) => void;
  t: (keyPath: string) => string;
}

const getInitialLang = () => {
  const savedLang = localStorage.getItem('language');
  if (savedLang) return savedLang;

  const systemLang = navigator.language.split('-')[0];
  const supported = ['en', 'es', 'ru', 'fr'];
  if (supported.includes(systemLang)) {
    localStorage.setItem('language', systemLang);
    return systemLang;
  }
  return 'en';
};

export const useLanguage = create<LanguageState>((set, get) => ({
  lang: getInitialLang(),
  setLang: (newLang: string) => {
    localStorage.setItem('language', newLang);
    set({ lang: newLang });
  },
  t: (keyPath: string) => getTranslation(get().lang, keyPath),
}));

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};
