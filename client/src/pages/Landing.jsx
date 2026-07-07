import React from 'react';
import { useLang, LANGS } from '../i18n.jsx';
import { LangPicker } from '../components/ui.jsx';

const demoBubbles = [
  { icon: '🏨', label: 'Sri Sai Hostel', cls: '', style: { width: 150, height: 150, top: 10, left: '8%', fontSize: 15 } },
  { icon: '🏢', label: 'Green Flats', cls: 'pink', style: { width: 120, height: 120, top: 40, right: '4%', fontSize: 13, animationDelay: '1.2s' } },
  { icon: '🛏️', label: 'Room 101', cls: 'green', style: { width: 105, height: 105, bottom: 90, left: '2%', fontSize: 12, animationDelay: '2s' } },
  { icon: '💰', label: '₹39,000', cls: 'orange', style: { width: 125, height: 125, bottom: 10, right: '18%', fontSize: 14, animationDelay: '.6s' } },
  { icon: '🧑', label: 'Ravi Teja', cls: 'blue', style: { width: 95, height: 95, top: 165, left: '38%', fontSize: 12, animationDelay: '2.8s' } }
];

export default function Landing({ onLogin, onSignup }) {
  const { t } = useLang();
  const feats = [
    ['🫧', t('feat1t'), t('feat1d')],
    ['💰', t('feat2t'), t('feat2d')],
    ['🪪', t('feat3t'), t('feat3d')],
    ['🗣️', t('feat4t'), t('feat4d')],
    ['📊', t('feat5t'), t('feat5d')],
    ['📢', t('feat6t'), t('feat6d')]
  ];
  return (
    <div className="container">
      <nav className="landing-nav">
        <div className="logo"><span className="orb">🏠</span>{t('appName')}</div>
        <div className="row">
          <LangPicker compact />
          <button className="btn btn-sm" onClick={onLogin}>{t('login')}</button>
        </div>
      </nav>

      <section className="hero">
        <div>
          <h1>{t('heroTitle').split('—')[0]}<br /><span className="grad">{t('heroTitle').split('—')[1] || ''}</span></h1>
          <p>{t('heroSub')}</p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={onSignup}>🚀 {t('getStarted')}</button>
            <button className="btn" onClick={onLogin}>▶️ {t('tryDemo')}</button>
          </div>
          <p className="muted small mt16">{t('demoHint')}</p>
        </div>
        <div className="bubble-demo" aria-hidden="true">
          {demoBubbles.map((b, i) => (
            <div key={i} className={`demo-bubble bubble ${b.cls}`} style={b.style}>
              <span style={{ fontSize: '1.9em' }}>{b.icon}</span>
              <span>{b.label}</span>
            </div>
          ))}
        </div>
      </section>

      <h2 className="section-title">{t('featTitle')}</h2>
      <div className="feature-grid">
        {feats.map(([ico, title, desc]) => (
          <div key={title} className="card feature">
            <span className="ico">{ico}</span>
            <h3>{title}</h3>
            <p>{desc}</p>
          </div>
        ))}
      </div>

      <h2 className="section-title">{t('feat4t')}</h2>
      <div className="lang-strip">
        {LANGS.map(l => <span key={l.code} className="chip">{l.flag} {l.native}</span>)}
      </div>

      <h2 className="section-title">{t('pricingTitle')}</h2>
      <p className="section-sub">{t('priceNote')}</p>
      <div className="price-grid">
        <div className="card price-card">
          <div className="chip">{t('freePlan')}</div>
          <div className="price">{t('priceFree')}</div>
          <p className="muted">{t('priceFreeSub')}</p>
          <button className="btn btn-block mt16" onClick={onSignup}>{t('getStarted')}</button>
        </div>
        <div className="card price-card pro">
          <div className="chip active">⭐ {t('premiumPlan')}</div>
          <div className="price">{t('pricePro')}</div>
          <p className="muted">{t('priceProSub')}</p>
          <button className="btn btn-primary btn-block mt16" onClick={onSignup}>{t('getStarted')}</button>
        </div>
      </div>

      <footer>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: 10 }}><span className="orb">🏠</span>{t('appName')}</div>
        {t('madeWith')}
      </footer>
    </div>
  );
}
