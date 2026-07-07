import React, { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

const EXPENSE_CATS = [
  ['electricity', '⚡'], ['water', '💧'], ['groceries', '🛒'],
  ['maintenance', '🔧'], ['wifi', '📶'], ['salary', '👛'], ['other', '📦']
];

export default function Money({ overview, refreshOverview }) {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState('dues'); // dues | payments | expenses | report
  const [propId, setPropId] = useState('');
  const [dues, setDues] = useState(null);
  const [payments, setPayments] = useState(null);
  const [expenses, setExpenses] = useState(null);
  const [report, setReport] = useState(null);
  const [modal, setModal] = useState(null);

  const q = propId ? `?propertyId=${propId}` : '';
  const load = useCallback(() => {
    get(`/dues${q}`).then(d => setDues(d.dues)).catch(() => {});
    get(`/payments${q}`).then(d => setPayments(d.payments)).catch(() => {});
    get(`/expenses${q}`).then(d => setExpenses(d.expenses)).catch(() => {});
    get(`/reports${q}`).then(setReport).catch(() => {});
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const totals = overview?.totals;
  const properties = overview?.properties || [];

  const remind = async (row) => {
    try {
      const { text, phone } = await get(`/tenants/${row.tenant.id}/reminder`);
      window.open(`https://wa.me/91${String(phone).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`, '_blank');
    } catch (e) { toast(e.message, 'err'); }
  };

  const thisMonthExp = (expenses || []).filter(e => (e.date || '').startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((a, e) => a + Number(e.amount), 0);

  return (
    <div className="page">
      <h2 className="title">💰 {t('navMoney')}</h2>

      <select className="input mt8" value={propId} onChange={e => setPropId(e.target.value)}>
        <option value="">🏠 {t('allProperties')}</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
      </select>

      <div className="money-hero mt16">
        <div className="money-tile gain">
          <div className="muted small">✅ {t('collected')} · {t('thisMonth')}</div>
          <div className="amt">{rupee(propId ? properties.find(p => p.id === propId)?.stats.collectedThisMonth : totals?.collectedThisMonth)}</div>
        </div>
        <div className="money-tile loss">
          <div className="muted small">⚠️ {t('duesTitle')}</div>
          <div className="amt">{rupee(dues?.reduce((a, d) => a + d.dues.dueAmount, 0) || 0)}</div>
        </div>
      </div>

      <div className="seg mt16">
        {[['dues', `⚠️ ${t('duesTitle')}`], ['payments', `🧾 ${t('recentPayments')}`], ['expenses', `🛒 ${t('expenses')}`], ['report', `📊 ${t('reports')}`]].map(([v, l]) => (
          <button key={v} className={seg === v ? 'active' : ''} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>

      {/* -------- dues -------- */}
      {seg === 'dues' && (
        <div className="mt16">
          {dues && dues.length === 0 && <Empty icon="🎉" text={t('noDues')} />}
          {(dues || []).map(row => (
            <div key={row.tenant.id} className="list-item">
              <div className="avatar">{row.tenant.name[0]}</div>
              <div className="grow">
                <b>{row.tenant.name}</b>
                <div className="muted small">{row.propertyName} · {t('room')} {row.roomName} · {row.dues.unpaidMonths.length} {t('months')}</div>
              </div>
              <div className="center">
                <div style={{ color: '#ffb3af', fontWeight: 800 }}>{rupee(row.dues.dueAmount)}</div>
                <button className="btn btn-sm btn-green mt8" onClick={() => remind(row)}>📲 {t('remind')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------- payments -------- */}
      {seg === 'payments' && (
        <div className="mt16">
          {payments && payments.length === 0 && <Empty icon="🧾" text="—" />}
          {(payments || []).map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#00b894,#00cec9)' }}>₹</div>
              <div className="grow">
                <b>{p.tenantName}</b>
                <div className="muted small">{p.date} · {p.mode.toUpperCase()} · {t('receipt')} {p.receiptNo}</div>
              </div>
              <b style={{ color: 'var(--green2)' }}>{rupee(p.amount)}</b>
            </div>
          ))}
        </div>
      )}

      {/* -------- expenses -------- */}
      {seg === 'expenses' && (
        <div className="mt16">
          <div className="row spread mb16">
            <span className="chip orange">🛒 {t('thisMonth')}: {rupee(thisMonthExp)}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setModal('addExpense')}>➕ {t('addExpense')}</button>
          </div>
          {(expenses || []).map(e => {
            const ico = EXPENSE_CATS.find(c => c[0] === e.category)?.[1] || '📦';
            return (
              <div key={e.id} className="list-item">
                <div className="avatar" style={{ background: 'linear-gradient(135deg,#f39c12,#fdaa3d)' }}>{ico}</div>
                <div className="grow">
                  <b>{t(e.category)}</b>
                  <div className="muted small">{e.date}{e.note ? ` · ${e.note}` : ''}</div>
                </div>
                <div className="row">
                  <b>{rupee(e.amount)}</b>
                  <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/expenses/${e.id}`); load(); refreshOverview(); } }}>🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* -------- report -------- */}
      {seg === 'report' && report && (
        <div className="card mt16">
          <b>📊 {t('incomeVsExpense')}</b>
          <BarChart series={report.series} />
          <div className="row wrap mt8">
            <span className="chip green">■ {t('income')}</span>
            <span className="chip red">■ {t('expenses')}</span>
          </div>
          <div className="mt16">
            {report.series.slice(-1).map(s => (
              <div key={s.month} className="row spread">
                <span className="muted">{t('profit')} · {t('thisMonth')}</span>
                <b style={{ color: s.profit >= 0 ? 'var(--green2)' : '#ffb3af', fontSize: 20 }}>{rupee(s.profit)}</b>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal === 'addExpense' && (
        <AddExpenseModal properties={properties} defaultProp={propId || properties[0]?.id}
          onDone={() => { setModal(null); load(); refreshOverview(); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function BarChart({ series }) {
  const max = Math.max(1, ...series.flatMap(s => [s.income, s.expense]));
  return (
    <div className="bar-chart">
      {series.map(s => (
        <div key={s.month} className="bar-group">
          <div className="bar-pair">
            <div className="bar inc" style={{ height: `${(s.income / max) * 100}%` }} title={`₹${s.income}`} />
            <div className="bar exp" style={{ height: `${(s.expense / max) * 100}%` }} title={`₹${s.expense}`} />
          </div>
          <span className="bar-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function AddExpenseModal({ properties, defaultProp, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ propertyId: defaultProp || '', category: 'electricity', amount: '', note: '', date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/expenses', f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('addExpense')} icon="🛒" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('properties')}`}>
          <select className="input" required value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
            <option value="" disabled>—</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </Field>
        <Field label={t('category')}>
          <div className="row wrap">
            {EXPENSE_CATS.map(([v, ico]) => (
              <button type="button" key={v} className={`chip ${f.category === v ? 'active' : ''}`} onClick={() => setF({ ...f, category: v })}>{ico} {t(v)}</button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label={`💰 ${t('amount')}`}>
            <input className="input" type="number" min="1" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} />
          </Field>
          <Field label={`📅 ${t('date')}`}>
            <input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
          </Field>
        </div>
        <Field label={`📝 ${t('note')}`}>
          <input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}
