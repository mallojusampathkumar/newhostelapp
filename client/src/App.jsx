import React, { useEffect, useState, createContext, useContext, useCallback } from 'react';
import { LangProvider, useLang } from './i18n.jsx';
import { get, setToken, getToken } from './api.js';
import Landing from './pages/Landing.jsx';
import Auth from './pages/Auth.jsx';
import Shell from './pages/Shell.jsx';
import Portal from './pages/Portal.jsx';
import Blocked from './pages/Blocked.jsx';

/* toast system, shared app-wide */
const ToastContext = createContext(() => {});
export function useToast() { return useContext(ToastContext); }

function Toasts({ items }) {
  return (
    <div className="toast-wrap">
      {items.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
    </div>
  );
}

function Root() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('boot'); // boot | landing | login | signup | app | portal
  const [toasts, setToasts] = useState([]);
  const { setLang } = useLang();

  // public tenant portal — /portal/<token> works without login
  const portalToken = window.location.pathname.startsWith('/portal/')
    ? window.location.pathname.split('/portal/')[1]?.split('/')[0]
    : null;

  const toast = useCallback((msg, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(x => [...x, { id, msg, kind }]);
    setTimeout(() => setToasts(x => x.filter(t => t.id !== id)), 2600);
  }, []);

  useEffect(() => {
    if (portalToken) { setView('portal'); return; }
    if (!getToken()) { setView('landing'); return; }
    get('/me')
      .then(({ user }) => { setUser(user); if (user.language) setLang(user.language); setView('app'); })
      .catch(() => { setToken(null); setView('landing'); });
  }, [setLang, portalToken]);

  // account blocked / approval revoked mid-session → re-check and lock the UI
  useEffect(() => {
    const h = () => {
      get('/me').then(({ user }) => setUser(user)).catch(() => {});
    };
    window.addEventListener('ss-access', h);
    return () => window.removeEventListener('ss-access', h);
  }, []);

  const onAuthed = (u, token) => {
    setToken(token);
    setUser(u);
    if (u.language) setLang(u.language);
    setView('app');
  };
  const logout = () => { setToken(null); setUser(null); setView('landing'); };

  if (view === 'boot') {
    return <div className="auth-wrap"><div className="bubble hero-bubble"><span className="ico">🏠</span><span className="name">StaySathi</span></div></div>;
  }

  return (
    <ToastContext.Provider value={toast}>
      {view === 'portal' && <Portal token={portalToken} />}
      {view === 'landing' && <Landing onLogin={() => setView('login')} onSignup={() => setView('signup')} />}
      {(view === 'login' || view === 'signup') && (
        <Auth mode={view} onAuthed={onAuthed} onSwitch={m => setView(m)} onBack={() => setView('landing')} />
      )}
      {view === 'app' && user && ['blocked', 'pending', 'rejected'].includes(user.access?.status) && (
        <Blocked user={user} onRecheck={() => get('/me').then(({ user: u }) => setUser(u)).catch(() => {})} onLogout={logout} />
      )}
      {view === 'app' && user && !['blocked', 'pending', 'rejected'].includes(user.access?.status) && (
        <Shell user={user} setUser={setUser} onLogout={logout} />
      )}
      <Toasts items={toasts} />
    </ToastContext.Provider>
  );
}

export default function App() {
  return (
    <LangProvider>
      <Root />
    </LangProvider>
  );
}
