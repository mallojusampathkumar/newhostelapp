import React, { useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from './ui.jsx';
import { fileToDataUrl, printHtml, receiptHtml } from '../util.js';
import { useToast } from '../App.jsx';

/* Shared tenant action sheet — opened from Home beds, Money dues and People.
   Collect (partial) rent, take advance, view the month-by-month statement,
   manage KYC documents, remind, share the portal link, edit and vacate. */

const waLink = (phone, text) => {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return digits
    ? `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
};

const DOC_TYPES = [['aadhaar', '🪪'], ['pan', '💳'], ['passport', '🛂'], ['dl', '🚗'], ['voter', '🗳️'], ['other', '📄']];

export default function TenantSheet({ tenant, onChanged, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [view, setView] = useState('main'); // main | collect | advance | history | edit | kyc
  const [history, setHistory] = useState(null);
  const [dues, setDues] = useState(tenant.dues || { dueAmount: 0, previousDue: 0, currentDue: 0, unpaidMonths: [], breakdown: [] });

  const refreshDues = async () => {
    try {
      const { tenants } = await get(`/tenants?status=active`);
      const fresh = tenants.find(x => x.id === tenant.id);
      if (fresh?.dues) setDues(fresh.dues);
      if (fresh) Object.assign(tenant, { kycStatus: fresh.kycStatus, deposit: fresh.deposit, rent: fresh.rent });
    } catch { /* keep stale */ }
  };

  useEffect(() => {
    if (view === 'history' && history === null) {
      get(`/payments?tenantId=${tenant.id}`).then(d => setHistory(d.payments)).catch(() => setHistory([]));
    }
  }, [view, history, tenant.id]);

  const remind = async () => {
    try {
      const { text, phone } = await get(`/tenants/${tenant.id}/reminder`);
      window.open(waLink(phone, text), '_blank');
    } catch (e) { toast(e.message, 'err'); }
  };

  const sharePortal = async (kycMode = false) => {
    try {
      const { path, phone } = await get(`/tenants/${tenant.id}/portal-link`);
      const url = `${window.location.origin}${path}${kycMode ? '#kyc' : ''}`;
      try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { /* clipboard blocked */ }
      const msg = kycMode
        ? `Namaste ${tenant.name} 🙏\n${t('kycLinkMsg')}\n${url}`
        : `Namaste ${tenant.name} 🙏\nYour personal StaySathi portal — check rent, receipts & notices here:\n${url}`;
      window.open(waLink(phone, msg), '_blank');
    } catch (e) { toast(e.message, 'err'); }
  };

  const vacate = async () => {
    if (!window.confirm(t('confirmVacate'))) return;
    try {
      await post(`/tenants/${tenant.id}/vacate`);
      await onChanged();
      onClose();
    } catch (e) { toast(e.message, 'err'); }
  };

  const printReceipt = (p) => {
    printHtml(`Receipt ${p.receiptNo}`, receiptHtml({
      ...p, tenantName: tenant.name, propertyName: tenant.propertyName,
      roomName: tenant.roomName, phone: tenant.phone
    }));
  };
  const shareReceipt = (p) => {
    const bal = p.balanceAfter > 0 ? `\n${t('stillPending')}: ₹${p.balanceAfter}` : p.balanceAfter === 0 ? `\n✅ ${t('allClear')}` : '';
    const text = `🧾 ${t('receipt')} ${p.receiptNo}\n${tenant.name} — ${tenant.propertyName || ''}\n${t('amount')}: ₹${p.amount}${p.type === 'advance' ? ` (${t('advance')})` : ''}\n${t('date')}: ${p.date} · ${String(p.mode).toUpperCase()}${bal}\n— StaySathi`;
    window.open(waLink(tenant.phone, text), '_blank');
  };

  const kycChip = { pending: ['orange', `🪪 ${t('kycPending')}`], submitted: ['blue', `🪪 ${t('kycSubmitted')}`], verified: ['green', `🪪 ${t('kycVerified')}`], rejected: ['red', `🪪 ${t('kycRejected')}`] }[tenant.kycStatus || 'pending'];

  return (
    <Modal title={tenant.name} icon="🧑" onClose={onClose}>
      <div className="row wrap mb16">
        {tenant.roomName && <span className="chip">🚪 {t('room')} {tenant.roomName}</span>}
        <span className="chip">💰 {rupee(tenant.rent)}/mo</span>
        <span className={`chip ${dues.dueAmount > 0 ? 'red' : 'green'}`}>
          {dues.dueAmount > 0 ? `⚠️ ${t('pending')} ${rupee(dues.dueAmount)}` : `✅ ${t('paid')}`}
        </span>
        {dues.previousDue > 0 && <span className="chip red">⏮️ {t('previousDues')}: {rupee(dues.previousDue)}</span>}
        {dues.currentDue > 0 && <span className="chip orange">📅 {t('currentMonth')}: {rupee(dues.currentDue)}</span>}
        {dues.creditBalance > 0 && <span className="chip green">💚 {t('walletCredit')}: {rupee(dues.creditBalance)}</span>}
        <button className={`chip ${kycChip[0]}`} onClick={() => setView('kyc')}>{kycChip[1]}</button>
      </div>

      {view === 'main' && (
        <>
          <div className="row wrap">
            <button className="btn btn-green grow" onClick={() => setView('collect')}>💰 {t('collectRent')}</button>
            <button className="btn grow" onClick={remind}>🔔 {t('remind')}</button>
          </div>
          <div className="row wrap mt8">
            <button className="btn grow" onClick={() => setView('advance')}>🏦 {t('collectAdvance')}</button>
            <button className="btn grow" onClick={() => setView('kyc')}>🪪 {t('kyc')}</button>
          </div>
          <div className="row wrap mt8">
            <a className="btn grow" href={`tel:${tenant.phone}`}>📞 {t('callTenant')}</a>
            <button className="btn grow" onClick={() => sharePortal(false)}>🔗 {t('sharePortal')}</button>
          </div>
          <div className="row wrap mt8">
            <button className="btn grow" onClick={() => setView('history')}>🧾 {t('paymentHistory')}</button>
            <button className="btn grow" onClick={() => setView('edit')}>✏️ {t('editDetails')}</button>
          </div>
          <button className="btn btn-danger btn-block mt8" onClick={vacate}>👋 {t('vacate')}</button>

          {dues.breakdown?.length > 0 && (
            <div className="card mt16" style={{ padding: 14 }}>
              <b className="small">📒 {t('rentStatement')}</b>
              {dues.breakdown.slice(-6).map((b, i) => (
                <div key={i} className="row spread mt8 small">
                  <span>{b.opening ? `📦 ${t('oldBalance')}` : `📅 ${b.label}`}</span>
                  <span className="muted">{rupee(b.charged)}</span>
                  <span className={`chip ${b.status === 'paid' ? 'green' : b.status === 'partial' ? 'orange' : 'red'}`} style={{ minWidth: 108, justifyContent: 'center' }}>
                    {b.status === 'paid' ? `✅ ${t('paid')}` : b.status === 'partial' ? `🟡 ${rupee(b.due)} ${t('dueStatus')}` : `🔴 ${t('dueStatus')} ${rupee(b.due)}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="muted small center mt16">
            📱 {tenant.phone} · 📅 {t('joinDate')}: {tenant.joinDate}
            {tenant.leaveDate ? ` · 👋 ${t('leaveDate')}: ${tenant.leaveDate}` : ''}
            {tenant.occupation ? ` · 💼 ${tenant.occupation}` : ''}
          </p>
        </>
      )}

      {view === 'collect' && (
        <CollectRent tenant={tenant} dues={dues}
          onDone={async (d) => {
            await onChanged(); await refreshDues();
            toast(d && d.dueAmount > 0 ? `✔ ${t('stillPending')}: ${rupee(d.dueAmount)}` : t('rentRecorded'));
            setHistory(null); setView('main');
          }}
          onCancel={() => setView('main')} />
      )}

      {view === 'advance' && (
        <CollectAdvance tenant={tenant}
          onDone={async () => { await onChanged(); await refreshDues(); toast('✔'); setHistory(null); setView('main'); }}
          onCancel={() => setView('main')} />
      )}

      {view === 'history' && (
        <>
          {history && history.length === 0 && <Empty icon="🧾" text={t('noPaymentsYet')} />}
          {(history || []).map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: p.type === 'advance' ? 'linear-gradient(135deg,#0984e3,#74b9ff)' : 'linear-gradient(135deg,#0ea97f,#2fd3a5)' }}>{p.type === 'advance' ? '🏦' : '₹'}</div>
              <div className="grow">
                <b>{rupee(p.amount)}{p.type === 'advance' ? ` · ${t('advance')}` : ''}</b>
                <div className="muted small">{p.date} · {String(p.mode).toUpperCase()}{p.balanceAfter > 0 ? ` · ${t('stillPending')} ${rupee(p.balanceAfter)}` : ''}</div>
              </div>
              <div className="row">
                <button className="btn btn-sm" title={t('printReceipt')} onClick={() => printReceipt(p)}>🖨️</button>
                <button className="btn btn-sm" title={t('shareReceipt')} onClick={() => shareReceipt(p)}>📤</button>
              </div>
            </div>
          ))}
          <button className="btn btn-block mt8" onClick={() => setView('main')}>← {t('back')}</button>
        </>
      )}

      {view === 'kyc' && (
        <KycPanel tenant={tenant}
          onChanged={async () => { await onChanged(); await refreshDues(); }}
          onShareLink={() => sharePortal(true)}
          onBack={() => setView('main')} />
      )}

      {view === 'edit' && (
        <EditTenant tenant={tenant}
          onDone={async () => { await onChanged(); await refreshDues(); toast('✔'); setView('main'); }}
          onCancel={() => setView('main')} />
      )}
    </Modal>
  );
}

