import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

/* Platform admin panel: approve/reject/block owners, upgrade plans, extend
   trials, reset passwords, delete accounts, tune signup settings and watch
   usage stats. Only visible when user.role === 'admin'. */

const STATUS_CHIP = {
  active: ['green', '✅'], pending: ['orange', '⏳'],
  blocked: ['red', '⛔'], rejected: ['red', '❌']
};

export default function Admin() {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState('users'); // users | stats
  const [users, setUsers] = useState(null);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null);

  const load = useCallback(() => {
    get('/admin/users').then(d => { setUsers(d.users); setSettings(d.settings); }).catch(e => toast(e.message, 'err'));
    get('/admin/stats').then(setStats).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const act = async (u, body, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try { await put(`/admin/users/${u.id}`, body); toast('✔'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const removeUser = async (u) => {
    if (!window.confirm(`Delete ${u.name} and ALL their data? This cannot be undone.`)) return;
    try { await del(`/admin/users/${u.id}`); toast('✔'); setSel(null); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const resetPw = async (u) => {
    const pw = window.prompt(`${t('resetPassword')} — ${u.name}:`);
    if (!pw) return;
    try { await post(`/admin/users/${u.id}/reset-password`, { password: pw }); toast('✔'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const saveSettings = async (patch) => {
    try {
      const { settings: s } = await put('/admin/settings', { ...settings, ...patch });
      setSettings(s); toast('✔');
    } catch (e) { toast(e.message, 'err'); }
  };

  const filtered = (users || [])
    .filter(u => filter === 'all' || (u.access?.status || 'active') === filter)
    .filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.phone.includes(search));

  return (
    <div className="page">
      <h2 className="title">🛡️ {t('adminPanel')}</h2>

      <div className="seg mt8">
        <button className={seg === 'users' ? 'active' : ''} onClick={() => setSeg('users')}>👥 {t('adminUsers')}</button>
        <button className={seg === 'stats' ? 'active' : ''} onClick={() => setSeg('stats')}>📊 {t('adminStats')}</button>
      </div>

      {seg === 'users' && (
        <>
          <input className="input mt16" placeholder={`🔍 ${t('searchTenant')}`} value={search} onChange={e => setSearch(e.target.value)} />
          <div className="row wrap mt8">
            {['all', 'active', 'pending', 'blocked'].map(s => (
              <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                {s === 'all' ? '👥' : STATUS_CHIP[s]?.[1]} {s}
                {s === 'pending' && users ? ` (${users.filter(u => u.access?.status === 'pending').length})` : ''}
              </button>
            ))}
          </div>

          <div className="mt16">
            {users && filtered.length === 0 && <Empty icon="👥" text="—" />}
            {filtered.map(u => {
              const st = u.access?.status || 'active';
              const [chipCls, ico] = STATUS_CHIP[st] || STATUS_CHIP.active;
              return (
                <div key={u.id} className="list-item tap" onClick={() => setSel(u)}>
                  <div className="avatar">{u.name[0]}</div>
                  <div className="grow">
                    <b>{u.name}</b> {u.plan === 'premium' && <span title="Premium">⭐</span>}
                    <div className="muted small">📱 {u.phone} · 🏠 {u.stats.properties} · 🛏️ {u.stats.occupied}/{u.stats.beds} · {rupee(u.stats.collectedThisMonth)}/mo</div>
                    <div className="muted small">{t('lastActive')}: {new Date(u.stats.lastActivity).toLocaleDateString()}
                      {u.access?.daysLeft != null && ` · ⏳ ${u.access.daysLeft}d`}</div>
                  </div>
                  <span className={`chip ${chipCls}`}>{ico} {st}</span>
                </div>
              );
            })}
          </div>

          {settings && (
            <div className="card mt16">
              <b>⚙️ Signup settings</b>
              <div className="row spread mt16">
                <span className="small">{t('autoApprove')}</span>
                <button className={`chip ${settings.autoApprove ? 'green' : 'red'}`}
                  onClick={() => saveSettings({ autoApprove: !settings.autoApprove })}>
                  {settings.autoApprove ? '✅ ON' : '⛔ OFF'}
                </button>
              </div>
              <div className="row spread mt8">
                <span className="small">{t('trialDaysLabel')}</span>
                <input className="input" style={{ width: 90, minHeight: 38 }} type="number" min="1"
                  defaultValue={settings.trialDays}
                  onBlur={e => Number(e.target.value) !== settings.trialDays && saveSettings({ trialDays: Number(e.target.value) })} />
              </div>
            </div>
          )}
        </>
      )}

      {seg === 'stats' && stats && (
        <>
          <div className="stat-strip mt16">
            <div className="stat-tile"><div className="v">👥 {stats.totals.users}</div><div className="k">{t('adminUsers')}</div></div>
            <div className="stat-tile"><div className="v">⭐ {stats.totals.premium}</div><div className="k">Premium</div></div>
            <div className="stat-tile"><div className="v">⏳ {stats.totals.pending}</div><div className="k">Pending</div></div>
            <div className="stat-tile"><div className="v">⛔ {stats.totals.blocked}</div><div className="k">Blocked</div></div>
          </div>
          <div className="stat-strip mt8">
            <div className="stat-tile"><div className="v">🏠 {stats.totals.properties}</div><div className="k">{t('properties')}</div></div>
            <div className="stat-tile"><div className="v">🛏️ {stats.totals.beds}</div><div className="k">{t('beds')}</div></div>
            <div className="stat-tile"><div className="v">🧑 {stats.totals.tenants}</div><div className="k">{t('tenants')}</div></div>
            <div className="stat-tile"><div className="v">🧾 {stats.totals.paymentsRecorded}</div><div className="k">{t('recentPayments')}</div></div>
          </div>
          <div className="card mt16">
            <b>📈 {t('signupsPerMonth')}</b>
            <div className="bar-chart">
              {stats.signups.map(s => {
                const max = Math.max(1, ...stats.signups.map(x => x.count));
                return (
                  <div key={s.month} className="bar-group">
                    <div className="bar-pair">
                      <div className="bar" style={{ height: `${(s.count / max) * 100}%`, background: '#6c5ce7' }} title={`${s.label}: ${s.count}`} />
                    </div>
                    <span className="bar-label">{s.label} · {s.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {sel && (
        <Modal title={sel.name} icon="🙍" onClose={() => setSel(null)}>
          <div className="row wrap mb16">
            <span className="chip">📱 {sel.phone}</span>
            {sel.email && <span className="chip">✉️ {sel.email}</span>}
            <span className={`chip ${STATUS_CHIP[sel.access?.status || 'active'][0]}`}>{sel.access?.status || 'active'}</span>
            <span className="chip">{sel.plan === 'premium' ? '⭐ premium' : '🆓 free'}</span>
            {sel.access?.daysLeft != null && <span className="chip orange">⏳ {sel.access.daysLeft} days left</span>}
          </div>
          <p className="muted small mb16">
            🏠 {sel.stats.properties} {t('properties')} · 🛏️ {sel.stats.occupied}/{sel.stats.beds} · 🧑 {sel.stats.tenants} {t('tenants')} · {rupee(sel.stats.collectedThisMonth)} {t('thisMonth')}
          </p>

          {(sel.access?.status === 'pending') && (
            <div className="row wrap">
              <button className="btn btn-green grow" onClick={async () => { await act(sel, { status: 'active' }); setSel(null); }}>✅ {t('approve')}</button>
              <button className="btn btn-danger grow" onClick={async () => { await act(sel, { status: 'rejected' }); setSel(null); }}>❌ {t('reject')}</button>
            </div>
          )}
          <div className="row wrap mt8">
            {sel.access?.status !== 'blocked'
              ? <button className="btn grow" onClick={async () => { await act(sel, { status: 'blocked' }, `Block ${sel.name}?`); setSel(null); }}>⛔ {t('block')}</button>
              : <button className="btn btn-green grow" onClick={async () => { await act(sel, { status: 'active' }); setSel(null); }}>✅ {t('unblock')}</button>}
            {sel.plan !== 'premium'
              ? <button className="btn grow" onClick={async () => { await act(sel, { plan: 'premium' }); setSel(null); }}>⭐ {t('upgradePlan')}</button>
              : <button className="btn grow" onClick={async () => { await act(sel, { plan: 'free' }); setSel(null); }}>🆓 {t('downgradePlan')}</button>}
          </div>
          <div className="row wrap mt8">
            <button className="btn grow" onClick={async () => {
              const base = sel.trialEndsAt && new Date(sel.trialEndsAt) > new Date() ? new Date(sel.trialEndsAt) : new Date();
              await act(sel, { trialEndsAt: new Date(base.getTime() + 30 * 86400000).toISOString() });
              setSel(null);
            }}>⏳ {t('extendTrial')}</button>
            <button className="btn grow" onClick={() => resetPw(sel)}>🔑 {t('resetPassword')}</button>
          </div>
          <button className="btn btn-danger btn-block mt8" onClick={() => removeUser(sel)}>🗑️ {t('deleteUser')}</button>
        </Modal>
      )}
    </div>
  );
}
