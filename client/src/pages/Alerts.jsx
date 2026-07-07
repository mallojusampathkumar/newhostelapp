import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

const CMP_CATS = [['plumbing', '🚰'], ['electrical', '⚡'], ['food', '🍛'], ['cleaning', '🧹'], ['wifi', '📶'], ['noise', '📣'], ['other', '📦']];

export default function Alerts({ overview, refreshOverview }) {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState('complaints'); // complaints | notices | activity
  const [complaints, setComplaints] = useState(null);
  const [notices, setNotices] = useState(null);
  const [activities, setActivities] = useState(null);
  const [modal, setModal] = useState(null);

  const properties = overview?.properties || [];

  const load = useCallback(() => {
    get('/complaints').then(d => setComplaints(d.complaints)).catch(() => {});
    get('/notices').then(d => setNotices(d.notices)).catch(() => {});
    get('/activities').then(d => setActivities(d.activities)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (c, status) => {
    try { await put(`/complaints/${c.id}`, { status }); load(); refreshOverview(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="page">
      <h2 className="title">🔔 {t('navAlerts')}</h2>

      <div className="seg mt8">
        <button className={seg === 'complaints' ? 'active' : ''} onClick={() => setSeg('complaints')}>🛠️ {t('complaints')}</button>
        <button className={seg === 'notices' ? 'active' : ''} onClick={() => setSeg('notices')}>📢 {t('notices')}</button>
        <button className={seg === 'activity' ? 'active' : ''} onClick={() => setSeg('activity')}>🕓 {t('activity')}</button>
      </div>

      {seg === 'complaints' && (
        <>
          <div className="row spread mt16">
            <span className="chip red">🛠️ {(complaints || []).filter(c => c.status !== 'resolved').length} {t('open')}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('addComplaint')}>➕ {t('addComplaint')}</button>
          </div>
          <div className="mt16">
            {complaints && complaints.length === 0 && <Empty icon="🎉" text="—" />}
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
            <span className="chip">📢 {(notices || []).length}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('postNotice')}>➕ {t('postNotice')}</button>
          </div>
          <div className="mt16">
            {notices && notices.length === 0 && <Empty icon="📢" text="—" />}
            {(notices || []).map(n => (
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
          {(activities || []).map(a => (
            <div key={a.id} className="list-item">
              <div className="avatar" style={{ background: 'rgba(255,255,255,.12)' }}>{a.icon}</div>
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
