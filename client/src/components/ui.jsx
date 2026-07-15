import React, { useEffect } from 'react';
import { useLang } from '../i18n.jsx';

export function Modal({ title, icon, onClose, children }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="drag" />
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>✕</button>
        {title && <h3>{icon && <span>{icon}</span>}{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Empty({ icon, text, hint, children }) {
  return (
    <div className="empty">
      <span className="ico">{icon}</span>
      <b>{text}</b>
      {hint && <div className="small">{hint}</div>}
      {children}
    </div>
  );
}

export function LangPicker({ compact }) {
  const { lang, setLang } = useLang();
  return (
    <select
      className="input"
      style={compact ? { minHeight: 40, padding: '7px 12px', width: 'auto', fontSize: 15, borderRadius: 12 } : undefined}
      value={lang}
      onChange={e => setLang(e.target.value)}
      aria-label="Language"
    >
      {['en', 'hi', 'te', 'ta', 'kn', 'mr'].map(c => (
        <option key={c} value={c}>
          {{ en: '🌐 English', hi: '🪷 हिंदी', te: '🌾 తెలుగు', ta: '🛕 தமிழ்', kn: '🌻 ಕನ್ನಡ', mr: '🏔️ मराठी' }[c]}
        </option>
      ))}
    </select>
  );
}

export const rupee = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
