import React, { createContext, useContext, useState } from "react";
import en from "../i18n/en.json";
import hi from "../i18n/hi.json";
import ta from "../i18n/ta.json";

export type Lang = "en" | "hi" | "ta";
type Translations = Record<string, string>;

const translations: Record<Lang, Translations> = { en, hi, ta };

interface LanguageContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, fallback?: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: "en",
  setLang: () => {},
  t: (k, f) => f ?? k,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("anebilin_lang") as Lang) ?? "en");

  const setLang = (l: Lang) => {
    localStorage.setItem("anebilin_lang", l);
    setLangState(l);
  };

  const t = (key: string, fallback?: string): string => {
    const dict = translations[lang] || translations.en;
    return dict[key] ?? fallback ?? translations.en[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
export const useTranslation = () => useContext(LanguageContext);
