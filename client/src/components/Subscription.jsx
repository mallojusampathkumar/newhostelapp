import React, { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, rupee } from './ui.jsx';
import { useToast } from '../App.jsx';

const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* Owner subscription sheet: plan status (trial / premium / expired), the
   ₹99-a-month offer, UPI payment instructions and the "I have paid" flow.
   Payments are verified by the super admin from Admin → Subscriptions. */
export default function SubscriptionSheet({ user, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [billing, setBilling] = useState(null);
  const [months, setMonths] = useState(1);
  const [txnRef, setTxnRef] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get('/billing').then(setBilling).catch(e => toast(e.message, 'err'));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const submitRequest = async () => {
    setBusy(true);
    try {
      await post('/billing/request', { months, txnRef });
      toast(t('subReqSent'));
      setTxnRef('');
      load();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const cancelRequest = async () => {
    try { await del('/billing/request'); load(); } catch (e) { toast(e.message, 'err'); }
  };

  if (!billing) {
    return (
      <Modal title={t('mySubscription')} icon="💳" onClose={onClose}>
        <p className="muted center">{t('loading')}</p>
      </Modal>
    );
  }

  const { access, price, upi, pendingRequest, history } = billing;
  const premium = billing.plan === 'premium' && !access.readonly;
  const expired = access.readonly;
  const amount = price * months;
  const upiLink = upi.id
    ? `upi://pay?pa=${encodeURIComponent(upi.id)}&pn=${encodeURIComponent(upi.name || 'StaySathi')}&am=${amount}&cu=INR&tn=${encodeURIComponent('StaySathi subscription')}`
    : null;

  const copyUpi = async () => {
    try { await navigator.clipboard.writeText(upi.id); toast(t('upiCopied')); }
    catch { window.prompt(t('copy'), upi.id); }
  };

  return (
    <Modal title={t('mySubscription')} icon="💳" onClose={onClose}>
      {/* current plan status */}
      <div className={`sub-hero ${expired ? 'expired' : premium ? 'premium' : 'trial'}`}>
        <div className="sub-hero-ico">{expired ? '🔒' : premium ? '⭐' : '🕊️'}</div>
        <b className="big">{expired ? t('subExpiredTitle') : premium ? t('subPremiumTitle') : t('subTrialTitle')}</b>
        {premium && (
          <div className="small mt8">{t('subActiveTill')} <b>{fmtDate(billing.planExpiresAt)}</b>
            {access.daysLeft != null && <span className="chip small" style={{ marginLeft: 8 }}>⏳ {access.daysLeft} {t('subDaysLeft')}</span>}
          </div>
        )}
        {!premium && !expired && (
          <div className="small mt8">
            <b style={{ fontSize: 22 }}>{Math.max(0, access.daysLeft ?? 0)}</b> {t('subDaysLeft')} · {t('subEndsOn')} {fmtDate(billing.trialEndsAt)}
          </div>
        )}
        <p className="small mt8" style={{ opacity: .85 }}>{expired ? t('subExpiredMsg') : premium ? '' : t('subTrialMsg')}</p>
      </div>

      {/* the offer */}
      <div className="card mt16">
        <div className="row spread">
          <b>⭐ {t('premiumPlan')}</b>
          <span className="sub-price">{rupee(price)}<small> {t('subPerMonth')}</small></span>
        </div>
        <ul className="sub-benefits mt8">
          <li>✅ {t('subBenefit1')}</li>
          <li>✅ {t('subBenefit2')}</li>
          <li>✅ {t('subBenefit3')}</li>
          <li>✅ {t('subBenefit4')}</li>
        </ul>
      </div>

      {/* pending verification / pay & activate */}
      {pendingRequest ? (
        <div className="card mt16" style={{ borderColor: 'var(--orange-brd)' }}>
          <b>⏳ {t('subReqPending')}</b>
          <p className="muted small mt8">{t('subReqPendingMsg')}</p>
          <p className="small mt8">
            {rupee(pendingRequest.amount)} · {pendingRequest.months > 1 ? `${pendingRequest.months} ${t('months')}` : t('months1')}
            {pendingRequest.txnRef ? ` · Ref: ${pendingRequest.txnRef}` : ''} · {fmtDate(pendingRequest.createdAt)}
          </p>
          <button className="btn btn-sm btn-ghost mt8" onClick={cancelRequest}>✖ {t('cancelRequest')}</button>
        </div>
      ) : (
        <div className="card mt16">
          <b>{premium ? `🔄 ${t('renewNow')}` : `🚀 ${t('upgradeNow')}`}</b>
          <div className="row mt8">
            {[[1, t('months1')], [3, t('months3')]].map(([m, label]) => (
              <button key={m} type="button" className={`chip ${months === m ? 'active' : ''}`} onClick={() => setMonths(m)}>{label}</button>
            ))}
            <span className="grow" />
            <b style={{ color: 'var(--green2)' }}>{t('payAmount')}: {rupee(amount)}</b>
          </div>

          {upi.id ? (
            <div className="upi-box mt16">
              <div className="small muted">📲 {t('payWithUpi')}</div>
              <div className="row spread mt8">
                <code className="upi-id">{upi.id}</code>
                <button type="button" className="btn btn-sm" onClick={copyUpi}>📋 {t('copy')}</button>
              </div>
              <a className="btn btn-sm btn-primary btn-block mt8" href={upiLink}>📲 {t('openUpiApp')} · {rupee(amount)}</a>
            </div>
          ) : (
            <p className="muted small mt16">ℹ️ {t('noUpiConfigured')}</p>
          )}

          <Field label={`🧾 ${t('txnRefLabel')}`}>
            <input className="input" value={txnRef} maxLength={80}
              placeholder="123456789012" onChange={e => setTxnRef(e.target.value)} />
          </Field>
          <button className="btn btn-green btn-block" disabled={busy} onClick={submitRequest}>
            ✅ {t('iHavePaidActivate')}
          </button>
        </div>
      )}

      {/* past activations */}
      {history.length > 0 && (
        <div className="card mt16">
          <b>🧾 {t('subHistory')}</b>
          {history.map(h => (
            <div key={h.id} className="row spread mt8 small">
              <span className="muted">{fmtDate(h.createdAt)} · {h.months > 1 ? `${h.months} ${t('months')}` : t('months1')}</span>
              <b>{rupee(h.amount)}</b>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
