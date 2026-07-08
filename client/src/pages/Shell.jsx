import React, { useCallback, useEffect, useState } from 'react';
import { get } from '../api.js';
import { useLang } from '../i18n.jsx';
import BubbleHome from './BubbleHome.jsx';
import Money from './Money.jsx';
import People from './People.jsx';
import Alerts from './Alerts.jsx';
import More from './More.jsx';

export default function Shell({ user, setUser, onLogout }) {
  const { t } = useLang();
  const [tab, setTab] = useState('home');
  const [seg, setSeg] = useState(null); // optional sub-section hint when jumping tabs
  const [overview, setOverview] = useState(null);

  const refresh = useCallback(() => {
    get('/overview').then(setOverview).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // navigate to a tab, optionally straight to a sub-section (e.g. money → dues)
  const go = useCallback((tabKey, segKey = null) => {
    setSeg(segKey);
    setTab(tabKey);
  }, []);

  const dueCount = overview?.totals?.dueTenants || 0;
  const alertCount = overview?.totals?.openComplaints || 0;

  const tabs = [
    ['home', '🫧', t('navHome')],
    ['money', '💰', t('navMoney'), dueCount],
    ['people', '👥', t('navPeople')],
    ['alerts', '🔔', t('navAlerts'), alertCount],
    ['more', '☰', t('navMore')]
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="logo" style={{ fontSize: 20 }}><span className="orb" style={{ width: 36, height: 36, fontSize: 19 }}>🏠</span>{t('appName')}</div>
        <div className="row">
          <button className="chip" onClick={() => go('more')}>🙍 {user.name.split(' ')[0]}</button>
        </div>
      </header>

      {tab === 'home' && <BubbleHome overview={overview} refreshOverview={refresh} go={go} />}
      {tab === 'money' && <Money overview={overview} refreshOverview={refresh} initialSeg={seg} />}
      {tab === 'people' && <People overview={overview} refreshOverview={refresh} initialSeg={seg} />}
      {tab === 'alerts' && <Alerts overview={overview} refreshOverview={refresh} initialSeg={seg} />}
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
    </div>
  );
}
