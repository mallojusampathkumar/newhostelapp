import React, { useEffect, useState } from 'react';
import { get, post, put } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from './ui.jsx';
import { useToast } from '../App.jsx';

/* Shared tenant action sheet — opened from Home beds, Money dues and People.
   One place to collect rent, remind, call, share the portal link, view
   history, edit details, toggle KYC and vacate. */

const waLink = (phone, text) => {
  const digits = String(phone || '').replace(/\D/g, '').slice(-10);
  return digits
    ? `https://wa.me/91${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
};

export default function TenantSheet({ tenant, onChanged, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [view, setView] = useState('main'); // main | collect | history | edit
  const [history, setHistory] = useState(null);
  const dues = tenant.dues || { dueAmount: 0, unpaidMonths: [] };

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

  const sharePortal = async () => {
    try {
      const { path, phone } = await get(`/tenants/${tenant.id}/portal-link`);
      const url = `${window.location.origin}${path}`;
      try { await navigator.clipboard.writeText(url); toast(t('linkCopied')); } catch { /* clipboard blocked */ }
      const msg = `Namaste ${tenant.name} 🙏\nYour personal StaySathi portal — check rent, receipts & notices here:\n${url}`;
      window.open(waLink(phone, msg), '_blank');
    } catch (e) { toast(e.message, 'err'); }
  };

  const toggleKyc = async () => {
    const next = tenant.kycStatus === 'verified' ? 'pending' : 'verified';
    try {
      await put(`/tenants/${tenant.id}`, { kycStatus: next });
      tenant.kycStatus = next;
      await onChanged();
      toast('✔');
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

  const shareReceipt = (p) => {
    const text = `🧾 ${t('receipt')} ${p.receiptNo}\n${tenant.name} — ${tenant.propertyName || ''}\n${t('amount')}: ₹${p.amount}\n${t('date')}: ${p.date} · ${String(p.mode).toUpperCase()}\n${(p.months || []).join(', ')}\n— StaySathi`;
    window.open(waLink(tenant.phone, text), '_blank');
  };

  return (
    <Modal title={tenant.name} icon="🧑" onClose={onClose}>
      <div className="row wrap mb16">
        {tenant.roomName && <span className="chip">🚪 {t('room')} {tenant.roomName}</span>}
        {tenant.propertyName && <span className="chip">🏠 {tenant.propertyName}</span>}
        <span className="chip">💰 {rupee(tenant.rent)}/mo</span>
        <span className={`chip ${dues.dueAmount > 0 ? 'red' : 'green'}`}>
          {dues.dueAmount > 0 ? `⚠️ ${t('pending')} ${rupee(dues.dueAmount)}` : `✅ ${t('paid')}`}
        </span>
        {dues.unpaidMonths.length > 0 && <span className="chip orange">📅 {dues.unpaidMonths.join(', ')}</span>}
        <button className={`chip ${tenant.kycStatus === 'verified' || tenant.kycStatus === 'submitted' ? 'green' : 'orange'}`} onClick={toggleKyc}>
          🪪 {tenant.kycStatus === 'pending' ? t('kycPending') : t('kycDone')}
        </button>
      </div>

      {view === 'main' && (
        <>
          <div className="row wrap">
            <button className="btn btn-green grow" onClick={() => setView('collect')}>💰 {t('collectRent')}</button>
            <button className="btn grow" onClick={remind}>🔔 {t('remind')}</button>
          </div>
          <div className="row wrap mt8">
            <a className="btn grow" href={`tel:${tenant.phone}`}>📞 {t('callTenant')}</a>
            <button className="btn grow" onClick={sharePortal}>🔗 {t('sharePortal')}</button>
          </div>
          <div className="row wrap mt8">
            <button className="btn grow" onClick={() => setView('history')}>🧾 {t('paymentHistory')}</button>
            <button className="btn grow" onClick={() => setView('edit')}>✏️ {t('editDetails')}</button>
          </div>
          <button className="btn btn-danger btn-block mt8" onClick={vacate}>👋 {t('vacate')}</button>
          <p className="muted small center mt16">
            📱 {tenant.phone} · 📅 {t('joinDate')}: {tenant.joinDate}
            {tenant.occupation ? ` · 💼 ${tenant.occupation}` : ''}
          </p>
          <p className="muted small center mt8">{t('portalHint')}</p>
        </>
      )}

      {view === 'collect' && (
        <CollectRent tenant={tenant} dues={dues}
          onDone={async () => { await onChanged(); toast(t('rentRecorded')); onClose(); }}
          onCancel={() => setView('main')} />
      )}

      {view === 'history' && (
        <>
          {history && history.length === 0 && <Empty icon="🧾" text={t('noPaymentsYet')} />}
          {(history || []).map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#0ea97f,#2fd3a5)' }}>₹</div>
              <div className="grow">
                <b>{rupee(p.amount)}</b>
                <div className="muted small">{p.date} · {String(p.mode).toUpperCase()} · {(p.months || []).join(', ')}</div>
              </div>
              <button className="btn btn-sm" onClick={() => shareReceipt(p)}>📤 {t('shareReceipt')}</button>
            </div>
          ))}
          <button className="btn btn-block mt8" onClick={() => setView('main')}>← {t('back')}</button>
        </>
      )}

      {view === 'edit' && (
        <EditTenant tenant={tenant}
          onDone={async () => { await onChanged(); toast('✔'); setView('main'); }}
          onCancel={() => setView('main')} />
      )}
    </Modal>
  );
}

export function CollectRent({ tenant, dues, onDone, onCancel }) {
  const { t } = useLang();
  const toast = useToast();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const options = dues.unpaidMonths.length ? dues.unpaidMonths : [currentMonth];
  const [selected, setSelected] = useState(new Set(options.slice(0, 1)));
  const [mode, setMode] = useState('upi');
  const [amount, setAmount] = useState(String((tenant.rent || 0) * 1));
  const [busy, setBusy] = useState(false);

  const toggle = (m) => {
    const next = new Set(selected);
    next.has(m) ? next.delete(m) : next.add(m);
    if (next.size === 0) next.add(m);
    setSelected(next);
    setAmount(String((tenant.rent || 0) * next.size));
  };

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await post('/payments', { tenantId: tenant.id, amount: Number(amount), months: [...selected], mode });
      onDone();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };

  return (
    <form onSubmit={submit}>
      <Field label={`📅 ${t('forMonths')}`}>
        <div className="row wrap">
          {options.map(m => (
            <button type="button" key={m} className={`chip ${selected.has(m) ? 'active' : ''}`} onClick={() => toggle(m)}>{m}</button>
          ))}
        </div>
      </Field>
      <Field label={`💰 ${t('amount')}`}>
        <input className="input" type="number" min="1" required value={amount} onChange={e => setAmount(e.target.value)} />
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

function EditTenant({ tenant, onDone, onCancel }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({
    name: tenant.name, phone: tenant.phone,
    rent: tenant.rent ?? '', deposit: tenant.deposit ?? '', occupation: tenant.occupation || ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await put(`/tenants/${tenant.id}`, f);
      Object.assign(tenant, { ...f, rent: Number(f.rent) || 0, deposit: Number(f.deposit) || 0 });
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
        <Field label={`🏦 ${t('deposit')}`}>
          <input className="input" type="number" min="0" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} />
        </Field>
      </div>
      <Field label={`💼 ${t('occupation')}`}>
        <input className="input" value={f.occupation} onChange={e => setF({ ...f, occupation: e.target.value })} />
      </Field>
      <div className="row">
        <button type="button" className="btn grow" onClick={onCancel}>{t('cancel')}</button>
        <button className="btn btn-primary grow" disabled={busy}>✅ {t('save')}</button>
      </div>
    </form>
  );
}
