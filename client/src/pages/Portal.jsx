import React, { useCallback, useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, LangPicker, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

/* Public tenant portal — opened from the token link the owner shares.
   No login: the token IS the access. Tenants see their dues, receipts,
   notices and complaints, and can raise complaints / claim a payment. */

const CMP_CATS = [['plumbing', '🚰'], ['electrical', '⚡'], ['food', '🍛'], ['cleaning', '🧹'], ['wifi', '📶'], ['noise', '📣'], ['other', '📦']];

export default function Portal({ token }) {
  const { t } = useLang();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [seg, setSeg] = useState('rent'); // rent | notices | complaints
  const [modal, setModal] = useState(null); // complaint | paid

  const load = useCallback(() => {
    get(`/portal/${token}`).then(setData).catch(e => setError(e.message));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="portal-wrap">
        <Empty icon="🔗" text={error} />
      </div>
    );
  }
  if (!data) {
    return <div className="auth-wrap"><div className="bubble hero-bubble"><span className="ico">🏠</span><span className="name">StaySathi</span></div></div>;
  }

  const { tenant, property, owner, roomName, dues, payments, notices, complaints } = data;

  return (
    <div className="portal-wrap">
      <div className="row spread" style={{ padding: '10px 2px' }}>
        <div className="logo" style={{ fontSize: 19 }}><span className="orb" style={{ width: 36, height: 36, fontSize: 18 }}>🏠</span>StaySathi</div>
        <LangPicker compact />
      </div>

      <div className="portal-head">
        <div className="big-ico">{property?.icon || '🏠'}</div>
        <h2>{tenant.name}</h2>
        <div className="sub">{property?.name}{roomName ? ` · ${t('room')} ${roomName}` : ''}</div>
      </div>

      <div className="portal-due">
        {dues.dueAmount > 0 ? (
          <>
            <div className="muted small">⚠️ {t('dueNow')}</div>
            <div className="amt due-amt">{rupee(dues.dueAmount)}</div>
            <div className="muted small">📅 {dues.unpaidMonths.join(', ')}</div>
            <button className="btn btn-green btn-block mt16" onClick={() => setModal('paid')}>💸 {t('iPaid')}</button>
          </>
        ) : (
          <>
            <div className="amt" style={{ color: 'var(--green2)' }}>✅</div>
            <b>{t('allClear')}</b>
          </>
        )}
      </div>

      <div className="row wrap mt16">
        <span className="chip">💰 {t('monthlyRentLabel')}: {rupee(tenant.rent)}</span>
        {tenant.deposit > 0 && <span className="chip">🏦 {t('depositLabel')}: {rupee(tenant.deposit)}</span>}
        <span className="chip">📅 {t('memberSince')}: {tenant.joinDate}</span>
        {owner && <a className="chip blue" href={`tel:${owner.phone}`}>📞 {t('ownerLabel')}: {owner.name}</a>}
      </div>

      <div className="seg mt16">
        {[['rent', `🧾 ${t('paymentHistory')}`], ['notices', `📢 ${t('noticeBoard')}`], ['complaints', `🛠️ ${t('myComplaints')}`]].map(([v, l]) => (
          <button key={v} className={seg === v ? 'active' : ''} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>

      {seg === 'rent' && (
        <div className="mt16">
          {payments.length === 0 && <Empty icon="🧾" text={t('noPaymentsYet')} />}
          {payments.map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#0ea97f,#2fd3a5)' }}>₹</div>
              <div className="grow">
                <b>{rupee(p.amount)}</b>
                <div className="muted small">{p.date} · {String(p.mode).toUpperCase()} · {t('receipt')} {p.receiptNo}</div>
                <div className="muted small">📅 {(p.months || []).join(', ')}</div>
              </div>
              <span className="chip green">✅ {t('paid')}</span>
            </div>
          ))}
        </div>
      )}

      {seg === 'notices' && (
        <div className="mt16">
          {notices.length === 0 && <Empty icon="📢" text="—" />}
          {notices.map(n => (
            <div key={n.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#f59f00,#ffc14d)' }}>📢</div>
              <div className="grow">
                <div>{n.text}</div>
                <div className="muted small mt8">{new Date(n.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {seg === 'complaints' && (
        <div className="mt16">
          <button className="btn btn-primary btn-block mb16" onClick={() => setModal('complaint')}>➕ {t('raiseComplaint')}</button>
          {complaints.length === 0 && <Empty icon="🎉" text="—" />}
          {complaints.map(c => {
            const ico = CMP_CATS.find(x => x[0] === c.category)?.[1] || '📦';
            return (
              <div key={c.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                <div className="avatar" style={{ background: c.status === 'resolved' ? 'linear-gradient(135deg,#0ea97f,#2fd3a5)' : 'linear-gradient(135deg,#e5484d,#f2707f)' }}>{ico}</div>
                <div className="grow">
                  <b>{t(c.category)}</b>
                  <div className="small" style={{ margin: '4px 0' }}>{c.text}</div>
                  <div className="muted small">{t('submittedOn')}: {new Date(c.createdAt).toLocaleDateString()}</div>
                </div>
                <span className={`chip ${c.status === 'resolved' ? 'green' : c.status === 'inprogress' ? 'orange' : 'red'}`}>
                  {c.status === 'open' ? '🔴' : c.status === 'inprogress' ? '🟡' : '🟢'} {t(c.status)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted small center mt24">{t('madeWith')}</p>

      {modal === 'complaint' && (
        <PortalComplaintModal token={token}
          onDone={() => { setModal(null); load(); toast('✔'); }} onClose={() => setModal(null)} />
      )}
      {modal === 'paid' && (
        <PaidClaimModal token={token} rent={tenant.rent} dueAmount={dues.dueAmount}
          onDone={() => { setModal(null); toast(t('claimSent')); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function PortalComplaintModal({ token, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ category: 'plumbing', text: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/portal/${token}/complaints`, f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('raiseComplaint')} icon="🛠️" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={t('category')}>
          <div className="row wrap">
            {CMP_CATS.map(([v, ico]) => (
              <button type="button" key={v} className={`chip ${f.category === v ? 'active' : ''}`} onClick={() => setF({ ...f, category: v })}>{ico} {t(v)}</button>
            ))}
          </div>
        </Field>
        <Field label={`📝 ${t('note')}`}>
          <textarea className="input" rows={3} required placeholder={t('describeIssue')} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

function PaidClaimModal({ token, rent, dueAmount, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ amount: dueAmount || rent || '', note: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/portal/${token}/paid-claim`, f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('iPaid')} icon="💸" onClose={onClose}>
      <p className="muted mb16">{t('iPaidHint')}</p>
      <form onSubmit={submit}>
        <Field label={`💰 ${t('amount')}`}>
          <input className="input" type="number" min="1" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label={`📝 ${t('note')}`}>
          <input className="input" placeholder="UPI / GPay ref…" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="btn btn-green btn-block" disabled={busy}>📤 {t('save')}</button>
      </form>
    </Modal>
  );
}