/* ============ collect rent (partial friendly) ============ */
export function CollectRent({ tenant, dues, onDone, onCancel }) {
  const { t } = useLang();
  const toast = useToast();
  const due = dues.dueAmount || 0;
  const [amount, setAmount] = useState(String(due || tenant.rent || 0));
  const [mode, setMode] = useState('upi');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const amt = Number(amount) || 0;
  const toOld = Math.min(amt, dues.previousDue || 0);
  const toCurrent = Math.min(Math.max(amt - toOld, 0), dues.currentDue || 0);
  const extra = Math.max(amt - toOld - toCurrent, 0);
  const remainingAfter = Math.max(due - amt, 0);

  const quick = [
    due > 0 && [t('fullDue'), due],
    dues.previousDue > 0 && [t('oldDuesOnly'), dues.previousDue],
    [t('oneMonth'), (Number(tenant.rent) || 0) + (Number(tenant.maintenance) || 0)]
  ].filter(Boolean);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const res = await post('/payments', { tenantId: tenant.id, amount: amt, mode, date });
      onDone(res.dues);
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  return (
    <form onSubmit={submit}>
      <Field label={`💰 ${t('amountReceived')}`}>
        <input className="input" type="number" min="1" required autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
      </Field>
      <div className="row wrap mb16">
        {quick.map(([l, v]) => (
          <button type="button" key={l} className={`chip ${amt === v ? 'active' : ''}`} onClick={() => setAmount(String(v))}>{l}: {rupee(v)}</button>
        ))}
      </div>

      {/* live allocation preview: old dues are always cleared first */}
      {amt > 0 && due > 0 && (
        <div className="card mb16" style={{ padding: 14 }}>
          <div className="muted small mb8">ℹ️ {t('clearsOldFirst')}</div>
          {toOld > 0 && <div className="row spread small"><span>⏮️ {t('previousDues')}</span><b>- {rupee(toOld)}</b></div>}
          {toCurrent > 0 && <div className="row spread small"><span>📅 {t('currentMonth')}</span><b>- {rupee(toCurrent)}</b></div>}
          {extra > 0 && <div className="row spread small"><span>💚 {t('walletCredit')}</span><b>+ {rupee(extra)}</b></div>}
          <div className="row spread mt8" style={{ borderTop: '1px dashed var(--border2)', paddingTop: 8 }}>
            <b>{t('afterThisPayment')}</b>
            <b style={{ color: remainingAfter > 0 ? '#c53030' : 'var(--green2)' }}>
              {remainingAfter > 0 ? `⚠️ ${t('stillPending')} ${rupee(remainingAfter)}` : `✅ ${t('allClearAfter')}`}
            </b>
          </div>
        </div>
      )}

      <div className="row">
        <Field label={t('payMode')}>
          <div className="seg">
            {[['upi', '📲 UPI'], ['cash', `💵 ${t('cash')}`], ['bank', `🏦 ${t('bank')}`]].map(([v, l]) => (
              <button type="button" key={v} className={mode === v ? 'active' : ''} onClick={() => setMode(v)}>{l}</button>
            ))}
          </div>
        </Field>
        <Field label={`📅 ${t('date')}`}>
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn grow" onClick={onCancel}>{t('cancel')}</button>
        <button className="btn btn-green grow" disabled={busy || amt <= 0}>✅ {t('save')}</button>
      </div>
    </form>
  );
}

