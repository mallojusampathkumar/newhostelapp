import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { put, getToken } from './api.js';

/* StaySathi theme engine.
   Each theme is a full mood: accent colours, background aurora and light/dark
   surfaces. Applied by stamping data-theme on <html>; index.css holds the
   variable overrides. Choice persists in localStorage and (when logged in)
   on the user profile so it follows the owner across devices. */

export const THEMES = [
  { id: 'daylight', icon: '☀️', name: 'Daylight', dark: false, swatch: ['#6c5ce7', '#f3f5fc'] },
  { id: 'midnight', icon: '🌙', name: 'Midnight', dark: true,  swatch: ['#8e7bff', '#12142b'] },
  { id: 'ocean',    icon: '🌊', name: 'Ocean',    dark: false, swatch: ['#0891b2', '#eefafc'] },
  { id: 'sunset',   icon: '🌅', name: 'Sunset',   dark: false, swatch: ['#f43f5e', '#fff5f0'] },
  { id: 'forest',   icon: '🌿', name: 'Forest',   dark: false, swatch: ['#16a34a', '#f2faf3'] },
  { id: 'royal',    icon: '👑', name: 'Royal',    dark: true,  swatch: ['#e0b34c', '#1a1030'] }
];

const ThemeContext = createContext({ theme: 'daylight', setTheme: () => {}, isDark: false });

function apply(id) {
  document.documentElement.setAttribute('data-theme', id);
  // keep the phone status bar in tune with the app background
  const dark = THEMES.find(x => x.id === id)?.dark;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = dark ? '#12142b' : '#f3f5fc';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    const saved = localStorage.getItem('ss_theme');
    return THEMES.some(x => x.id === saved) ? saved : 'daylight';
  });

  useEffect(() => { apply(theme); }, [theme]);

  const setTheme = useCallback((id) => {
    if (!THEMES.some(x => x.id === id)) return;
    localStorage.setItem('ss_theme', id);
    setThemeState(id);
    if (getToken()) put('/me', { theme: id }).catch(() => { /* offline ok */ });
  }, []);

  const isDark = !!THEMES.find(x => x.id === theme)?.dark;
  return <ThemeContext.Provider value={{ theme, setTheme, isDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme() { return useContext(ThemeContext); }
