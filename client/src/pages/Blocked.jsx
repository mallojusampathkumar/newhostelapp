import React from 'react';
import { useLang } from '../i18n.jsx';

/* Full-screen lock shown when the owner's account is pending approval,
   blocked, or rejected by the admin. */
export default function Blocked({ user, onRecheck, onLogout }) {
  const { t } = useLang();
  const pending = user.access?.status === 'pending';
  return (
    <div className="auth-wrap">
      <div className="card center" style={{ maxWidth: 420, margin: '14vh auto', padding: 28 }}>
        <div style={{ fontSize: 54 }}>{pending ? '⏳' : '🔒'}</div>
        <h2 className="mt8">{pending ? t('pendingTitle') : t('blockedTitle')}</h2>
        <p className="muted mt8">{pending ? t('pendingMsg') : t('blockedMsg')}</p>
        <p className="muted small mt8">🙍 {user.name} · 📱 {user.phone}</p>
        <div className="row mt16">
          <button className="btn grow" onClick={onRecheck}>🔄 {t('checkAgain')}</button>
          <a className="btn grow" href="mailto:admin@staysathi.in">✉️ {t('contactSupport')}</a>
        </div>
        <button className="btn btn-danger btn-block mt8" onClick={onLogout}>🚪 {t('logout')}</button>
      </div>
    </div>
  );
}
