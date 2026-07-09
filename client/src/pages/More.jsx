import React, { useCallback, useEffect, useState } from 'react';
import { get, post, put, del } from '../api.js';
import { useLang, LANGS } from '../i18n.jsx';
import { Modal, Field, Empty, rupee } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

export default function More({ overview, user, setUser, onLogout }) {
  const { t, lang, setLang } = useLang();
  const toast = useToast();
  const [screen, setScreen] = useState('menu'); // menu | meters | tutorials
  const [meters, setMeters] = useState(null);
  const [modal, setModal] = useState(null);
  const [propId, setPropId] = useState('');
  const properties = overview?.properties || [];

  const loadMeters = useCallback(() => {
    get(`/meters${propId ? `?propertyId=${propId}` : ''}`).then(d => setMeters(d.meters)).catch(() => {});
  }, [propId]);
  useEffect(() => { if (screen === 'meters') loadMeters(); }, [screen, loadMeters]);

  const changeLang = async (code) => {
    setLang(code);
    try { const { user: u } = await put('/me', { language: code }); setUser(u); } catch { /* offline ok */ }
  };

  if (screen === 'tutorials') return <Tutorials onBack={() => setScreen('menu')} />;

  if (screen === 'meters') {
    return (
      <div className="page">
        <div className="crumbs"><button className="crumb link" onClick={() => setScreen('menu')}>← {t('back')}</button></div>
        <h2 className="title">⚡ {t('meters')}</h2>
        <div className="filter-bar">
          <select className="input" value={propId} onChange={e => setPropId(e.target.value)}>
            <option value="">🏠 {t('allProperties')}</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
          <button className="btn btn-sm btn-primary" onClick={() => setModal('addReading')}>➕ {t('addReading')}</button>
        </div>
        <div className="mt16">
          {meters && meters.length === 0 && <Empty icon="⚡" text={t('noMeters')} />}
          {(meters || []).map(m => (
            <div key={m.id} className="list-item">
              <div className="avatar" style={{ background: 'linear-gradient(135deg,#f39c12,#ffeaa7)', color: '#5c3c00' }}>⚡</div>
              <div className="grow">
                <b>{m.label}</b>
                <div className="muted small">{m.propertyName} · {m.date} · {m.prevReading} → {m.reading} ({m.units} {t('units')})</div>
              </div>
              <div className="row">
                <b>{rupee(m.bill)}</b>
                <button className="btn btn-sm btn-ghost" onClick={async () => { if (window.confirm(t('deleteQ'))) { await del(`/meters/${m.id}`); loadMeters(); } }}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
        {modal === 'addReading' && (
          <AddReadingModal properties={properties} onDone={() => { setModal(null); loadMeters(); }} onClose={() => setModal(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <h2 className="title">☰ {t('navMore')}</h2>

      <div className="card mt16">
        <div className="row">
          <div className="avatar" style={{ width: 58, height: 58, fontSize: 26 }}>{user.name[0]}</div>
          <div className="grow">
            <b className="big">{user.name}</b>
            <div className="muted small">📱 {user.phone} · {t(user.businessType)}</div>
          </div>
          <span className="chip active">⭐ {user.plan === 'premium' ? t('premiumPlan') : t('freePlan')}</span>
        </div>
        <button className="btn btn-sm btn-block mt16" onClick={() => setModal('editProfile')}>✏️ {t('editProfile')}</button>
      </div>

      <div className="mt16">
        <button className="list-item btn-block" style={{ width: '100%' }} onClick={() => setScreen('tutorials')}>
          <div className="avatar" style={{ background: 'linear-gradient(135deg,#e84393,#fd79a8)' }}>🎬</div>
          <b className="grow" style={{ textAlign: 'left' }}>{t('tutorials')}</b><span>›</span>
        </button>
        <button className="list-item btn-block" style={{ width: '100%' }} onClick={() => setScreen('meters')}>
          <div className="avatar" style={{ background: 'linear-gradient(135deg,#f39c12,#fdaa3d)' }}>⚡</div>
          <b className="grow" style={{ textAlign: 'left' }}>{t('meters')}</b><span>›</span>
        </button>
      </div>

      <div className="card mt16">
        <b>🗣️ {t('chooseLanguage')}</b>
        <div className="lang-grid mt16">
          {LANGS.map(l => (
            <button key={l.code} className={`lang-tile ${lang === l.code ? 'active' : ''}`} onClick={() => changeLang(l.code)}>
              <span className="flag">{l.flag}</span>{l.native}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-danger btn-block mt24" onClick={onLogout}>🚪 {t('logout')}</button>
      <p className="muted small center mt16">{t('madeWith')}</p>

      {modal === 'editProfile' && (
        <EditProfileModal user={user} setUser={setUser} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function EditProfileModal({ user, setUser, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ name: user.name, email: user.email || '', businessType: user.businessType || 'hostel' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const { user: u } = await put('/me', f);
      setUser(u);
      toast(t('profileSaved'));
      onClose();
    } catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('editProfile')} icon="✏️" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🙍 ${t('yourName')}`}>
          <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label={`✉️ ${t('email')}`}>
          <input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label={`🏠 ${t('businessType')}`}>
          <div className="type-grid">
            {[['hostel', '🏨'], ['pg', '🏡'], ['flat', '🏢'], ['apartment', '🏬']].map(([v, ico]) => (
              <button type="button" key={v} className={`type-tile ${f.businessType === v ? 'active' : ''}`}
                onClick={() => setF({ ...f, businessType: v })}>
                <span className="ico">{ico}</span>{t(v)}
              </button>
            ))}
          </div>
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

/* ============ guided tutorials with animated scenes ============ */
function Tutorials({ onBack }) {
  const { t } = useLang();
  const [active, setActive] = useState(null);

  const tuts = [
    { icon: '🏠', title: t('tut1t'), desc: t('tut1d'), scene: 'addProperty' },
    { icon: '🚪', title: t('tut2t'), desc: t('tut2d'), scene: 'addRoom' },
    { icon: '🧑', title: t('tut3t'), desc: t('tut3d'), scene: 'addTenant' },
    { icon: '💰', title: t('tut4t'), desc: t('tut4d'), scene: 'collect' },
    { icon: '📲', title: t('tut5t'), desc: t('tut5d'), scene: 'remind' },
    { icon: '🔒', title: t('tut6t'), desc: t('tut6d'), scene: 'pin' }
  ];

  return (
    <div className="page">
      <div className="crumbs"><button className="crumb link" onClick={onBack}>← {t('back')}</button></div>
      <h2 className="title">🎬 {t('tutorials')}</h2>
      <p className="muted mt8">{t('howTitle')}</p>
      <div className="mt16">
        {tuts.map((tu, i) => (
          <div key={i} className="card tut-card mt16" style={{ marginTop: i ? 14 : 16 }}>
            <div className="tut-num">{tu.icon}</div>
            <div className="grow">
              <b>{t('stepOf')} {i + 1}: {tu.title}</b>
              <div className="muted small mt8">{tu.desc}</div>
            </div>
            <button className="tut-play" onClick={() => setActive(tu)}>▶️</button>
          </div>
        ))}
      </div>
      {active && <TutViewer tut={active} onClose={() => setActive(null)} />}
    </div>
  );
}

/* small animated "video" scenes built from the app's own bubbles */
function TutViewer({ tut, onClose }) {
  const { t } = useLang();
  return (
    <Modal title={tut.title} icon={tut.icon} onClose={onClose}>
      <div className="tut-viewer">
        <div className="tut-scene">
          <span className="tut-hand">👆</span>
          {tut.scene === 'addProperty' && (
            <div className="bubble add-bubble" style={{ '--size': '140px' }}>
              <span className="ico">➕</span><span className="name">{t('addProperty')}</span>
            </div>
          )}
          {tut.scene === 'addRoom' && (
            <div className="row">
              <div className="bubble" style={{ '--size': '110px', animation: 'floaty 4s ease-in-out infinite' }}>
                <span className="ico">🪜</span><span className="name">{t('floor')} 1</span>
              </div>
              <div className="bubble add-bubble" style={{ '--size': '110px' }}>
                <span className="ico">➕</span><span className="name">{t('addRoom')}</span>
              </div>
            </div>
          )}
          {tut.scene === 'addTenant' && (
            <div className="bubble green" style={{ '--size': '140px' }}>
              <span className="ico">🛏️</span><span className="name">{t('vacantBed')}</span><span className="sub">✨ {t('addTenant')}</span>
            </div>
          )}
          {tut.scene === 'collect' && (
            <div className="bubble red" style={{ '--size': '140px' }}>
              <span className="ico">🧑</span><span className="name">Ravi</span><span className="sub">⚠️ ₹6,500</span>
            </div>
          )}
          {tut.scene === 'remind' && (
            <div className="bubble green" style={{ '--size': '140px' }}>
              <span className="ico">📲</span><span className="name">WhatsApp</span><span className="sub">🔔 {t('remind')}</span>
            </div>
          )}
          {tut.scene === 'pin' && (
            <div className="bubble" style={{ '--size': '140px' }}>
              <span className="lock">🔒</span>
              <span className="ico">🏨</span><span className="name">{t('hostel')}</span><span className="sub">🔒 PIN</span>
            </div>
          )}
        </div>
        <p className="muted">{tut.desc}</p>
        <button className="btn btn-primary btn-block mt16" onClick={onClose}>👍 {t('done')}</button>
      </div>
    </Modal>
  );
}

function AddReadingModal({ properties, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ propertyId: properties[0]?.id || '', label: 'Main Meter', reading: '', prevReading: '', ratePerUnit: 8 });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post('/meters', f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  const units = Math.max(0, (Number(f.reading) || 0) - (Number(f.prevReading) || 0));
  return (
    <Modal title={t('addReading')} icon="⚡" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('properties')}`}>
          <select className="input" required value={f.propertyId} onChange={e => setF({ ...f, propertyId: e.target.value })}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
          </select>
        </Field>
        <Field label={`⚡ ${t('meterLabel')}`}>
          <input className="input" required value={f.label} onChange={e => setF({ ...f, label: e.target.value })} />
        </Field>
        <div className="row">
          <Field label={t('prevReading')}>
            <input className="input" type="number" min="0" value={f.prevReading} onChange={e => setF({ ...f, prevReading: e.target.value })} />
          </Field>
          <Field label={t('reading')}>
            <input className="input" type="number" min="0" required value={f.reading} onChange={e => setF({ ...f, reading: e.target.value })} />
          </Field>
        </div>
        <Field label={t('ratePerUnit')}>
          <input className="input" type="number" min="0" step="0.5" value={f.ratePerUnit} onChange={e => setF({ ...f, ratePerUnit: e.target.value })} />
        </Field>
        <p className="chip orange">💡 {units} {t('units')} × ₹{f.ratePerUnit || 0} = {rupee(units * (Number(f.ratePerUnit) || 0))}</p>
        <button className="btn btn-primary btn-block mt16" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}
