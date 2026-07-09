import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import TenantSheet from '../components/TenantSheet.jsx';
import { downloadCsv } from '../util.js';
import { useToast } from '../App.jsx';

const ROLES = [['cook', '🍲'], ['watchman', '💂'], ['cleaner', '🧹'], ['warden', '🧑‍🏫'], ['manager', '🧑‍💼'], ['helper', '🤝']];

export default function People({ overview, refreshOverview }) {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState('tenants'); // tenants | kyc | staff
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [propId, setPropId] = useState('');
  const [tenants, setTenants] = useState(null);
  const [staff, setStaff] = useState(null);
  const [salaryHistory, setSalaryHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [kycRecords, setKycRecords] = useState(null);
  const [modal, setModal] = useState(null); // 'addStaff' | {payStaff} | {editStaff}
  const [sheetTenant, setSheetTenant] = useState(null);

  const properties = overview?.properties || [];

  const q = propId ? `?propertyId=${propId}` : '';
  const load = useCallback(() => {
    get(`/tenants${q}`).then(d => setTenants(d.tenants)).catch(() => {});
    get(`/staff${q}`).then(d => setStaff(d.staff)).catch(() => {});
    get(`/salary-payments${q}`).then(d => setSalaryHistory(d.payments)).catch(() => {});
    get('/kyc-records').then(d => setKycRecords(d.records)).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const exportKyc = () => downloadCsv('staysathi-kyc.csv', [
    ['Tenant', 'Phone', 'Property', 'Room', 'KYC Status', 'Documents'],
    ...(kycRecords || []).map(r => [r.name, r.phone, r.propertyName, r.roomName, r.kycStatus,
      r.docs.map(d => `${d.docType}${d.idNumber ? ':' + d.idNumber : ''}`).join(' | ')])
  ]);

  const kycChip = (s) => s === 'verified' ? ['green', `✅ ${t('kycVerified')}`]
    : s === 'submitted' ? ['blue', `🔵 ${t('kycSubmitted')}`]
    : s === 'rejected' ? ['red', `❌ ${t('kycRejected')}`]
    : ['orange', `🟠 ${t('kycPending')}`];

  const filtered = (tenants || [])
    .filter(x => x.status === status)
    .filter(x => !search || x.name.toLowerCase().includes(search.toLowerCase()) || x.phone.includes(search));

  return (
    <div className="page">
      <h2 className="title">👥 {t('navPeople')}</h2>

      <div className="filter-bar">
        <select className="input" value={propId} onChange={e => setPropId(e.target.value)}>
          <option value="">🏠 {t('allProperties')}</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </div>

      <div className="seg mt8">
        <button className={seg === 'tenants' ? 'active' : ''} onClick={() => setSeg('tenants')}>🧑 {t('tenants')}</button>
        <button className={seg === 'kyc' ? 'active' : ''} onClick={() => setSeg('kyc')}>🪪 {t('kyc')}</button>
        <button className={seg === 'staff' ? 'active' : ''} onClick={() => setSeg('staff')}>🧹 {t('staffTitle')}</button>
      </div>

      {seg === 'kyc' && (
        <>
          <div className="row spread mt16">
            <span className="chip">🪪 {(kycRecords || []).filter(r => r.kycStatus === 'verified').length}/{(kycRecords || []).length} {t('kycVerified')}</span>
            <button className="btn btn-sm" onClick={exportKyc}>⬇️ {t('kycExport')}</button>
          </div>
          <div className="mt16">
            {kycRecords && kycRecords.length === 0 && <Empty icon="🪪" text={t('noTenants')} />}
            {(kycRecords || [])
              .filter(r => !propId || (tenants || []).some(x => x.id === r.id && x.propertyId === propId))
              .sort((a, b) => (a.kycStatus === 'submitted' ? -1 : 0) - (b.kycStatus === 'submitted' ? -1 : 0))
              .map(r => {
                const [cls, label] = kycChip(r.kycStatus);
                const tenant = (tenants || []).find(x => x.id === r.id);
                return (
                  <div key={r.id} className="list-item tap" onClick={() => tenant && setSheetTenant(tenant)}>
                    <div className="avatar" style={{ background: 'linear-gradient(135deg,#6c5ce7,#8e7bff)' }}>🪪</div>
                    <div className="grow">
                      <b>{r.name}</b>
                      <div className="muted small">{r.propertyName} · {t('room')} {r.roomName} · 📄 {r.docs.length}/3</div>
                    </div>
                    <span className={`chip ${cls}`}>{label}</span>
                  </div>
                );
              })}
          </div>
        </>
      )}

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
              <div key={x.id} className={`list-item ${x.status === 'active' ? 'tap' : ''}`}
                onClick={() => x.status === 'active' && setSheetTenant(x)}>
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
                    <span className={`chip ${kycChip(x.kycStatus)[0]}`}>🪪 {kycChip(x.kycStatus)[1].replace(/^\S+ /, '')}</span>
                  </div>
                </div>
                <a className="btn btn-sm" href={`tel:${x.phone}`} onClick={e => e.stopPropagation()}>📞</a>
              </div>
            ))}
          </div>
        </>
      )}

      {seg === 'staff' && (
        <>
          <div className="row spread mt16">
            <span className="chip">👛 {t('monthlySalaries')}: {rupee((staff || []).reduce((a, s) => a + (Number(s.salary) || 0), 0))}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('addStaff')}>➕ {t('addStaff')}</button>
          </div>
          <div className="row wrap mt8">
            <button className={`chip ${!showHistory ? 'active' : ''}`} onClick={() => setShowHistory(false)}>🧹 {t('staffTitle')} ({(staff || []).length})</button>
            <button className={`chip ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory(true)}>🧾 {t('salaryHistory')}</button>
          </div>

          {!showHistory && (
            <div className="mt16">
              {staff && staff.length === 0 && <Empty icon="🧹" text={t('noStaffYet')} />}
              {(staff || []).map(s => {
                const ico = ROLES.find(r => r[0] === s.role)?.[1] || '🤝';
                const salary = Number(s.salary) || 0;
                const paid = Number(s.paidThisMonth) || 0;
                const chip = salary <= 0 ? null
                  : paid >= salary ? ['green', `✅ ${t('paid')} · ${t('thisMonth')}`]
                  : paid > 0 ? ['orange', `🟡 ${t('partialPaid')} ${rupee(paid)}/${rupee(salary)}`]
                  : ['red', `⏳ ${t('salaryDue')} · ${t('thisMonth')}`];
                return (
                  <div key={s.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="row">
                      <div className="avatar" style={{ background: 'linear-gradient(135deg,#0984e3,#74b9ff)' }}>{ico}</div>
                      <div className="grow">
                        <b>{s.name}</b>
                        <div className="muted small">{t(s.role)} · {s.propertyName}{s.phone ? ` · 📱 ${s.phone}` : ''}</div>
                      </div>
                      <b>{rupee(salary)}<span className="muted small">/mo</span></b>
                    </div>
                    <div className="row wrap mt8">
                      {chip && <span className={`chip small ${chip[0]}`}>{chip[1]}</span>}
                      {s.lastPaidDate && <span className="chip small">🗓️ {t('lastPaid')}: {s.lastPaidDate}</span>}
                    </div>
                    <div className="row mt8">
                      <button className="btn btn-sm btn-green grow" onClick={() => setModal({ payStaff: s })}>💸 {t('paySalary')}</button>
                      <button className="btn btn-sm" title={t('editStaff')} onClick={() => setModal({ editStaff: s })}>✏️</button>
                      <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/staff/${s.id}`); load(); } }}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {showHistory && (
            <div className="mt16">
              {salaryHistory && salaryHistory.length === 0 && <Empty icon="👛" text={t('noSalaryPayments')} />}
              {(salaryHistory || []).map(p => (
                <div key={p.id} className="list-item">
                  <div className="avatar" style={{ background: 'linear-gradient(135deg,#f59f00,#ffc14d)' }}>👛</div>
                  <div className="grow">
                    <b>{p.staffName}</b> <span className="muted small">· {t(p.role)}</span>
                    <div className="muted small">📅 {p.monthLabel} · {p.date} · {String(p.mode).toUpperCase()}{p.note ? ` · ${p.note}` : ''}</div>
                  </div>
                  <div className="row">
                    <b>{rupee(p.amount)}</b>
                    <button className="btn btn-sm btn-ghost" onClick={async () => {
                      if (window.confirm(t('deleteQ'))) { await del(`/salary-payments/${p.id}`); load(); refreshOverview && refreshOverview(); }
                    }}>🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {modal === 'addStaff' && (
        <StaffModal properties={properties} defaultProp={propId} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} />
      )}
      {modal?.editStaff && (
        <StaffModal properties={properties} staff={modal.editStaff} onDone={() => { setModal(null); load(); }} onClose={() => setModal(null)} />
      )}
      {modal?.payStaff && (
        <PaySalaryModal staff={modal.payStaff}
          onDone={() => { setModal(null); toast(t('salaryRecorded')); load(); refreshOverview && refreshOverview(); }}
          onClose={() => setModal(null)} />
      )}
      {sheetTenant && (
        <TenantSheet tenant={sheetTenant}
          onChanged={async () => { load(); refreshOverview && refreshOverview(); }}
          onClose={() => setSheetTenant(null)} />
      )}
    </div>
  );
}

/* add + edit share one modal: pass `staff` to edit */
function StaffModal({ properties, staff, defaultProp, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const editing = !!staff;
  const [f, setF] = useState({
    propertyId: staff?.propertyId || defaultProp || properties[0]?.id || '',
    name: staff?.name || '', role: staff?.role || 'cook',
    phone: staff?.phone || '', salary: staff?.salary ?? ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      if (editing) await put(`/staff/${staff.id}`, f);
      else await post('/staff', f);
      onDone();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={editing ? t('editStaff') : t('addStaff')} icon={editing ? '✏️' : '🧹'} onClose={onClose}>
      <form onSubmit={submit}>
        {!editing && (
          <Field label={`🏠 ${t('properties')}`}>
            <select className="input" required value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
              {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
            </select>
          </Field>
        )}
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

/* record a salary payment — amount prefills with what is still due this month */
function PaySalaryModal({ staff, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const salary = Number(staff.salary) || 0;
  const dueNow = Math.max(0, salary - (Number(staff.paidThisMonth) || 0));
  const [f, setF] = useState({
    amount: String(dueNow || salary || ''),
    month: thisMonth,
    mode: 'cash',
    date: new Date().toISOString().slice(0, 10),
    note: ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/staff/${staff.id}/pay-salary`, f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={`${t('paySalary')} — ${staff.name}`} icon="💸" onClose={onClose}>
      <p className="muted small mb16">
        {ROLES.find(r => r[0] === staff.role)?.[1] || '🤝'} {t(staff.role)} · {staff.propertyName} · 👛 {rupee(salary)}/mo
      </p>
      <form onSubmit={submit}>
        <Field label={`💰 ${t('amount')}`}>
          <input className="input" type="number" min="1" required autoFocus value={f.amount}
            onChange={e => setF({ ...f, amount: e.target.value })} />
        </Field>
        {salary > 0 && (
          <div className="row wrap mb16">
            {dueNow > 0 && dueNow !== salary && (
              <button type="button" className={`chip ${Number(f.amount) === dueNow ? 'active' : ''}`}
                onClick={() => setF({ ...f, amount: String(dueNow) })}>{t('salaryDue')}: {rupee(dueNow)}</button>
            )}
            <button type="button" className={`chip ${Number(f.amount) === salary ? 'active' : ''}`}
              onClick={() => setF({ ...f, amount: String(salary) })}>{t('salaryPerMonth')}: {rupee(salary)}</button>
          </div>
        )}
        <div className="row">
          <Field label={`📅 ${t('forMonth')}`}>
            <input className="input" type="month" required value={f.month} onChange={e => setF({ ...f, month: e.target.value })} />
          </Field>
          <Field label={`📅 ${t('date')}`}>
            <input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
          </Field>
        </div>
        <Field label={t('payMode')}>
          <div className="seg">
            {[['cash', `💵 ${t('cash')}`], ['upi', '📲 UPI'], ['bank', `🏦 ${t('bank')}`]].map(([v, l]) => (
              <button type="button" key={v} className={f.mode === v ? 'active' : ''} onClick={() => setF({ ...f, mode: v })}>{l}</button>
            ))}
          </div>
        </Field>
        <Field label={`📝 ${t('note')}`}>
          <input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="btn btn-green btn-block" disabled={busy || !(Number(f.amount) > 0)}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}
