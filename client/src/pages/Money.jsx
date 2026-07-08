import React, { useCallback, useEffect, useState } from 'react';
import { get, post, del } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import TenantSheet from '../components/TenantSheet.jsx';
import { useToast } from '../App.jsx';

const EXPENSE_CATS = [
  ['electricity', '⚡'], ['water', '💧'], ['groceries', '🛒'],
  ['maintenance', '🔧'], ['wifi', '📶'], ['salary', '👛'], ['other', '📦']
];

function downloadCsv(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Money({ overview, refreshOverview, initialSeg }) {
  const { t } = useLang();
  const toast = useToast();
  const [seg, setSeg] = useState(initialSeg || 'dues'); // dues | payments | expenses | report
  const [propId, setPropId] = useState('');
  const [dues, setDues] = useState(null);
  const [payments, setPayments] = useState(null);
  const [expenses, setExpenses] = useState(null);
  const [report, setReport] = useState(null);
  const [modal, setModal] = useState(null);
  const [sheetTenant, setSheetTenant] = useState(null);

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

  const openTenant = (row) => {
    setSheetTenant({ ...row.tenant, dues: row.dues, propertyName: row.propertyName, roomName: row.roomName });
  };

  const collected = propId ? properties.find(p => p.id === propId)?.stats.collectedThisMonth : totals?.collectedThisMonth;
  const totalDue = dues?.reduce((a, d) => a + d.dues.dueAmount, 0) || 0;
  const rate = (collected || 0) + totalDue > 0 ? Math.round((collected || 0) / ((collected || 0) + totalDue) * 100) : 100;

  const thisMonthExp = (expenses || []).filter(e => (e.date || '').startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((a, e) => a + Number(e.amount), 0);

  const exportPayments = () => downloadCsv('staysathi-payments.csv', [
    ['Date', 'Tenant', 'Amount', 'Mode', 'Months', 'Receipt'],
    ...(payments || []).map(p => [p.date, p.tenantName, p.amount, p.mode, (p.months || []).join(' '), p.receiptNo])
  ]);
  const exportExpenses = () => downloadCsv('staysathi-expenses.csv', [
    ['Date', 'Category', 'Amount', 'Note'],
    ...(expenses || []).map(e => [e.date, e.category, e.amount, e.note])
  ]);

  return (
    <div className="page">
      <h2 className="title">💰 {t('navMoney')}</h2>

      <div className="filter-bar">
        <select className="input" value={propId} onChange={e => setPropId(e.target.value)}>
          <option value="">🏠 {t('allProperties')}</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </div>

      <div className="money-hero mt16">
        <div className="money-tile gain tap" onClick={() => setSeg('payments')}>
          <div className="muted small">✅ {t('collected')} · {t('thisMonth')}</div>
          <div className="amt">{rupee(collected)}</div>
        </div>
        <div className="money-tile loss tap" onClick={() => setSeg('dues')}>
          <div className="muted small">⚠️ {t('duesTitle')}</div>
          <div className="amt">{rupee(totalDue)}</div>
        </div>
      </div>

      <div className="seg mt16">
        {[['dues', `⚠️ ${t('duesTitle')}`], ['payments', `🧾 ${t('recentPayments')}`], ['expenses', `🛒 ${t('expenses')}`], ['report', `📊 ${t('reports')}`]].map(([v, l]) => (
          <button key={v} className={seg === v ? 'active' : ''} onClick={() => setSeg(v)}>{l}</button>
        ))}
      </div>

      {/* -------- dues: every row opens the tenant directly -------- */}
      {seg === 'dues' && (
        <div className="mt16">
          {dues && dues.length > 0 && <p className="muted small mb16">👆 {t('tapToCollect')}</p>}
          {dues && dues.length === 0 && <Empty icon="🎉" text={t('noDues')} />}
          {(dues || []).map(row => (
            <div key={row.tenant.id} className="list-item tap" onClick={() => openTenant(row)}>
              <div className="avatar">{row.tenant.name[0]}</div>
              <div className="grow">
                <b>{row.tenant.name}</b>
                <div className="muted small">{row.propertyName} · {t('room')} {row.roomName} · {row.dues.unpaidMonths.length} {t('months')}</div>
              </div>
              <div className="center">
                <div className="due-amt">{rupee(row.dues.dueAmount)}</div>
                <button className="btn btn-sm btn-green mt8" onClick={(e) => { e.stopPropagation(); openTenant(row); }}>💰 {t('collect')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------- payments -------- */}
      {seg === 'payments' && (
        <div className="mt16">
          <div className="row spread mb16">
            <span className="chip green">🧾 {(payments || []).length}</span>
            <button className="btn btn-sm" onClick={exportPayments}>⬇️ {t('exportCsv')}</button>
          </div>
          {payments && payments.length === 0 && <Empty icon="🧾" text="—" />}
          {(payments || []).map(p => (
            <div key={p.id} className="list-item">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#0ea97f,#2fd3a5)' }}>₹</div>
              <div className="grow">
                <b>{p.tenantName}</b>
                <div className="muted small">{p.date} · {p.mode.toUpperCase()} · {t('receipt')} {p.receiptNo}</div>
              </div>
              <div className="center">
                <b style={{ color: 'var(--green2)' }}>{rupee(p.amount)}</b>
                <button className="btn btn-sm btn-ghost" title={t('shareReceipt')} onClick={() => {
                  const text = `🧾 ${t('receipt')} ${p.receiptNo}\n${p.tenantName}\n${t('amount')}: ₹${p.amount}\n${t('date')}: ${p.date} · ${p.mode.toUpperCase()}\n— StaySathi`;
                  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                }}>📤</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* -------- expenses -------- */}
      {seg === 'expenses' && (
        <div className="mt16">
          <div className="row spread mb16">
            <span className="chip orange">🛒 {t('thisMonth')}: {rupee(thisMonthExp)}</span>
            <div className="row">
              <button className="btn btn-sm" onClick={exportExpenses}>⬇️ {t('exportCsv')}</button>
              <button className="btn btn-sm btn-primary" onClick={() => setModal('addExpense')}>➕ {t('addExpense')}</button>
            </div>
          </div>
          {expenses && expenses.length === 0 && <Empty icon="🛒" text="—" />}
          {(expenses || []).map(e => {
            const ico = EXPENSE_CATS.find(c => c[0] === e.category)?.[1] || '📦';
            return (
              <div key={e.id} className="list-item">
                <div className="avatar" style={{ background: 'linear-gradient(135deg,#f59f00,#ffc14d)' }}>{ico}</div>
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
        <>
          <div className="card mt16">
            <div className="row spread">
              <b>🎯 {t('collectionRate')} · {t('thisMonth')}</b>
              <b style={{ color: rate >= 80 ? 'var(--green2)' : rate >= 50 ? 'var(--gold)' : '#c53030' }}>{rate}%</b>
            </div>
            <div className="progress mt8"><div style={{ width: `${rate}%` }} /></div>
            <div className="row spread mt8 small muted">
              <span>✅ {rupee(collected)}</span>
              <span>⚠️ {rupee(totalDue)}</span>
            </div>
          </div>

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
                  <span className="muted">{t('netProfit')} · {t('thisMonth')}</span>
                  <b style={{ color: s.profit >= 0 ? 'var(--green2)' : '#c53030', fontSize: 20 }}>{rupee(s.profit)}</b>
                </div>
              ))}
            </div>
          </div>

          {Object.keys(report.expenseByCategory || {}).length > 0 && (
            <div className="card mt16">
              <b>🛒 {t('byCategory')}</b>
              <div className="row wrap mt16">
                {Object.entries(report.expenseByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
                  const ico = EXPENSE_CATS.find(c => c[0] === cat)?.[1] || '📦';
                  return <span key={cat} className="chip orange">{ico} {t(cat)}: {rupee(amt)}</span>;
                })}
              </div>
            </div>
          )}
        </>
      )}

      {modal === 'addExpense' && (
        <AddExpenseModal properties={properties} defaultProp={propId || properties[0]?.id}
          onDone={() => { setModal(null); load(); refreshOverview(); }} onClose={() => setModal(null)} />
      )}
      {sheetTenant && (
        <TenantSheet tenant={sheetTenant}
          onChanged={async () => { load(); refreshOverview(); }}
          onClose={() => setSheetTenant(null)} />
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
