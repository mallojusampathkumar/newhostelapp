import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

/* Super-admin portal: everything about the platform in one place —
   owners (with trial/subscription dates), payment requests to verify,
   the revenue ledger, and billing settings. Only for user.role === 'admin'. */

const STATUS_CHIP = {
  active: ['green', '✅'], pending: ['orange', '⏳'],
  blocked: ['red', '⛔'], rejected: ['red', '❌']
};

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

// trial / premium / expired — matches the server's read-only rule
function planState(u) {
  if (u.access?.readonly) return 'expired';
  if (u.plan === 'premium') return 'premium';
  return 'trial';
}
const PLAN_CHIP = {
  premium: ['green', '⭐'], trial: ['orange', '⏳'], expired: ['red', '🔒']
};

export default function Admin() {
  const { t } = useLang();
  const toast = useToast();
  const monthsLabel = (n) => n > 1 ? `${n} ${t('months')}` : t('months1');
  const [seg, setSeg] = useState('overview'); // overview | users | subs | settings
  const [users, setUsers] = useState(null);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [subs, setSubs] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sel, setSel] = useState(null);

  const load = useCallback(() => {
    get('/admin/users').then(d => { setUsers(d.users); setSettings(d.settings); }).catch(e => toast(e.message, 'err'));
    get('/admin/stats').then(setStats).catch(() => {});
    get('/admin/subscriptions').then(setSubs).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const act = async (u, body, confirmMsg) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try { await put(`/admin/users/${u.id}`, body); toast('✔'); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  // direct subscription switch — the "turn it on from admin" button
  const subscription = async (u, action, months = 1) => {
    try {
      await post(`/admin/users/${u.id}/subscription`, { action, months });
      toast('✔'); setSel(null); load();
    } catch (e) { toast(e.message, 'err'); }
  };

  const resolveRequest = async (r, accept) => {
    try {
      await post(`/admin/subscriptions/${r.id}/resolve`, { accept });
      toast(accept ? '⭐ ✔' : '✔'); load();
    } catch (e) { toast(e.message, 'err'); }
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

  const openRequests = (subs?.requests || []).filter(r => r.status === 'open');

  const filtered = (users || [])
    .filter(u => {
      if (filter === 'all') return true;
      if (['premium', 'trial', 'expired'].includes(filter)) return planState(u) === filter;
      return (u.access?.status || 'active') === filter;
    })
    .filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.phone.includes(search));

  const segTabs = [
    ['overview', `📊 ${t('adminOverview')}`],
    ['users', `👥 ${t('adminUsers')}`],
    ['subs', `💳 ${t('adminSubs')}${openRequests.length ? ` (${openRequests.length})` : ''}`],
    ['settings', `⚙️ ${t('adminSettings')}`]
  ];

  return (
    <div className="page">
      <h2 className="title">🛡️ {t('adminPanel')}</h2>

      <div className="seg mt8">
        {segTabs.map(([v, l]) => (
          <button key={v} className={seg === v ? 'active' : ''} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>

      {/* ---------------- overview ---------------- */}
      {seg === 'overview' && stats && (
        <>
          <div className="stat-strip mt16">
            <div className="stat-tile"><div className="v" style={{ color: 'var(--green2)' }}>{rupee(stats.totals.revenueThisMonth)}</div><div className="k">{t('revenueThisMonth')}</div></div>
            <div className="stat-tile"><div className="v">{rupee(stats.totals.revenueTotal)}</div><div className="k">{t('totalRevenue')}</div></div>
            <div className="stat-tile tap" onClick={() => setSeg('subs')}><div className="v">💳 {stats.totals.openRequests}</div><div className="k">{t('openRequests')}</div></div>
            <div className="stat-tile tap" onClick={() => setSeg('subs')}><div className="v">⌛ {stats.totals.expiringSoon}</div><div className="k">{t('expiringSoon')}</div></div>
          </div>
          <div className="stat-strip mt8">
            <div className="stat-tile tap" onClick={() => { setFilter('all'); setSeg('users'); }}><div className="v">👥 {stats.totals.users}</div><div className="k">{t('adminUsers')}</div></div>
            <div className="stat-tile tap" onClick={() => { setFilter('premium'); setSeg('users'); }}><div className="v">⭐ {stats.totals.premium}</div><div className="k">Premium</div></div>
            <div className="stat-tile tap" onClick={() => { setFilter('trial'); setSeg('users'); }}><div className="v">⏳ {stats.totals.trial}</div><div className="k">{t('onTrialChip')}</div></div>
            <div className="stat-tile tap" onClick={() => { setFilter('expired'); setSeg('users'); }}><div className="v">🔒 {stats.totals.readonly}</div><div className="k">{t('expiredChip')}</div></div>
          </div>
          <div className="stat-strip mt8">
            <div className="stat-tile"><div className="v">🏠 {stats.totals.properties}</div><div className="k">{t('properties')}</div></div>
            <div className="stat-tile"><div className="v">🛏️ {stats.totals.beds}</div><div className="k">{t('beds')}</div></div>
            <div className="stat-tile"><div className="v">🧑 {stats.totals.tenants}</div><div className="k">{t('tenants')}</div></div>
            <div className="stat-tile"><div className="v">🧾 {stats.totals.paymentsRecorded}</div><div className="k">{t('recentPayments')}</div></div>
          </div>

          {stats.revenueSeries && (
            <div className="card mt16">
              <b>💰 {t('revenuePerMonth')}</b>
              <MiniBars series={stats.revenueSeries.map(s => ({ ...s, count: s.amount }))} color="var(--green2)" money />
            </div>
          )}

          <div className="card mt16">
            <b>📈 {t('signupsPerMonth')}</b>
            <MiniBars series={stats.signups} color="#6c5ce7" />
          </div>
        </>
      )}

      {/* ---------------- owners ---------------- */}
      {seg === 'users' && (
        <>
          <input className="input mt16" placeholder={`🔍 ${t('searchTenant')}`} value={search} onChange={e => setSearch(e.target.value)} />
          <div className="row wrap mt8">
            {[['all', '👥'], ['trial', '⏳'], ['premium', '⭐'], ['expired', '🔒'], ['pending', '🕐'], ['blocked', '⛔']].map(([s, ico]) => (
              <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                {ico} {s}
                {s === 'pending' && users ? ` (${users.filter(u => u.access?.status === 'pending').length})` : ''}
              </button>
            ))}
          </div>

          <div className="mt16">
            {users && filtered.length === 0 && <Empty icon="👥" text="—" />}
            {filtered.map(u => {
              const st = u.access?.status || 'active';
              const [chipCls, ico] = STATUS_CHIP[st] || STATUS_CHIP.active;
              const ps = planState(u);
              const [pCls, pIco] = PLAN_CHIP[ps];
              return (
                <div key={u.id} className="list-item tap" onClick={() => setSel(u)}>
                  <div className="avatar">{u.name[0]}</div>
                  <div className="grow">
                    <b>{u.name}</b> <span className={`chip small ${pCls}`}>{pIco} {ps}{u.access?.daysLeft != null ? ` · ${u.access.daysLeft}d` : ''}</span>
                    <div className="muted small">📱 {u.phone} · 🏠 {u.stats.properties} · 🛏️ {u.stats.occupied}/{u.stats.beds} · {rupee(u.stats.collectedThisMonth)}/mo</div>
                    <div className="muted small">
                      {ps === 'premium'
                        ? `⭐ ${t('premiumTill')} ${fmtDate(u.planExpiresAt)}`
                        : `⏳ ${t('trialEnds')} ${fmtDate(u.trialEndsAt)}`} · {t('lastActive')}: {fmtDate(u.stats.lastActivity)}
                    </div>
                  </div>
                  {st !== 'active' && <span className={`chip ${chipCls}`}>{ico} {st}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---------------- subscriptions ---------------- */}
      {seg === 'subs' && subs && (
        <>
          <div className="mt16">
            <b className="small">💳 {t('openRequests')}</b>
            {openRequests.length === 0 && <Empty icon="🎉" text={t('noRequests')} />}
            {openRequests.map(r => (
              <div key={r.id} className="list-item mt8" style={{ alignItems: 'flex-start' }}>
                <div className="avatar" style={{ background: 'linear-gradient(135deg,#6c5ce7,#a29bfe)' }}>💳</div>
                <div className="grow">
                  <b>{r.userName}</b> <b style={{ color: 'var(--green2)' }}>{rupee(r.amount)}</b>
                  <div className="muted small">
                    📱 {r.phone} · {monthsLabel(r.months)}
                    {r.txnRef ? ` · Ref: ${r.txnRef}` : ''}
                  </div>
                  <div className="muted small">{t('requestedOn')}: {fmtDateTime(r.createdAt)}</div>
                  <div className="row wrap mt8">
                    <button className="btn btn-sm btn-green" onClick={() => resolveRequest(r, true)}>⭐ {t('activateSub')}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => resolveRequest(r, false)}>✖ {t('reject')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card mt16">
            <b>⌛ {t('expiringSoon')}</b>
            {(subs.expiring || []).length === 0 && <p className="muted small mt8">{t('noExpiringSoon')}</p>}
            {(subs.expiring || []).map(u => (
              <div key={u.id} className="row spread mt8 small">
                <span>{u.name} · <span className="muted">{u.phone}</span></span>
                <b style={{ color: 'var(--red-strong)' }}>{fmtDate(u.planExpiresAt)}</b>
              </div>
            ))}
          </div>

          <div className="card mt16">
            <b>🧾 {t('subLedger')}</b>
            {(subs.payments || []).length === 0 && <p className="muted small mt8">—</p>}
            {(subs.payments || []).map(p => (
              <div key={p.id} className="row spread mt8 small">
                <span>
                  {p.userName} · <span className="muted">{fmtDate(p.createdAt)} · {monthsLabel(p.months)} · {p.source === 'admin' ? '🛡️' : '📲'}</span>
                </span>
                <b style={{ color: 'var(--green2)' }}>{rupee(p.amount)}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------------- settings ---------------- */}
      {seg === 'settings' && settings && (
        <>
          <div className="card mt16">
            <b>⚙️ {t('autoApprove')}</b>
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

          <div className="card mt16">
            <b>💳 {t('billingSettings')}</b>
            <div className="row spread mt16">
              <span className="small">{t('monthlyPriceLabel')}</span>
              <input className="input" style={{ width: 110, minHeight: 38 }} type="number" min="1"
                defaultValue={settings.monthlyPrice}
                onBlur={e => Number(e.target.value) !== settings.monthlyPrice && saveSettings({ monthlyPrice: Number(e.target.value) })} />
            </div>
            <Field label={`📲 ${t('platformUpiId')}`}>
              <input className="input" placeholder="business@upi" defaultValue={settings.upiId || ''}
                onBlur={e => e.target.value !== (settings.upiId || '') && saveSettings({ upiId: e.target.value })} />
            </Field>
            <Field label={`🏷️ ${t('platformUpiName')}`}>
              <input className="input" placeholder="StaySathi" defaultValue={settings.upiName || ''}
                onBlur={e => e.target.value !== (settings.upiName || '') && saveSettings({ upiName: e.target.value })} />
            </Field>
          </div>
        </>
      )}

      {/* ---------------- owner detail ---------------- */}
      {sel && (
        <Modal title={sel.name} icon="🙍" onClose={() => setSel(null)}>
          <div className="row wrap mb16">
            <span className="chip">📱 {sel.phone}</span>
            {sel.email && <span className="chip">✉️ {sel.email}</span>}
            <span className={`chip ${STATUS_CHIP[sel.access?.status || 'active'][0]}`}>{sel.access?.status || 'active'}</span>
            <span className={`chip ${PLAN_CHIP[planState(sel)][0]}`}>{PLAN_CHIP[planState(sel)][1]} {planState(sel)}</span>
            {sel.access?.daysLeft != null && <span className="chip orange">⏳ {sel.access.daysLeft} {t('subDaysLeft')}</span>}
          </div>

          {/* every date the admin asked to see */}
          <div className="card mb16">
            <div className="row spread small"><span className="muted">📅 {t('joinedOn')}</span><b>{fmtDate(sel.createdAt)}</b></div>
            <div className="row spread small mt8"><span className="muted">⏳ {t('trialEnds')}</span><b>{fmtDate(sel.trialEndsAt)}</b></div>
            <div className="row spread small mt8"><span className="muted">⭐ {t('premiumTill')}</span><b>{fmtDate(sel.planExpiresAt)}</b></div>
            <div className="row spread small mt8"><span className="muted">🕓 {t('lastActive')}</span><b>{fmtDate(sel.stats.lastActivity)}</b></div>
          </div>

          <p className="muted small mb16">
            🏠 {sel.stats.properties} {t('properties')} · 🛏️ {sel.stats.occupied}/{sel.stats.beds} · 🧑 {sel.stats.tenants} {t('tenants')} · {rupee(sel.stats.collectedThisMonth)} {t('thisMonth')}
          </p>

          {(sel.access?.status === 'pending') && (
            <div className="row wrap mb16">
              <button className="btn btn-green grow" onClick={async () => { await act(sel, { status: 'active' }); setSel(null); }}>✅ {t('approve')}</button>
              <button className="btn btn-danger grow" onClick={async () => { await act(sel, { status: 'rejected' }); setSel(null); }}>❌ {t('reject')}</button>
            </div>
          )}

          {/* subscription switch */}
          <div className="row wrap">
            <button className="btn btn-green grow" onClick={() => subscription(sel, 'activate', 1)}>⭐ {t('activateSub')} · {t('months1')}</button>
            <button className="btn grow" onClick={() => subscription(sel, 'activate', 3)}>⭐ {t('months3')}</button>
          </div>
          <div className="row wrap mt8">
            {sel.plan === 'premium' && (
              <button className="btn grow" onClick={() => subscription(sel, 'deactivate')}>🔕 {t('deactivateSub')}</button>
            )}
            <button className="btn grow" onClick={async () => {
              const base = sel.trialEndsAt && new Date(sel.trialEndsAt) > new Date() ? new Date(sel.trialEndsAt) : new Date();
              await act(sel, { trialEndsAt: new Date(base.getTime() + 7 * 86400000).toISOString() });
              setSel(null);
            }}>⏳ {t('extendTrial')}</button>
          </div>

          <div className="row wrap mt8">
            {sel.access?.status !== 'blocked'
              ? <button className="btn grow" onClick={async () => { await act(sel, { status: 'blocked' }, `Block ${sel.name}?`); setSel(null); }}>⛔ {t('block')}</button>
              : <button className="btn btn-green grow" onClick={async () => { await act(sel, { status: 'active' }); setSel(null); }}>✅ {t('unblock')}</button>}
            <button className="btn grow" onClick={() => resetPw(sel)}>🔑 {t('resetPassword')}</button>
          </div>
          <button className="btn btn-danger btn-block mt8" onClick={() => removeUser(sel)}>🗑️ {t('deleteUser')}</button>
        </Modal>
      )}
    </div>
  );
}

/* tiny month-bar chart shared by signups & revenue */
function MiniBars({ series, color, money }) {
  const max = Math.max(1, ...series.map(x => x.count));
  return (
    <div className="bar-chart">
      {series.map(s => (
        <div key={s.month} className="bar-group">
          <div className="bar-pair">
            <div className="bar" style={{ height: `${(s.count / max) * 100}%`, background: color }}
              title={`${s.label}: ${money ? '₹' + Number(s.count).toLocaleString('en-IN') : s.count}`} />
          </div>
          <span className="bar-label">{s.label} · {money ? '₹' + Number(s.count).toLocaleString('en-IN') : s.count}</span>
        </div>
      ))}
    </div>
  );
}
