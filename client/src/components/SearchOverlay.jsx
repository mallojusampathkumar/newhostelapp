import React, { useEffect, useMemo, useRef, useState } from 'react';
import { get } from '../api.js';
import { useLang } from '../i18n.jsx';
import { rupee } from './ui.jsx';
import TenantSheet from './TenantSheet.jsx';

/* Spotlight-style global search: one box finds tenants (name / phone / room)
   and properties. Tapping a tenant opens the full tenant sheet right here. */

export default function SearchOverlay({ properties, onClose, refreshOverview }) {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [tenants, setTenants] = useState(null);
  const [open, setOpen] = useState(null); // tenant sheet
  const inputRef = useRef(null);

  useEffect(() => {
    get('/tenants?status=active').then(d => setTenants(d.tenants)).catch(() => setTenants([]));
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 60);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return { tenants: [], props: [] };
    const tHits = (tenants || []).filter(x =>
      x.name.toLowerCase().includes(needle) ||
      String(x.phone || '').includes(needle) ||
      String(x.roomName || '').toLowerCase() === needle
    ).slice(0, 12);
    const pHits = (properties || []).filter(p => p.name.toLowerCase().includes(needle)).slice(0, 4);
    return { tenants: tHits, props: pHits };
  }, [needle, tenants, properties]);

  const dueTenants = useMemo(
    () => (tenants || []).filter(x => x.dues?.dueAmount > 0).sort((a, b) => b.dues.dueAmount - a.dues.dueAmount).slice(0, 5),
    [tenants]
  );

  return (
    <div className="search-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="search-panel">
        <div className="search-box">
          <span className="search-ico">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder={t('searchEverything')}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className="search-close" onClick={onClose}>✕</button>
        </div>

        <div className="search-results">
          {!needle && (
            <>
              <div className="search-hint">💡 {t('searchHint')}</div>
              {dueTenants.length > 0 && (
                <>
                  <div className="search-group">⚠️ {t('duesTitle')}</div>
                  {dueTenants.map(x => <TenantRow key={x.id} x={x} t={t} onOpen={() => setOpen(x)} />)}
                </>
              )}
            </>
          )}

          {needle && results.props.length > 0 && (
            <>
              <div className="search-group">🏠 {t('properties')}</div>
              {results.props.map(p => (
                <div key={p.id} className="list-item">
                  <div className="avatar" style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}cc)` }}>{p.icon}</div>
                  <div className="grow">
                    <b>{p.name}</b>
                    <div className="muted small">🛏️ {p.stats.occupied}/{p.stats.totalBeds} · {p.stats.dueAmount > 0 ? `⚠️ ${rupee(p.stats.dueAmount)} ${t('dueStatus') || 'due'}` : `✅ ${t('paid')}`}</div>
                  </div>
                </div>
              ))}
            </>
          )}

          {needle && (
            <>
              <div className="search-group">👥 {t('tenants')}</div>
              {tenants === null && <div className="search-hint">⏳ {t('loading')}</div>}
              {tenants !== null && results.tenants.length === 0 && <div className="search-hint">🤷 {t('noResults')}</div>}
              {results.tenants.map(x => <TenantRow key={x.id} x={x} t={t} onOpen={() => setOpen(x)} />)}
            </>
          )}
        </div>
      </div>

      {open && (
        <TenantSheet
          tenant={open}
          onChanged={async () => {
            refreshOverview && refreshOverview();
            const d = await get('/tenants?status=active').catch(() => null);
            if (d) setTenants(d.tenants);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function TenantRow({ x, t, onOpen }) {
  const due = x.dues?.dueAmount || 0;
  return (
    <div className="list-item tap" onClick={onOpen}>
      <div className="avatar">{x.name[0]}</div>
      <div className="grow">
        <b>{x.name}</b>
        <div className="muted small">🚪 {x.roomName || '—'} · {x.propertyName} · 📱 {x.phone}</div>
      </div>
      <span className={`chip ${due > 0 ? 'red' : 'green'}`}>{due > 0 ? `⚠️ ${rupee(due)}` : '✅'}</span>
    </div>
  );
}
