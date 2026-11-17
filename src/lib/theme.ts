/** Global light/dark preference, shared by the dashboard and every editor. */
import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark";

const KEY = "mindboard:theme";
const EVENT = "mindboard:theme-change";

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setThemePreference(theme: ThemePreference) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
  applyDocumentTheme(theme);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function applyDocumentTheme(theme: ThemePreference) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#121212" : "#ffffff");
}

export function useThemePreference() {
  const [theme, setTheme] = useState(getThemePreference);
  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<ThemePreference>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        const next = getThemePreference();
        applyDocumentTheme(next);
        setTheme(next);
      }
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return theme;
}