/* ============ collect advance / deposit ============ */
function CollectAdvance({ tenant, onDone, onCancel }) {
  const { t } = useLang();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('upi');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await post('/payments', { tenantId: tenant.id, amount: Number(amount), mode, type: 'advance' });
      onDone();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <p className="muted small mb16">🏦 {t('deposit')}: {rupee(tenant.deposit)}</p>
      <Field label={`💰 ${t('amount')}`}>
        <input className="input" type="number" min="1" required autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
      </Field>
      <Field label={t('payMode')}>
        <div className="seg">
          {[['upi', '📲 UPI'], ['cash', `💵 ${t('cash')}`], ['bank', `🏦 ${t('bank')}`]].map(([v, l]) => (
            <button type="button" key={v} className={mode === v ? 'active' : ''} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
      </Field>
      <div className="row">
        <button type="button" className="btn grow" onClick={onCancel}>{t('cancel')}</button>
        <button className="btn btn-green grow" disabled={busy}>✅ {t('save')}</button>
      </div>
    </form>
  );
}

/* ============ KYC documents ============ */
function KycPanel({ tenant, onChanged, onShareLink, onBack }) {
  const { t } = useLang();
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [status, setStatus] = useState(tenant.kycStatus || 'pending');
  const [form, setForm] = useState(null); // {docType, idNumber, image}
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(null);

  const load = () => get(`/kyc-records`).then(d => {
    const rec = d.records.find(r => r.id === tenant.id);
    setDocs(rec?.docs || []);
    if (rec) { setStatus(rec.kycStatus); tenant.kycStatus = rec.kycStatus; }
  }).catch(() => setDocs([]));
  useEffect(() => { load(); }, []); // eslint-disable-line

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const image = await fileToDataUrl(file);
      setForm(f => ({ ...(f || { docType: 'aadhaar', idNumber: '' }), image }));
    } catch (err) { toast(err.message, 'err'); }
  };

  const upload = async () => {
    if (!form?.image) return toast(t('uploadDoc'), 'err');
    setBusy(true);
    try {
      await post(`/tenants/${tenant.id}/kyc-docs`, form);
      setForm(null); await load(); await onChanged(); toast('✔');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const setKyc = async (s) => {
    try {
      const r = await post(`/tenants/${tenant.id}/kyc-status`, { status: s });
      setStatus(r.kycStatus); tenant.kycStatus = r.kycStatus;
      await onChanged(); toast('✔');
    } catch (e) { toast(e.message, 'err'); }
  };

  const removeDoc = async (d) => {
    if (!window.confirm(t('deleteQ'))) return;
    try {
      const r = await del(`/tenants/${tenant.id}/kyc-docs/${d.id}`);
      setStatus(r.kycStatus); tenant.kycStatus = r.kycStatus;
      await load(); await onChanged();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="row wrap mb16">
        <span className={`chip ${status === 'verified' ? 'green' : status === 'submitted' ? 'blue' : status === 'rejected' ? 'red' : 'orange'}`}>
          🪪 {status === 'verified' ? t('kycVerified') : status === 'submitted' ? t('kycSubmitted') : status === 'rejected' ? t('kycRejected') : t('kycPending')}
        </span>
        <span className="chip">{(docs || []).length}/3 📄</span>
      </div>

      {docs && docs.length === 0 && <p className="muted small mb16">⚠️ {t('kycPendingNote')}</p>}

      {(docs || []).map(d => (
        <div key={d.id} className="list-item">
          <div className="avatar" style={{ background: 'linear-gradient(135deg,#6c5ce7,#8e7bff)' }}>
            {DOC_TYPES.find(x => x[0] === d.docType)?.[1] || '📄'}
          </div>
          <div className="grow">
            <b>{t(`${d.docType}Doc`) || d.docType}</b>
            <div className="muted small">{d.idNumber || '—'} · {t('kycUploadedBy')}: {d.uploadedBy} · {new Date(d.createdAt).toLocaleDateString()}</div>
          </div>
          <div className="row">
            <button className="btn btn-sm" onClick={() => setZoom(d.id)}>👁️</button>
            <button className="btn btn-sm btn-ghost" onClick={() => removeDoc(d)}>🗑️</button>
          </div>
        </div>
      ))}
      {zoom && <KycImage tenantId={tenant.id} docId={zoom} onClose={() => setZoom(null)} />}

      {(docs || []).length < 3 && (
        <div className="card mt8" style={{ padding: 14 }}>
          <b className="small">➕ {t('uploadDoc')}</b>
          <div className="row wrap mt8">
            {DOC_TYPES.map(([v, ico]) => (
              <button type="button" key={v} className={`chip ${form?.docType === v ? 'active' : ''}`}
                onClick={() => setForm(f => ({ ...(f || { idNumber: '', image: null }), docType: v }))}>{ico} {t(`${v}Doc`)}</button>
            ))}
          </div>
          <input className="input mt8" placeholder={t('idNumber')} value={form?.idNumber || ''}
            onChange={e => setForm(f => ({ ...(f || { docType: 'aadhaar', image: null }), idNumber: e.target.value }))} />
          <label className="btn btn-block mt8">
            📷 {form?.image ? '✅ ' : ''}{t('choosePhoto').replace(' (OCR)', '')}
            <input type="file" accept="image/*" hidden onChange={pick} />
          </label>
          {form?.image && <img src={form.image} alt="doc" style={{ width: '100%', borderRadius: 12, marginTop: 8 }} />}
          <button className="btn btn-primary btn-block mt8" disabled={busy || !form?.image} onClick={upload}>⬆️ {t('save')}</button>
        </div>
      )}

      <div className="row wrap mt16">
        <button className="btn btn-green grow" disabled={!docs || docs.length === 0 || status === 'verified'} onClick={() => setKyc('verified')}>✅ {t('verifyKyc')}</button>
        <button className="btn grow" disabled={!docs || docs.length === 0} onClick={() => setKyc('rejected')}>❌ {t('rejectKyc')}</button>
      </div>
      <button className="btn btn-block mt8" onClick={onShareLink}>🔗 {t('sendKycLink')}</button>
      <button className="btn btn-block mt8" onClick={onBack}>← {t('back')}</button>
    </>
  );
}

// doc images are heavy, fetch one only when the owner asks to see it
function KycImage({ tenantId, docId, onClose }) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    get(`/tenants/${tenantId}/kyc-docs/${docId}/image`).then(d => setImg(d.image)).catch(() => setImg('err'));
  }, [tenantId, docId]);
  return (
    <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={onClose}>
      <div style={{ maxWidth: 420, margin: '10vh auto', padding: 16 }}>
        {img && img !== 'err' ? <img src={img} alt="KYC doc" style={{ width: '100%', borderRadius: 16 }} /> : <div className="empty"><span className="ico">⏳</span></div>}
      </div>
    </div>
  );
}

