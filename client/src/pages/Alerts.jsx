import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

const CMP_CATS = [['plumbing', '🚰'], ['electrical', '⚡'], ['food', '🍛'], ['cleaning', '🧹'], ['wifi', '📶'], ['noise', '📣'], ['other', '📦']];

export default function Alerts({ overview, refreshOverview }) {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState('inbox'); // inbox | complaints | notices | activity
  const [propId, setPropId] = useState('');
  const [complaints, setComplaints] = useState(null);
  const [notices, setNotices] = useState(null);
  const [activities, setActivities] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [claims, setClaims] = useState(null);
  const [proof, setProof] = useState(null);
  const [modal, setModal] = useState(null);

  const properties = overview?.properties || [];

  const load = useCallback(() => {
    get(`/complaints${propId ? `?propertyId=${propId}` : ''}`).then(d => setComplaints(d.complaints)).catch(() => {});
    get('/notices').then(d => setNotices(d.notices)).catch(() => {});
    get('/activities').then(d => setActivities(d.activities)).catch(() => {});
    get('/notifications').then(d => setNotifications(d.notifications)).catch(() => {});
    get('/payment-claims').then(d => setClaims(d.claims)).catch(() => {});
  }, [propId]);
  useEffect(() => { load(); }, [load]);

  const markRead = async (ids) => {
    try { await post('/notifications/read', ids ? { ids } : {}); load(); refreshOverview(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const recordClaim = async (c) => {
    try {
      await post('/payments', { tenantId: c.tenantId, amount: c.amount, mode: 'upi', note: c.note || 'Tenant claim' });
      await post(`/payment-claims/${c.id}/resolve`, { accept: true });
      toast(t('rentRecorded'));
      load(); refreshOverview();
    } catch (e) { toast(e.message, 'err'); }
  };
  const dismissClaim = async (c) => {
    try { await post(`/payment-claims/${c.id}/resolve`, { accept: false }); load(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const unread = (notifications || []).filter(n => !n.read);
  const openClaims = (claims || []).filter(c => c.status === 'open' && (!propId || c.propertyId === propId));
  const shownNotifications = (notifications || []).filter(n => !propId || !n.propertyId || n.propertyId === propId);

  const setStatus = async (c, status) => {
    try { await put(`/complaints/${c.id}`, { status }); load(); refreshOverview(); }
    catch (e) { toast(e.message, 'err'); }
  };

  // notices/activities are filtered client-side (all-property items always show)
  const shownNotices = (notices || []).filter(n => !propId || !n.propertyId || n.propertyId === propId);
  const shownActivities = (activities || []).filter(a => !propId || !a.propertyId || a.propertyId === propId);

  return (
    <div className="page">
      <h2 className="title">🔔 {t('navAlerts')}</h2>

      <div className="filter-bar">
        <select className="input" value={propId} onChange={e => setPropId(e.target.value)}>
          <option value="">🏠 {t('allProperties')}</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </div>

      <div className="seg mt8">
        <button className={seg === 'inbox' ? 'active' : ''} onClick={() => setSeg('inbox')}>
          📥 {t('inbox')}{unread.length > 0 ? ` (${unread.length})` : ''}
        </button>
        <button className={seg === 'complaints' ? 'active' : ''} onClick={() => setSeg('complaints')}>🛠️ {t('complaints')}</button>
        <button className={seg === 'notices' ? 'active' : ''} onClick={() => setSeg('notices')}>📢 {t('notices')}</button>
        <button className={seg === 'activity' ? 'active' : ''} onClick={() => setSeg('activity')}>🕓 {t('activity')}</button>
      </div>

      {/* -------- inbox: notifications + tenant payment requests -------- */}
      {seg === 'inbox' && (
        <div className="mt16">
          {openClaims.length > 0 && (
            <>
              <b className="small">💸 {t('paymentClaims')}</b>
              {openClaims.map(c => (
                <div key={c.id} className="list-item mt8" style={{ alignItems: 'flex-start' }}>
                  <div className="avatar" style={{ background: 'linear-gradient(135deg,#0984e3,#74b9ff)' }}>💸</div>
                  <div className="grow">
                    <b>{c.tenantName}</b> <b style={{ color: 'var(--green2)' }}>₹{Number(c.amount).toLocaleString('en-IN')}</b>
                    <div className="muted small">{new Date(c.createdAt).toLocaleString()}{c.note ? ` · ${c.note}` : ''}</div>
                    <div className="row wrap mt8">
                      <button className="btn btn-sm btn-green" onClick={() => recordClaim(c)}>✅ {t('recordThis')}</button>
                      {c.screenshot && <button className="btn btn-sm" onClick={() => setProof(c.screenshot)}>🖼️ {t('viewProof')}</button>}
                      <button className="btn btn-sm btn-ghost" onClick={() => dismissClaim(c)}>✖ {t('dismiss')}</button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="mb16" />
            </>
          )}

          <div className="row spread">
            <span className="chip">📥 {shownNotifications.length}</span>
            {unread.length > 0 && <button className="btn btn-sm" onClick={() => markRead(null)}>✔ {t('markAllRead')}</button>}
          </div>
          {notifications && shownNotifications.length === 0 && <Empty icon="🎉" text={t('noNotifications')} />}
          {shownNotifications.map(n => (
            <div key={n.id} className="list-item mt8 tap" style={{ opacity: n.read ? 0.62 : 1 }}
              onClick={() => !n.read && markRead([n.id])}>
              <div className="avatar" style={{ background: n.read ? 'var(--surface2)' : 'linear-gradient(135deg,#6c5ce7,#8e7bff)', color: n.read ? 'var(--text)' : '#fff' }}>{n.icon}</div>
              <div className="grow">
                <div className="small" style={{ fontWeight: n.read ? 400 : 700 }}>{n.text}</div>
                <div className="muted small">{new Date(n.createdAt).toLocaleString()}</div>
              </div>
              {!n.read && <span className="badge" style={{ position: 'static' }}>●</span>}
            </div>
          ))}
          {proof && (
            <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={() => setProof(null)}>
              <div style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>
                <img src={proof} alt="payment proof" style={{ width: '100%', borderRadius: 16 }} />
              </div>
            </div>
          )}
        </div>
      )}

      {seg === 'complaints' && (
        <>
          <div className="row spread mt16">
            <span className="chip red">🛠️ {(complaints || []).filter(c => c.status !== 'resolved').length} {t('open')}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('addComplaint')}>➕ {t('addComplaint')}</button>
          </div>
          <div className="mt16">
            {complaints && complaints.length === 0 && <Empty icon="🎉" text={t('noComplaintsYet')} />}
            {(complaints || []).map(c => {
              const ico = CMP_CATS.find(x => x[0] === c.category)?.[1] || '📦';
              return (
                <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <div className="avatar" style={{ background: c.status === 'resolved' ? 'linear-gradient(135deg,#00b894,#00cec9)' : 'linear-gradient(135deg,#ff5e57,#ff7675)' }}>{ico}</div>
                  <div className="grow">
                    <b>{t(c.category)}</b> <span className="muted small">· {c.propertyName}{c.roomName ? ` · ${t('room')} ${c.roomName}` : ''}</span>
                    <div className="small" style={{ margin: '4px 0' }}>{c.text}</div>
                    <div className="row wrap">
                      {['open', 'inprogress', 'resolved'].map(s => (
                        <button key={s} className={`chip ${c.status === s ? (s === 'resolved' ? 'green' : s === 'open' ? 'red' : 'orange') : ''}`}
                          onClick={() => setStatus(c, s)}>
                          {s === 'open' ? '🔴' : s === 'inprogress' ? '🟡' : '🟢'} {t(s)}
                        </button>
                      ))}
                      <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/complaints/${c.id}`); load(); refreshOverview(); } }}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {seg === 'notices' && (
        <>
          <div className="row spread mt16">
            <span className="chip">📢 {shownNotices.length}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('postNotice')}>➕ {t('postNotice')}</button>
          </div>
          <div className="mt16">
            {notices && shownNotices.length === 0 && <Empty icon="📢" text={t('noNoticesYet')} />}
            {shownNotices.map(n => (
              <div key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div className="avatar" style={{ background: 'linear-gradient(135deg,#fdaa3d,#ffeaa7)', color: '#5c3c00' }}>📢</div>
                <div className="grow">
                  <div>{n.text}</div>
                  <div className="muted small mt8">{n.propertyName || t('allProperties')} · {new Date(n.createdAt).toLocaleDateString()}</div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/notices/${n.id}`); load(); } }}>🗑️</button>
              </div>
            ))}
          </div>
        </>
      )}

      {seg === 'activity' && (
        <div className="mt16">
          {activities && shownActivities.length === 0 && <Empty icon="🕓" text={t('noActivityYet')} />}
          {shownActivities.map(a => (
            <div key={a.id} className="list-item">
              <div className="avatar" style={{ background: 'var(--surface2)', color: 'var(--text)' }}>{a.icon}</div>
              <div className="grow">
                <div className="small">{a.text}</div>
                <div className="muted small">{new Date(a.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'addComplaint' && (
        <AddComplaintModal properties={properties} onDone={() => { setModal(null); load(); refreshOverview(); }} onClose={() => setModal(null)} />
      )}
      {modal === 'postNotice' && (
        <PostNoticeModal properties={properties} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function AddComplaintModal({ properties, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ propertyId: properties[0]?.id || '', category: 'plumbing', text: '', roomName: '', tenantName: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/complaints', f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('addComplaint')} icon="🛠️" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('properties')}`}>
          <select className="input" required value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </Field>
        <Field label={t('category')}>
          <div className="row wrap">
            {CMP_CATS.map(([v, ico]) => (
              <button type="button" key={v} className={`chip ${f.category === v ? 'active' : ''}`} onClick={() => setF({ ...f, category: v })}>{ico} {t(v)}</button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label={`🚪 ${t('roomName')}`}>
            <input className="input" value={f.roomName} onChange={e => setF({ ...f, roomName: e.target.value })} />
          </Field>
          <Field label={`🧑 ${t('tenantName')}`}>
            <input className="input" value={f.tenantName} onChange={e => setF({ ...f, tenantName: e.target.value })} />
          </Field>
        </div>
        <Field label={`📝 ${t('note')}`}>
          <textarea className="input" rows={3} required value={f.text} onChange={e => setF({ ...f, text: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

function PostNoticeModal({ properties, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ propertyId: '', text: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/notices', { ...f, propertyId: f.propertyId || null }); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('postNotice')} icon="📢" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('properties')}`}>
          <select className="input" value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
            <option value="">🏠 {t('allProperties')}</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </Field>
        <Field label={`📢 ${t('notices')}`}>
          <textarea className="input" rows={4} required placeholder={t('noticeText')} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}
