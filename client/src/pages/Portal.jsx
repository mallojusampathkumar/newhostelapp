import React, { useCallback, useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, LangPicker, rupee } from '../components/ui.jsx';
import { fileToDataUrl } from '../util.js';
import { useToast } from '../App.jsx';

/* Public tenant portal — opened from the token link the owner shares.
   No login: the token IS the access. Tenants see their dues (old dues vs
   this month), receipts, notices and complaints, upload their KYC documents
   and claim payments with a UPI screenshot. */

const CMP_CATS = [['plumbing', '🚰'], ['electrical', '⚡'], ['food', '🍛'], ['cleaning', '🧹'], ['wifi', '📶'], ['noise', '📣'], ['other', '📦']];
const DOC_TYPES = [['aadhaar', '🪪'], ['pan', '💳'], ['passport', '🛂'], ['dl', '🚗'], ['voter', '🗳️'], ['other', '📄']];

export default function Portal({ token }) {
  const { t } = useLang();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // owner can deep-link straight to the KYC tab (…/portal/<token>#kyc)
  const [seg, setSeg] = useState(window.location.hash === '#kyc' ? 'kyc' : 'rent'); // rent | kyc | notices | complaints
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
            <div className="row wrap mt8" style={{ justifyContent: 'center' }}>
              {dues.previousDue > 0 && <span className="chip red">⏮️ {t('previousDues')}: {rupee(dues.previousDue)}</span>}
              {dues.currentDue > 0 && <span className="chip orange">📅 {t('currentMonth')}: {rupee(dues.currentDue)}</span>}
            </div>
            <button className="btn btn-green btn-block mt16" onClick={() => setModal('paid')}>💸 {t('iPaid')}</button>
          </>
        ) : (
          <>
            <div className="amt" style={{ color: 'var(--green2)' }}>✅</div>
            <b>{t('allClear')}</b>
            {dues.creditBalance > 0 && <div className="chip green mt8">💚 {t('walletCredit')}: {rupee(dues.creditBalance)}</div>}
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
        {[['rent', `🧾 ${t('paymentHistory')}`], ['kyc', `🪪 ${t('myKyc')}`], ['notices', `📢 ${t('noticeBoard')}`], ['complaints', `🛠️ ${t('myComplaints')}`]].map(([v, l]) => (
          <button key={v} className={seg === v ? 'active' : ''} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>

      {seg === 'rent' && (
        <div className="mt16">
          {dues.breakdown?.length > 0 && (
            <div className="card mb16" style={{ padding: 14 }}>
              <b className="small">📒 {t('rentStatement')}</b>
              {dues.breakdown.slice(-6).map((b, i) => (
                <div key={i} className="row spread mt8 small">
                  <span>{b.opening ? `📦 ${t('oldBalance')}` : `📅 ${b.label}`}</span>
                  <span className="muted">{rupee(b.charged)}</span>
                  <span className={`chip ${b.status === 'paid' ? 'green' : b.status === 'partial' ? 'orange' : 'red'}`}>
                    {b.status === 'paid' ? `✅ ${t('paid')}` : b.status === 'partial' ? `🟡 ${rupee(b.due)}` : `🔴 ${rupee(b.due)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
          {payments.length === 0 && <Empty icon="🧾" text={t('noPaymentsYet')} />}
          {payments.map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: p.type === 'advance' ? 'linear-gradient(135deg,#0984e3,#74b9ff)' : 'linear-gradient(135deg,#0ea97f,#2fd3a5)' }}>{p.type === 'advance' ? '🏦' : '₹'}</div>
              <div className="grow">
                <b>{rupee(p.amount)}{p.type === 'advance' ? ` · ${t('advance')}` : ''}</b>
                <div className="muted small">{p.date} · {String(p.mode).toUpperCase()} · {t('receipt')} {p.receiptNo}</div>
              </div>
              {p.balanceAfter > 0
                ? <span className="chip orange">⚠️ {rupee(p.balanceAfter)}</span>
                : <span className="chip green">✅ {t('paid')}</span>}
            </div>
          ))}
        </div>
      )}

      {seg === 'kyc' && (
        <PortalKyc token={token} tenant={tenant} onChanged={load} />
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

/* tenant self-service KYC: upload ID proof → owner verifies */
function PortalKyc({ token, tenant, onChanged }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ docType: 'aadhaar', idNumber: '', fullName: '', address: '', image: null });
  const [busy, setBusy] = useState(false);
  const status = tenant.kycStatus || 'pending';
  const docs = tenant.kycDocs || [];

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const image = await fileToDataUrl(file);
      setF(x => ({ ...x, image }));
    } catch (err) { toast(err.message, 'err'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!f.image) return toast(t('uploadDoc'), 'err');
    setBusy(true);
    try {
      await post(`/portal/${token}/kyc`, f);
      toast('✔');
      setF({ docType: 'aadhaar', idNumber: '', fullName: '', address: '', image: null });
      onChanged();
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="mt16">
      <div className="row wrap mb16">
        <span className={`chip ${status === 'verified' ? 'green' : status === 'submitted' ? 'blue' : status === 'rejected' ? 'red' : 'orange'}`}>
          🪪 {status === 'verified' ? t('kycVerified') : status === 'submitted' ? t('kycSubmitted') : status === 'rejected' ? t('kycRejected') : t('kycPending')}
        </span>
        <span className="chip">{docs.length}/3 📄</span>
      </div>

      {docs.map(d => (
        <div key={d.id} className="list-item">
          <div className="avatar" style={{ background: 'linear-gradient(135deg,#6c5ce7,#8e7bff)' }}>
            {DOC_TYPES.find(x => x[0] === d.docType)?.[1] || '📄'}
          </div>
          <div className="grow">
            <b>{t(`${d.docType}Doc`)}</b>
            <div className="muted small">{d.idNumber || '—'} · {new Date(d.createdAt).toLocaleDateString()}</div>
          </div>
          <span className="chip green">✅</span>
        </div>
      ))}

      {docs.length < 3 && status !== 'verified' && (
        <form onSubmit={submit} className="card mt8" style={{ padding: 14 }}>
          <p className="muted small mb16">💡 {t('kycUploadHint')}</p>
          <Field label={t('docType')}>
            <div className="row wrap">
              {DOC_TYPES.map(([v, ico]) => (
                <button type="button" key={v} className={`chip ${f.docType === v ? 'active' : ''}`} onClick={() => setF({ ...f, docType: v })}>{ico} {t(`${v}Doc`)}</button>
              ))}
            </div>
          </Field>
          <div className="row">
            <Field label={`🙍 ${t('yourName')}`}>
              <input className="input" value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} />
            </Field>
            <Field label={t('idNumber')}>
              <input className="input" value={f.idNumber} onChange={e => setF({ ...f, idNumber: e.target.value })} />
            </Field>
          </div>
          <Field label={`📍 ${t('address')}`}>
            <input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
          </Field>
          <label className="btn btn-block">
            📷 {f.image ? '✅ ' : ''}{t('uploadDoc')}
            <input type="file" accept="image/*" hidden onChange={pick} />
          </label>
          {f.image && <img src={f.image} alt="ID" style={{ width: '100%', borderRadius: 12, marginTop: 8 }} />}
          <button className="btn btn-primary btn-block mt8" disabled={busy || !f.image}>⬆️ {t('save')}</button>
        </form>
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
  const [f, setF] = useState({ amount: dueAmount || rent || '', note: '', screenshot: null });
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const screenshot = await fileToDataUrl(file, 900);
      setF(x => ({ ...x, screenshot }));
    } catch (err) { toast(err.message, 'err'); }
  };
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
        <label className="btn btn-block mb16">
          🖼️ {f.screenshot ? '✅ ' : ''}{t('uploadScreenshot')}
          <input type="file" accept="image/*" hidden onChange={pick} />
        </label>
        <button className="btn btn-green btn-block" disabled={busy}>📤 {t('save')}</button>
      </form>
    </Modal>
  );
}
