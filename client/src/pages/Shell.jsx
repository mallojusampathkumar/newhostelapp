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
  const [overview, setOverview] = useState(null);

  const refresh = useCallback(() => {
    get('/overview').then(setOverview).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

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
          <span className="chip">🙍 {user.name.split(' ')[0]}</span>
        </div>
      </header>

      {tab === 'home' && <BubbleHome overview={overview} refreshOverview={refresh} />}
      {tab === 'money' && <Money overview={overview} refreshOverview={refresh} />}
      {tab === 'people' && <People overview={overview} refreshOverview={refresh} />}
      {tab === 'alerts' && <Alerts overview={overview} refreshOverview={refresh} />}
      {tab === 'more' && <More overview={overview} user={user} setUser={setUser} onLogout={onLogout} refreshOverview={refresh} />}

      <nav className="bottom-nav">
        {tabs.map(([key, ico, label, badge]) => (
          <button key={key} className={`nav-item ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
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
