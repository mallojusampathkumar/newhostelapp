import React, { useCallback, useEffect, useState } from 'react';
import { get } from '../api.js';
import { useLang } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';
import BubbleHome from './BubbleHome.jsx';
import Money from './Money.jsx';
import People from './People.jsx';
import Alerts from './Alerts.jsx';
import More from './More.jsx';
import Admin from './Admin.jsx';
import SearchOverlay from '../components/SearchOverlay.jsx';

export default function Shell({ user, setUser, onLogout }) {
  const { t } = useLang();
  const { setTheme, isDark } = useTheme();
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'admin' : 'home');
  const [seg, setSeg] = useState(null); // optional sub-section hint when jumping tabs
  const [overview, setOverview] = useState(null);
  const [search, setSearch] = useState(false);

  const refresh = useCallback(() => {
    get('/overview').then(setOverview).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // desktop nicety: Ctrl/⌘+K or "/" opens the global search
  useEffect(() => {
    const h = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // navigate to a tab, optionally straight to a sub-section (e.g. money → dues)
  const go = useCallback((tabKey, segKey = null) => {
    setSeg(segKey);
    setTab(tabKey);
  }, []);

  // one-tap light/dark flip; full palette lives in More → theme picker
  const flipTheme = () => setTheme(isDark ? 'daylight' : 'midnight');

  const dueCount = overview?.totals?.dueTenants || 0;
  const alertCount = (overview?.totals?.openComplaints || 0) + (overview?.unreadNotifications || 0);
  const readonly = user.access?.readonly;

  const tabs = [
    ['home', '🫧', t('navHome')],
    ['money', '💰', t('navMoney'), dueCount],
    ['people', '👥', t('navPeople')],
    ['alerts', '🔔', t('navAlerts'), alertCount],
    ['more', '☰', t('navMore')]
  ];
  if (isAdmin) tabs.splice(4, 0, ['admin', '🛡️', t('adminPanel')]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo" style={{ fontSize: 20 }}><span className="orb" style={{ width: 36, height: 36, fontSize: 19 }}>🏠</span>{t('appName')}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="icon-btn" title={t('searchEverything')} onClick={() => setSearch(true)}>🔍</button>
          <button className="icon-btn" title={t('themeTitle')} onClick={flipTheme}>{isDark ? '☀️' : '🌙'}</button>
          <button className="chip" onClick={() => go('more')}>🙍 {user.name.split(' ')[0]}</button>
        </div>
      </header>

      {readonly && (
        <div className="readonly-banner">🔒 {t('readonlyBanner')}</div>
      )}

      {tab === 'home' && <BubbleHome overview={overview} refreshOverview={refresh} go={go} user={user} />}
      {tab === 'money' && <Money overview={overview} refreshOverview={refresh} initialSeg={seg} />}
      {tab === 'people' && <People overview={overview} refreshOverview={refresh} initialSeg={seg} />}
      {tab === 'alerts' && <Alerts overview={overview} refreshOverview={refresh} initialSeg={seg} />}
      {tab === 'admin' && isAdmin && <Admin />}
      {tab === 'more' && <More overview={overview} user={user} setUser={setUser} onLogout={onLogout} refreshOverview={refresh} />}

      <nav className="bottom-nav">
        {tabs.map(([key, ico, label, badge]) => (
          <button key={key} className={`nav-item ${tab === key ? 'active' : ''}`} onClick={() => go(key)}>
            <span className="ico" style={{ position: 'relative' }}>
              {ico}
              {badge > 0 && <span className="badge">{badge}</span>}
            </span>
            {label}
          </button>
        ))}
      </nav>

      {search && (
        <SearchOverlay
          properties={overview?.properties || []}
          refreshOverview={refresh}
          onClose={() => setSearch(false)}
        />
      )}
    </div>
  );
}
