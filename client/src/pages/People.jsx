import React, { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

const ROLES = [['cook', '🍲'], ['watchman', '💂'], ['cleaner', '🧹'], ['warden', '🧑‍🏫'], ['manager', '🧑‍💼'], ['helper', '🤝']];

export default function People({ overview }) {
  const { t } = useLang();
  const [seg, setSeg] = useState('tenants'); // tenants | staff
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [tenants, setTenants] = useState(null);
  const [staff, setStaff] = useState(null);
  const [modal, setModal] = useState(null);

  const properties = overview?.properties || [];

  const load = useCallback(() => {
    get('/tenants').then(d => setTenants(d.tenants)).catch(() => {});
    get('/staff').then(d => setStaff(d.staff)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = (tenants || [])
    .filter(x => x.status === status)
    .filter(x => !search || x.name.toLowerCase().includes(search.toLowerCase()) || x.phone.includes(search));

  return (
    <div className="page">
      <h2 className="title">👥 {t('navPeople')}</h2>

      <div className="seg mt8">
        <button className={seg === 'tenants' ? 'active' : ''} onClick={() => setSeg('tenants')}>🧑 {t('tenants')}</button>
        <button className={seg === 'staff' ? 'active' : ''} onClick={() => setSeg('staff')}>🧹 {t('staffTitle')}</button>
      </div>

      {seg === 'tenants' && (
        <>
          <input className="input mt16" placeholder={`🔍 ${t('searchTenant')}`} value={search} onChange={e => setSearch(e.target.value)} />
          <div className="row mt8">
            <button className={`chip ${status === 'active' ? 'active' : ''}`} onClick={() => setStatus('active')}>✅ {t('activeT')}</button>
            <button className={`chip ${status === 'vacated' ? 'active' : ''}`} onClick={() => setStatus('vacated')}>👋 {t('vacatedT')}</button>
          </div>
          <div className="mt16">
            {tenants && filtered.length === 0 && <Empty icon="🧑" text={t('noTenants')} />}
            {filtered.map(x => (
              <div key={x.id} className="list-item">
                <div className="avatar">{x.name[0]}</div>
                <div className="grow">
                  <b>{x.name}</b>
                  <div className="muted small">{x.propertyName} · {t('room')} {x.roomName} · 📱 {x.phone}</div>
                  <div className="row wrap mt8">
                    {x.status === 'active' && x.dues && (
                      x.dues.dueAmount > 0
                        ? <span className="chip red">⚠️ {rupee(x.dues.dueAmount)}</span>
                        : <span className="chip green">✅ {t('paid')}</span>
                    )}
                    <span className={`chip ${x.kycStatus === 'verified' || x.kycStatus === 'submitted' ? 'green' : 'orange'}`}>
                      🪪 {x.kycStatus === 'pending' ? t('kycPending') : t('kycDone')}
                    </span>
                  </div>
                </div>
                <a className="btn btn-sm" href={`tel:${x.phone}`}>📞</a>
              </div>
            ))}
          </div>
        </>
      )}

      {seg === 'staff' && (
        <>
          <div className="row spread mt16">
            <span className="chip">🧹 {(staff || []).length} {t('staffTitle')}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('addStaff')}>➕ {t('addStaff')}</button>
          </div>
          <div className="mt16">
            {staff && staff.length === 0 && <Empty icon="🧹" text="—" />}
            {(staff || []).map(s => {
              const ico = ROLES.find(r => r[0] === s.role)?.[1] || '🤝';
              return (
                <div key={s.id} className="list-item">
                  <div className="avatar" style={{ background: 'linear-gradient(135deg,#0984e3,#74b9ff)' }}>{ico}</div>
                  <div className="grow">
                    <b>{s.name}</b>
                    <div className="muted small">{t(s.role)} · {s.propertyName} {s.phone && `· 📱 ${s.phone}`}</div>
                  </div>
                  <div className="row">
                    <b>{rupee(s.salary)}</b>
                    <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/staff/${s.id}`); load(); } }}>🗑️</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {modal === 'addStaff' && (
        <AddStaffModal properties={properties} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function AddStaffModal({ properties, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ propertyId: properties[0]?.id || '', name: '', role: 'cook', phone: '', salary: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/staff', f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('addStaff')} icon="🧹" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('properties')}`}>
          <select className="input" required value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </Field>
        <Field label={`🙍 ${t('yourName')}`}>
          <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={t('role')}>
          <div className="row wrap">
            {ROLES.map(([v, ico]) => (
              <button type="button" key={v} className={`chip ${f.role === v ? 'active' : ''}`} onClick={() => setF({ ...f, role: v })}>{ico} {t(v)}</button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label={`📱 ${t('phone')}`}>
            <input className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label={`👛 ${t('salaryPerMonth')}`}>
            <input className="input" type="number" min="0" value={f.salary} onChange={e => setF({ ...f, salary: e.target.value })} />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}
