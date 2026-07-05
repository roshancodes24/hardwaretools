import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyThemePreference,
  readStoredThemePreference,
  resolveEffectiveTheme,
  storeThemePreference,
  type ThemePreference,
} from "./lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  effectiveTheme: "light" | "dark";
  setPreference: (pref: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredThemePreference()
  );
  const [effectiveTheme, setEffectiveTheme] = useState<"light" | "dark">(() =>
    resolveEffectiveTheme(readStoredThemePreference())
  );

  const setPreference = useCallback((pref: ThemePreference) => {
    storeThemePreference(pref);
    setPreferenceState(pref);
    applyThemePreference(pref);
    setEffectiveTheme(resolveEffectiveTheme(pref));
  }, []);

  useEffect(() => {
    applyThemePreference(preference);
    setEffectiveTheme(resolveEffectiveTheme(preference));

    if (preference !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      applyThemePreference("system");
      setEffectiveTheme(resolveEffectiveTheme("system"));
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo(
    () => ({ preference, effectiveTheme, setPreference }),
    [preference, effectiveTheme, setPreference]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
