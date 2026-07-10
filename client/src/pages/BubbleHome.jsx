import React, { useCallback, useState } from 'react';
import { get, post, put } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field, rupee } from '../components/ui.jsx';
import { RupeeCount, CountUp, ProgressRing } from '../fx.jsx';
import TenantSheet from '../components/TenantSheet.jsx';
import SetupWizard from '../components/SetupWizard.jsx';
import SmartImport from '../components/SmartImport.jsx';
import { useToast } from '../App.jsx';

/* The bubble navigator:
   owner bubble → property bubbles → (PIN) → floor bubbles → room bubbles → bed bubbles → tenant sheet */

const PROP_ICONS = ['🏨', '🏡', '🏢', '🏬', '🏘️', '🛖'];
const PROP_COLORS = ['#6C5CE7', '#00B894', '#E17055', '#0984E3', '#E84393', '#F39C12'];

/* Sathi's daily digest — greeting, live collection ring and a smart tip,
   all computed from the overview the shell already fetched. */
function InsightsCard({ totals, properties, go, user }) {
  const { t } = useLang();
  const hour = new Date().getHours();
  const greet = hour < 12 ? ['🌅', t('goodMorning')] : hour < 17 ? ['☀️', t('goodAfternoon')] : ['🌙', t('goodEvening')];
  const expected = totals.collectedThisMonth + totals.dueAmount;
  const rate = expected > 0 ? Math.round(totals.collectedThisMonth / expected * 100) : 100;
  const occ = totals.beds > 0 ? Math.round(totals.occupied / totals.beds * 100) : 0;
  const worst = [...properties].sort((a, b) => b.stats.dueAmount - a.stats.dueAmount)[0];

  const tip = totals.dueTenants > 0 && worst?.stats.dueAmount > 0
    ? `${worst.icon} ${worst.name}: ${rupee(worst.stats.dueAmount)} ${t('tipDueIn')} · ${t('tipRemind')}`
    : totals.beds - totals.occupied > 0
      ? `🛏️ ${totals.beds - totals.occupied} ${t('tipVacantBeds')}`
      : `🎉 ${t('tipAllGood')}`;

  return (
    <div className="card insights mt16">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="insights-greet">{greet[0]} {greet[1]}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!</div>
          <div className="muted small mt8">📈 {t('collectionRate')} · {t('thisMonth')}</div>
          <div className="insights-amt"><RupeeCount value={totals.collectedThisMonth} /> <span className="muted small">/ {rupee(expected)}</span></div>
          <div className="muted small mt8">🛏️ {t('occupancy')}: <b><CountUp value={occ} />%</b> · 👥 <CountUp value={totals.tenants} /> {t('tenants')}</div>
        </div>
        <ProgressRing pct={rate} color={rate >= 80 ? 'var(--green)' : rate >= 50 ? 'var(--orange)' : 'var(--red)'}>
          <b style={{ fontSize: 20 }}><CountUp value={rate} />%</b>
        </ProgressRing>
      </div>
      <button className="sathi-tip mt16" onClick={() => totals.dueTenants > 0 ? go && go('money', 'dues') : (go && go('people'))}>
        <span className="tip-orb">🤖</span>
        <span className="grow" style={{ textAlign: 'left' }}>{tip}</span>
        <span>›</span>
      </button>
    </div>
  );
}

/* shimmering placeholders while the overview loads */
function HomeSkeleton() {
  return (
    <div className="bubble-field" aria-hidden="true">
      <div className="skeleton skel-bubble" style={{ '--size': '210px' }} />
      <div className="stat-strip">
        {[0, 1, 2, 3].map(i => <div key={i} className="skeleton skel-tile" />)}
      </div>
    </div>
  );
}

