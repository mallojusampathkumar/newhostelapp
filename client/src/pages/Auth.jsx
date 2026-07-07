import React, { useState } from 'react';
import { post } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Field, LangPicker } from '../components/ui.jsx';
import { useToast } from '../App.jsx';

const TYPES = [
  ['hostel', '🏨'], ['pg', '🏡'], ['flat', '🏢'], ['apartment', '🏬']
];

export default function Auth({ mode, onAuthed, onSwitch, onBack }) {
  const { t, lang } = useLang();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', password: '', email: '', businessType: 'hostel' });
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = isLogin
        ? { phone: form.phone, password: form.password }
        : { ...form, language: lang };
      const data = await post(isLogin ? '/auth/login' : '/auth/signup', body);
      onAuthed(data.user, data.token);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <div className="row spread mb16">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>← {t('back')}</button>
          <LangPicker compact />
        </div>
        <h2>{isLogin ? <>👋 {t('welcomeBack')}</> : <>🚀 {t('signup')}</>}</h2>
        <p className="sub">{isLogin ? t('loginSub') : t('signupSub')}</p>

        {!isLogin && (
          <Field label={`🙍 ${t('yourName')}`}>
            <input className="input" required value={form.name} onChange={set('name')} placeholder="Ramesh Kumar" />
          </Field>
        )}
        <Field label={`📱 ${t('phone')}`}>
          <input className="input" required inputMode="numeric" pattern="[0-9]{10,}" maxLength={12}
            value={form.phone} onChange={set('phone')} placeholder="9876543210" />
        </Field>
        <Field label={`🔒 ${t('password')}`}>
          <input className="input" required type="password" minLength={4}
            value={form.password} onChange={set('password')} placeholder="••••••" />
        </Field>
        {!isLogin && (
          <>
            <Field label={`✉️ ${t('email')}`}>
              <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
            </Field>
            <Field label={`🏠 ${t('businessType')}`}>
              <div className="type-grid">
                {TYPES.map(([v, ico]) => (
                  <button type="button" key={v}
                    className={`type-tile ${form.businessType === v ? 'active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, businessType: v }))}>
                    <span className="ico">{ico}</span>{t(v)}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}

        <button className="btn btn-primary btn-block mt8" disabled={busy}>
          {busy ? t('loading') : (isLogin ? `🔓 ${t('login')}` : `🎉 ${t('signup')}`)}
        </button>
        <button type="button" className="btn btn-ghost btn-block mt8" onClick={() => onSwitch(isLogin ? 'signup' : 'login')}>
          {isLogin ? t('noAccount') : t('haveAccount')}
        </button>
        {isLogin && <p className="muted small center mt8">{t('demoHint')}</p>}
      </form>
    </div>
  );
}
