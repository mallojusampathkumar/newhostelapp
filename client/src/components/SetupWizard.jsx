import React, { useState } from 'react';
import { post } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

/* Step-by-step first-time setup: name → floors → rooms & beds → review.
   Creates the property with auto-numbered rooms (G01, 101, 102 …) and all
   beds in one shot. */

const TYPES = [['hostel', '🏨'], ['pg', '🏡'], ['flat', '🏢'], ['apartment', '🏬']];

export default function SetupWizard({ onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', type: 'hostel', icon: '🏨', city: '', pin: '',
    floors: 2, roomsPerFloor: 4, bedsPerRoom: 3, rent: 6000
  });

  const steps = [t('stepName'), t('stepFloors'), t('stepRooms'), t('stepReview')];
  const roomsTotal = Number(f.floors) * Number(f.roomsPerFloor);
  const bedsTotal = roomsTotal * Number(f.bedsPerRoom);

  const sampleRooms = () => {
    const out = [];
    for (let fl = 0; fl < Math.min(Number(f.floors), 3); fl++) {
      for (let r = 1; r <= Math.min(Number(f.roomsPerFloor), 3); r++) {
        out.push(fl === 0 ? `G${String(r).padStart(2, '0')}` : `${fl}${String(r).padStart(2, '0')}`);
      }
      out.push('…');
    }
    return out.slice(0, 11);
  };

  const create = async () => {
    setBusy(true);
    try {
      await post('/setup', f);
      toast(t('wizardDone'));
      onDone();
    } catch (e) { toast(e.message, 'err'); setBusy(false); }
  };

  const canNext = step !== 0 || f.name.trim();

  return (
    <Modal title={`🪄 ${t('setupWizard')}`} onClose={onClose}>
      {/* progress dots */}
      <div className="wizard-steps mb16">
        {steps.map((s, i) => (
          <div key={i} className={`wizard-step ${i === step ? 'on' : i < step ? 'done' : ''}`}>
            <span className="dot">{i < step ? '✓' : i + 1}</span>
            <span className="lbl">{s}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
          <p className="muted small mb16">👋 {t('setupWelcome')}</p>
          <Field label={`🏠 ${t('propertyName')}`}>
            <input className="input" autoFocus required value={f.name} placeholder="Sri Sai Hostel"
              onChange={e => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label={t('businessType')}>
            <div className="type-grid">
              {TYPES.map(([v, ico]) => (
                <button type="button" key={v} className={`type-tile ${f.type === v ? 'active' : ''}`}
                  onClick={() => setF({ ...f, type: v, icon: ico })}>
                  <span className="ico">{ico}</span>{t(v)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`📍 ${t('city')}`}>
            <input className="input" value={f.city} placeholder="Hyderabad" onChange={e => setF({ ...f, city: e.target.value })} />
          </Field>
        </>
      )}

      {step === 1 && (
        <>
          <Field label={`🪜 ${t('floorsQ')}`}>
            <Stepper value={f.floors} min={1} max={30} onChange={v => setF({ ...f, floors: v })} />
          </Field>
          <p className="muted small">🏢 {t('groundFloor')} + {Math.max(0, f.floors - 1)} ×  {t('floor')}</p>
        </>
      )}

      {step === 2 && (
        <>
          <Field label={`🚪 ${t('roomsPerFloor')}`}>
            <Stepper value={f.roomsPerFloor} min={1} max={40} onChange={v => setF({ ...f, roomsPerFloor: v })} />
          </Field>
          <Field label={`🛏️ ${t('bedsPerRoom')}`}>
            <Stepper value={f.bedsPerRoom} min={1} max={20} onChange={v => setF({ ...f, bedsPerRoom: v })} />
          </Field>
          <Field label={`💰 ${t('defaultRent')}`}>
            <input className="input" type="number" min="0" value={f.rent} onChange={e => setF({ ...f, rent: e.target.value })} />
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <div className="card mb16" style={{ padding: 14 }}>
            <div className="row spread"><span className="muted small">🏠</span><b>{f.icon} {f.name}</b></div>
            <div className="row spread mt8"><span className="muted small">🪜 {t('floors')}</span><b>{f.floors}</b></div>
            <div className="row spread mt8"><span className="muted small">🚪 {t('rooms')}</span><b>{roomsTotal}</b></div>
            <div className="row spread mt8"><span className="muted small">🛏️ {t('beds')}</span><b>{bedsTotal}</b></div>
            <div className="row spread mt8"><span className="muted small">💰 {t('rentPerBed')}</span><b>₹{Number(f.rent).toLocaleString('en-IN')}</b></div>
          </div>
          <p className="muted small mb16">🔢 {t('roomNumbersAuto')}</p>
          <div className="row wrap mb16">
            {sampleRooms().map((r, i) => <span key={i} className="chip">{r}</span>)}
          </div>
          <Field label={`🔒 ${t('securityPin')}`}>
            <input className="input" inputMode="numeric" maxLength={4} value={f.pin}
              onChange={e => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} placeholder="1234" />
          </Field>
        </>
      )}

      <div className="row mt16">
        {step > 0 && <button className="btn grow" onClick={() => setStep(step - 1)}>← {t('previous')}</button>}
        {step < 3 && <button className="btn btn-primary grow" disabled={!canNext} onClick={() => setStep(step + 1)}>{t('next')} →</button>}
        {step === 3 && <button className="btn btn-green grow" disabled={busy} onClick={create}>🪄 {t('createProperty')}</button>}
      </div>
    </Modal>
  );
}

function Stepper({ value, min, max, onChange }) {
  const v = Number(value) || min;
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(Math.max(min, v - 1))}>−</button>
      <b>{v}</b>
      <button type="button" onClick={() => onChange(Math.min(max, v + 1))}>+</button>
    </div>
  );
}