/* ============ edit ============ */
function EditTenant({ tenant, onDone, onCancel }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({
    name: tenant.name, phone: tenant.phone,
    rent: tenant.rent ?? '', deposit: tenant.deposit ?? '',
    maintenance: tenant.maintenance ?? '', occupation: tenant.occupation || '',
    joinDate: tenant.joinDate || '', leaveDate: tenant.leaveDate || ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await put(`/tenants/${tenant.id}`, { ...f, leaveDate: f.leaveDate || null });
      Object.assign(tenant, { ...f, rent: Number(f.rent) || 0, deposit: Number(f.deposit) || 0, maintenance: Number(f.maintenance) || 0, leaveDate: f.leaveDate || null });
      onDone();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <Field label={`🙍 ${t('tenantName')}`}>
        <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={`📱 ${t('phone')}`}>
        <input className="input" required value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
      </Field>
      <div className="row">
        <Field label={`💰 ${t('monthlyRent')}`}>
          <input className="input" type="number" min="0" required value={f.rent} onChange={e => setF({ ...f, rent: e.target.value })} />
        </Field>
        <Field label={`🔧 ${t('maintenanceLabel')}`}>
          <input className="input" type="number" min="0" value={f.maintenance} onChange={e => setF({ ...f, maintenance: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Field label={`🏦 ${t('deposit')}`}>
          <input className="input" type="number" min="0" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} />
        </Field>
        <Field label={`💼 ${t('occupation')}`}>
          <input className="input" value={f.occupation} onChange={e => setF({ ...f, occupation: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <Field label={`📅 ${t('joinDate')}`}>
          <input className="input" type="date" value={f.joinDate} onChange={e => setF({ ...f, joinDate: e.target.value })} />
        </Field>
        <Field label={`👋 ${t('leaveDate')}`}>
          <input className="input" type="date" value={f.leaveDate} onChange={e => setF({ ...f, leaveDate: e.target.value })} />
        </Field>
      </div>
      <div className="row">
        <button type="button" className="btn grow" onClick={onCancel}>{t('cancel')}</button>
        <button className="btn btn-primary grow" disabled={busy}>✅ {t('save')}</button>
      </div>
    </form>
  );
}