export default function BubbleHome({ overview, refreshOverview, go, user }) {
  const { t } = useLang();
  const toast = useToast();

  const [level, setLevel] = useState('root'); // root | props | floors | rooms | beds
  const [tree, setTree] = useState(null);     // {property, floors[]}
  const [floorId, setFloorId] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [unlocked, setUnlocked] = useState(() => new Set());
  const [pinFor, setPinFor] = useState(null); // property pending pin
  const [modal, setModal] = useState(null);   // {kind, ...}

  const properties = overview?.properties || [];
  const totals = overview?.totals;

  const loadTree = useCallback(async (propId) => {
    const data = await get(`/properties/${propId}/tree`);
    setTree(data);
    return data;
  }, []);

  const refreshAll = useCallback(async () => {
    refreshOverview();
    if (tree) await loadTree(tree.property.id).catch(() => {});
  }, [refreshOverview, tree, loadTree]);

  const openProperty = async (p) => {
    if (p.hasPin && !unlocked.has(p.id)) { setPinFor(p); return; }
    try {
      await loadTree(p.id);
      setLevel('floors');
    } catch (e) { toast(e.message, 'err'); }
  };

  const onPinOk = async () => {
    const p = pinFor;
    setUnlocked(s => new Set([...s, p.id]));
    setPinFor(null);
    try {
      await loadTree(p.id);
      setLevel('floors');
    } catch (e) { toast(e.message, 'err'); }
  };

  const floor = tree?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  /* ---------- crumbs ---------- */
  const crumbs = [];
  crumbs.push({ label: `🫧 ${t('myProperties')}`, go: () => { setLevel(level === 'root' ? 'root' : 'props'); setTree(null); setFloorId(null); setRoomId(null); } });
  if (tree && level !== 'root' && level !== 'props') {
    crumbs.push({ label: `${tree.property.icon} ${tree.property.name}`, go: () => { setLevel('floors'); setFloorId(null); setRoomId(null); } });
  }
  if (floor && (level === 'rooms' || level === 'beds')) {
    crumbs.push({ label: `🪜 ${floor.name}`, go: () => { setLevel('rooms'); setRoomId(null); } });
  }
  if (room && level === 'beds') {
    crumbs.push({ label: `🚪 ${t('room')} ${room.name}` });
  }

  const goBack = () => {
    if (level === 'beds') { setLevel('rooms'); setRoomId(null); }
    else if (level === 'rooms') { setLevel('floors'); setFloorId(null); }
    else if (level === 'floors') { setLevel('props'); setTree(null); }
    else if (level === 'props') setLevel('root');
  };

  return (
    <div className="page">
      <div className="bubble-stage">
        {level !== 'root' && (
          <div className="crumbs">
            <button className="crumb link" onClick={goBack}>← {t('back')}</button>
            {crumbs.map((c, i) => (
              <span key={i} className={`crumb ${c.go ? 'link' : ''}`} onClick={c.go}>{c.label}</span>
            ))}
            {level === 'floors' && tree && (
              <button className="crumb link" onClick={() => setModal({ kind: 'propSettings' })}>⚙️</button>
            )}
          </div>
        )}

        {/* ---------- ROOT: the owner bubble ---------- */}
        {level === 'root' && !overview && <HomeSkeleton />}
        {level === 'root' && overview && (
          <>
            <div className="bubble-field">
              <div className="bubble hero-bubble" onClick={() => setLevel('props')}>
                <span className="ring" />
                <span className="ico">🙍</span>
                <span className="name">{t('hello')}!</span>
                <span className="sub">{t('tapYourBubble')} 👆</span>
              </div>
            </div>
            {totals && totals.properties === 0 && (
              <div className="row wrap mt16" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => setModal({ kind: 'wizard' })}>🪄 {t('setupWizard')}</button>
              </div>
            )}
            {totals && (
              <div className="stat-strip">
                <div className="stat-tile tap" onClick={() => setLevel('props')}><div className="v">🏠 <CountUp value={totals.properties} /></div><div className="k">{t('properties')}</div></div>
                <div className="stat-tile tap" onClick={() => go && go('people')}><div className="v">🛏️ <CountUp value={totals.occupied} />/{totals.beds}</div><div className="k">{t('occupancy')}</div></div>
                <div className="stat-tile tap" onClick={() => go && go('money', 'payments')}><div className="v" style={{ color: 'var(--green2)' }}><RupeeCount value={totals.collectedThisMonth} /></div><div className="k">{t('collected')}</div></div>
                <div className="stat-tile tap" onClick={() => go && go('money', 'dues')}><div className="v" style={{ color: totals.dueAmount ? 'var(--red-strong)' : 'var(--green2)' }}><RupeeCount value={totals.dueAmount} /></div><div className="k">{t('rentDue')}</div></div>
              </div>
            )}
            {totals && totals.properties > 0 && (
              <InsightsCard totals={totals} properties={properties} go={go} user={user} />
            )}
          </>
        )}

        {/* ---------- PROPERTIES ---------- */}
        {level === 'props' && (
          <div className="bubble-field">
            {properties.map((p, i) => {
              const occ = p.stats.totalBeds ? Math.round(p.stats.occupied / p.stats.totalBeds * 100) : 0;
              return (
                <div key={p.id} className="bubble" style={{ '--hue1': p.color, '--hue2': p.color + 'cc' }} onClick={() => openProperty(p)}>
                  {p.hasPin && <span className="lock">🔒</span>}
                  <span className="ico">{p.icon}</span>
                  <span className="name">{p.name}</span>
                  <span className="sub">🛏️ {p.stats.occupied}/{p.stats.totalBeds} · {occ}%</span>
                  {p.stats.dueAmount > 0 && <span className="sub" style={{ color: '#ffe0de' }}>⚠️ {rupee(p.stats.dueAmount)}</span>}
                </div>
              );
            })}
            <div className="bubble add-bubble" onClick={() => setModal({ kind: 'wizard' })}>
              <span className="ico">🪄</span>
              <span className="name">{t('setupWizard')}</span>
            </div>
            <div className="bubble add-bubble" onClick={() => setModal({ kind: 'addProperty' })}>
              <span className="ico">➕</span>
              <span className="name">{t('addProperty')}</span>
            </div>
            {properties.length > 0 && (
              <div className="bubble add-bubble" onClick={() => setModal({ kind: 'import' })}>
                <span className="ico">📥</span>
                <span className="name">{t('smartImport')}</span>
              </div>
            )}
          </div>
        )}

        {/* ---------- FLOORS ---------- */}
        {level === 'floors' && tree && (
          <div className="bubble-field">
            {tree.floors.map(f => (
              <div key={f.id} className={`bubble ${f.occupied === f.totalBeds && f.totalBeds > 0 ? 'blue' : ''}`}
                onClick={() => { setFloorId(f.id); setLevel('rooms'); }}>
                <span className="ico">🪜</span>
                <span className="name">{f.name}</span>
                <span className="sub">🚪 {f.rooms.length} {t('rooms')} · 🛏️ {f.occupied}/{f.totalBeds}</span>
              </div>
            ))}
            <div className="bubble add-bubble" onClick={() => setModal({ kind: 'addFloor' })}>
              <span className="ico">➕</span>
              <span className="name">{t('addFloor')}</span>
            </div>
          </div>
        )}

        {/* ---------- ROOMS ---------- */}
        {level === 'rooms' && floor && (
          <>
            {floor.rooms.length === 0 && <p className="muted center mt24">{t('emptyFloor')}</p>}
            <div className="bubble-field">
              {floor.rooms.map(r => {
                const cls = r.hasDue ? 'red' : (r.occupied < r.capacity ? 'green' : 'blue');
                const status = r.hasDue ? `⚠️ ${t('rentDue')}` : (r.occupied === 0 ? t('vacant') : r.occupied < r.capacity ? t('partial') : t('full'));
                return (
                  <div key={r.id} className={`bubble ${cls}`} onClick={() => { setRoomId(r.id); setLevel('beds'); }}>
                    <span className="ico">🚪</span>
                    <span className="name">{t('room')} {r.name}</span>
                    <span className="sub">🛏️ {r.occupied}/{r.capacity} · {status}</span>
                  </div>
                );
              })}
              <div className="bubble add-bubble" onClick={() => setModal({ kind: 'addRoom' })}>
                <span className="ico">➕</span>
                <span className="name">{t('addRoom')}</span>
              </div>
            </div>
          </>
        )}

        {/* ---------- BEDS ---------- */}
        {level === 'beds' && room && (
          <div className="bubble-field">
            {room.beds.map(b => {
              if (!b.tenant) {
                return (
                  <div key={b.id} className="bubble green" onClick={() => setModal({ kind: 'addTenant', bed: b })}>
                    <span className="ico">🛏️</span>
                    <span className="name">{b.name}</span>
                    <span className="sub">✨ {t('vacantBed')} — {t('addTenant')}</span>
                  </div>
                );
              }
              const due = b.tenant.dues?.dueAmount || 0;
              return (
                <div key={b.id} className={`bubble ${due > 0 ? 'red' : ''}`} onClick={() => setModal({ kind: 'tenant', bed: b })}>
                  <span className="ico">🧑</span>
                  <span className="name">{b.tenant.name}</span>
                  <span className="sub">{b.name} · {rupee(b.tenant.rent)}/mo</span>
                  <span className="sub">{due > 0 ? `⚠️ ${t('pending')} ${rupee(due)}` : `✅ ${t('paid')}`}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------- modals ---------- */}
      {pinFor && <PinModal prop={pinFor} onOk={onPinOk} onClose={() => setPinFor(null)} />}
      {modal?.kind === 'wizard' && (
        <SetupWizard onDone={async () => { setModal(null); refreshOverview(); setLevel('props'); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'import' && (
        <SmartImport properties={properties} defaultProp={tree?.property?.id}
          onDone={async () => { setModal(null); await refreshAll(); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'addProperty' && <AddPropertyModal onDone={async () => { setModal(null); refreshOverview(); }} onClose={() => setModal(null)} />}
      {modal?.kind === 'addFloor' && tree && (
        <AddFloorModal propId={tree.property.id} count={tree.floors.length} onDone={async () => { setModal(null); await refreshAll(); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'addRoom' && floor && (
        <AddRoomModal floor={floor} onDone={async () => { setModal(null); await refreshAll(); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'addTenant' && (
        <AddTenantModal bed={modal.bed} room={room} onDone={async () => { setModal(null); await refreshAll(); toast(t('tenantAdded')); }} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'tenant' && (
        <TenantSheet
          tenant={{ ...modal.bed.tenant, roomName: room?.name || '', propertyName: tree?.property?.name || '' }}
          onChanged={async () => { await refreshAll(); }}
          onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'propSettings' && tree && (
        <PropSettingsModal prop={tree.property} onDone={async () => { setModal(null); await refreshAll(); }} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

/* ================= PIN pad ================= */
function PinModal({ prop, onOk, onClose }) {
  const { t } = useLang();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  const press = async (d) => {
    if (busy) return;
    if (d === '⌫') { setPin(p => p.slice(0, -1)); return; }
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      try {
        await post(`/properties/${prop.id}/verify-pin`, { pin: next });
        onOk();
      } catch {
        setShake(true);
        setTimeout(() => { setShake(false); setPin(''); setBusy(false); }, 450);
      }
    }
  };

  return (
    <Modal title={`${prop.icon} ${prop.name}`} icon="🔒" onClose={onClose}>
      <p className="muted center">{t('enterPin')}</p>
      <div className={`pin-dots ${shake ? 'shake' : ''}`}>
        {[0, 1, 2, 3].map(i => <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />)}
      </div>
      {shake && <p className="center small" style={{ color: '#ffb3af', marginBottom: 10 }}>{t('wrongPin')}</p>}
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
          k === ''
            ? <span key={i} />
            : <button key={i} className="pin-key" onClick={() => press(k)}>{k}</button>
        )}
      </div>
    </Modal>
  );
}

/* ================= Add property ================= */
function AddPropertyModal({ onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ name: '', type: 'hostel', city: '', floorCount: 1, pin: '', icon: PROP_ICONS[0], color: PROP_COLORS[0] });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await post('/properties', f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('addProperty')} icon="🏠" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🏠 ${t('propertyName')}`}>
          <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Sri Sai Hostel" />
        </Field>
        <Field label={t('businessType')}>
          <div className="type-grid">
            {[['hostel', '🏨'], ['pg', '🏡'], ['flat', '🏢'], ['apartment', '🏬']].map(([v, ico]) => (
              <button type="button" key={v} className={`type-tile ${f.type === v ? 'active' : ''}`}
                onClick={() => setF({ ...f, type: v, icon: ico })}>
                <span className="ico">{ico}</span>{t(v)}
              </button>
            ))}
          </div>
        </Field>
        <div className="row">
          <Field label={`📍 ${t('city')}`}>
            <input className="input" value={f.city} onChange={e => setF({ ...f, city: e.target.value })} placeholder="Hyderabad" />
          </Field>
          <Field label={`🪜 ${t('floorsQ')}`}>
            <input className="input" type="number" min="1" max="30" value={f.floorCount}
              onChange={e => setF({ ...f, floorCount: e.target.value })} />
          </Field>
        </div>
        <Field label={`🎨 Colour`}>
          <div className="row wrap">
            {PROP_COLORS.map(c => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })}
                style={{ width: 42, height: 42, borderRadius: '50%', background: c, border: f.color === c ? '3px solid #fff' : '2px solid rgba(255,255,255,.3)' }} />
            ))}
          </div>
        </Field>
        <Field label={`🔒 ${t('securityPin')}`}>
          <input className="input" inputMode="numeric" maxLength={4} pattern="[0-9]*" value={f.pin}
            onChange={e => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} placeholder="1234" />
          <span className="muted small">{t('pinHint')}</span>
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t('loading') : `✅ ${t('save')}`}</button>
      </form>
    </Modal>
  );
}

/* ================= Add floor ================= */
function AddFloorModal({ propId, count, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState(`Floor ${count}`);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/properties/${propId}/floors`, { name }); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={t('addFloor')} icon="🪜" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={t('floor')}>
          <input className="input" required value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

/* ================= Add room ================= */
function AddRoomModal({ floor, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ name: '', capacity: 2, rent: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/floors/${floor.id}/rooms`, f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={`${t('addRoom')} — ${floor.name}`} icon="🚪" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🚪 ${t('roomName')}`}>
          <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="101" />
        </Field>
        <div className="row">
          <Field label={`🛏️ ${t('bedsQ')}`}>
            <input className="input" type="number" min="1" max="20" required value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} />
          </Field>
          <Field label={`💰 ${t('rentPerBed')}`}>
            <input className="input" type="number" min="0" value={f.rent} onChange={e => setF({ ...f, rent: e.target.value })} placeholder="6500" />
          </Field>
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

/* ================= Add tenant ================= */
function AddTenantModal({ bed, room, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({
    name: '', phone: '', rent: room?.rent || '', deposit: '', maintenance: '', openingDue: '',
    joinDate: new Date().toISOString().slice(0, 10), occupation: '', aadhaar: ''
  });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await post(`/beds/${bed.id}/assign`, f); onDone(); }
    catch (err) { toast(err.message, 'err'); setBusy(false); }
  };
  return (
    <Modal title={`${t('addTenant')} — ${bed.name}`} icon="🧑" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={`🙍 ${t('tenantName')}`}>
          <input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Ravi Kumar" />
        </Field>
        <Field label={`📱 ${t('phone')}`}>
          <input className="input" required inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="9876543210" />
        </Field>
        <div className="row">
          <Field label={`💰 ${t('monthlyRent')}`}>
            <input className="input" type="number" min="0" required value={f.rent} onChange={e => setF({ ...f, rent: e.target.value })} />
          </Field>
          <Field label={`🏦 ${t('deposit')}`}>
            <input className="input" type="number" min="0" value={f.deposit} onChange={e => setF({ ...f, deposit: e.target.value })} />
          </Field>
        </div>
        <div className="row">
          <Field label={`📅 ${t('joinDate')}`}>
            <input className="input" type="date" required value={f.joinDate} onChange={e => setF({ ...f, joinDate: e.target.value })} />
          </Field>
          <Field label={`💼 ${t('occupation')}`}>
            <input className="input" value={f.occupation} onChange={e => setF({ ...f, occupation: e.target.value })} placeholder="Student" />
          </Field>
        </div>
        <div className="row">
          <Field label={`🔧 ${t('maintenanceLabel')}`}>
            <input className="input" type="number" min="0" value={f.maintenance} onChange={e => setF({ ...f, maintenance: e.target.value })} />
          </Field>
          <Field label={`⚠️ ${t('oldBalance')} (₹)`}>
            <input className="input" type="number" min="0" value={f.openingDue} onChange={e => setF({ ...f, openingDue: e.target.value })} />
          </Field>
        </div>
        <Field label={`🪪 ${t('aadhaarNo')}`}>
          <input className="input" value={f.aadhaar} onChange={e => setF({ ...f, aadhaar: e.target.value })} placeholder="XXXX XXXX XXXX" />
        </Field>
        <button className="btn btn-green btn-block" disabled={busy}>✅ {t('save')}</button>
      </form>
    </Modal>
  );
}

/* ================= Property settings ================= */
function PropSettingsModal({ prop, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState(prop.name);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (name !== prop.name) await put(`/properties/${prop.id}`, { name });
      if (pin) await post(`/properties/${prop.id}/set-pin`, { pin });
      onDone();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };
  const removePin = async () => {
    try { await post(`/properties/${prop.id}/set-pin`, { pin: null }); onDone(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Modal title={t('propertySettings')} icon="⚙️" onClose={onClose}>
      <Field label={t('propertyName')}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label={`🔒 ${t('setPin')}`}>
        <input className="input" inputMode="numeric" maxLength={4} value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
      </Field>
      <div className="row">
        {prop.hasPin && <button className="btn grow" onClick={removePin}>🔓 {t('removePin')}</button>}
        <button className="btn btn-primary grow" onClick={save} disabled={busy}>✅ {t('save')}</button>
      </div>
    </Modal>
  );
}
