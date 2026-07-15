import React, { useEffect, useRef, useState } from 'react';
import { useLang, LANGS } from '../i18n.jsx';
import { LangPicker } from '../components/ui.jsx';

/* Marketing site. Pure presentation — auth entry points are the only actions.
   Sections reveal softly on scroll via one shared IntersectionObserver. */

function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const els = root.querySelectorAll('.reveal');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

/* faux dashboard rendered with real app surfaces — reads as a screenshot */
function AppPreview({ t }) {
  return (
    <div className="hero-visual" aria-hidden="true">
      <span className="blob b1" /><span className="blob b2" />
      <div className="app-frame">
        <div className="af-bar"><i /><i /><i /><span>StaySathi · {t('lpDashLabel')}</span></div>
        <div className="af-body">
          <div className="af-greeting">🌅 {t('goodMorning')}, Ramesh!</div>
          <div className="af-stats">
            <div className="af-stat hl"><div className="v">₹82,500</div><div className="k">{t('collected')}</div></div>
            <div className="af-stat"><div className="v">46/52</div><div className="k">{t('occupancy')}</div></div>
            <div className="af-stat"><div className="v">₹6,500</div><div className="k">{t('rentDue')}</div></div>
          </div>
          <div className="af-bars">
            {[36, 52, 44, 66, 58, 78, 70, 94].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
          </div>
          <div className="af-row">
            <span className="av">R</span>
            <div><div className="nm">Ravi Kumar</div><div className="sb">{t('room')} 101 · ₹6,500</div></div>
            <span className="pill ok">✓ {t('paid')}</span>
          </div>
          <div className="af-row">
            <span className="av" style={{ background: 'linear-gradient(135deg,#f59f00,#ffc14d)' }}>A</span>
            <div><div className="nm">Anil Reddy</div><div className="sb">{t('room')} 204 · ₹7,000</div></div>
            <span className="pill due">{t('pending')}</span>
          </div>
        </div>
      </div>
      <div className="float-card fc1">
        <span className="fc-ico">💸</span>
        <div>₹6,500 {t('collected')}<div className="fc-sub">Ravi · UPI</div></div>
      </div>
      <div className="float-card fc2">
        <span className="fc-ico">🔔</span>
        <div>{t('remind')}<div className="fc-sub">WhatsApp · 1 tap</div></div>
      </div>
    </div>
  );
}

export default function Landing({ onLogin, onSignup }) {
  const { t } = useLang();
  const rootRef = useReveal();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);

  const feats = [
    ['🫧', t('feat1t'), t('feat1d')],
    ['💰', t('feat2t'), t('feat2d')],
    ['🪪', t('feat3t'), t('feat3d')],
    ['🗣️', t('feat4t'), t('feat4d')],
    ['📊', t('feat5t'), t('feat5d')],
    ['📢', t('feat6t'), t('feat6d')]
  ];
  const stats = [
    ['6', t('lpStatL1')],
    ['2', t('lpStatL2')],
    ['₹0', t('lpStatL3')],
    ['24/7', t('lpStatL4')]
  ];
  const steps = [
    [t('lpHow1t'), t('lpHow1d')],
    [t('lpHow2t'), t('lpHow2d')],
    [t('lpHow3t'), t('lpHow3d')]
  ];

  return (
    <div className="landing" ref={rootRef}>
      <div className={`lnav-wrap ${scrolled ? 'scrolled' : ''}`}>
        <nav className="landing-nav">
          <div className="logo"><span className="orb">🏠</span>{t('appName')}</div>
          <div className="lnav-links">
            <a href="#features">{t('lpNavFeatures')}</a>
            <a href="#how">{t('lpNavHow')}</a>
            <a href="#pricing">{t('lpNavPricing')}</a>
          </div>
          <div className="row">
            <LangPicker compact />
            <button className="btn btn-sm" onClick={onLogin}>{t('login')}</button>
          </div>
        </nav>
      </div>

      <div className="container">
        <section className="hero">
          <div>
            <span className="hero-badge"><span className="dot-new">✨</span>{t('lpBadge')}</span>
            <h1>{t('heroTitle').split('—')[0]}<br /><span className="grad">{t('heroTitle').split('—')[1] || ''}</span></h1>
            <p>{t('heroSub')}</p>
            <div className="hero-cta">
              <button className="btn btn-primary" onClick={onSignup}>{t('getStarted')} →</button>
              <button className="btn" onClick={onLogin}>▶ {t('tryDemo')}</button>
            </div>
            <div className="hero-trust">
              <span className="chip">🏨 {t('hostel')}</span>
              <span className="chip">🏡 {t('pg')}</span>
              <span className="chip">🏢 {t('flat')}</span>
              <span className="chip">🏬 {t('apartment')}</span>
            </div>
            <p className="muted small mt16">{t('demoHint')}</p>
          </div>
          <AppPreview t={t} />
        </section>

        <div className="stats-band reveal">
          {stats.map(([n, l]) => (
            <div key={l} className="stat-b"><div className="n">{n}</div><div className="l">{l}</div></div>
          ))}
        </div>

        <h2 className="section-title reveal" id="features">{t('featTitle')}</h2>
        <div className="feature-grid">
          {feats.map(([ico, title, desc]) => (
            <div key={title} className="card feature reveal">
              <span className="ico">{ico}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>

        <h2 className="section-title reveal" id="how">{t('lpHowTitle')}</h2>
        <p className="section-sub reveal">{t('lpHowSub')}</p>
        <div className="how-grid">
          {steps.map(([title, desc], i) => (
            <div key={title} className="card how-step reveal">
              <div className="num">{i + 1}</div>
              <h3>{title}</h3>
              <p>{desc}</p>
            </div>
          ))}
        </div>

        <h2 className="section-title reveal">{t('feat4t')}</h2>
        <div className="lang-strip reveal">
          {LANGS.map(l => <span key={l.code} className="chip">{l.flag} {l.native}</span>)}
        </div>

        <h2 className="section-title reveal" id="pricing">{t('pricingTitle')}</h2>
        <p className="section-sub reveal">{t('priceNote')}</p>
        <div className="price-grid">
          <div className="card price-card reveal">
            <div className="chip">{t('freePlan')}</div>
            <div className="price">{t('priceFree')}</div>
            <ul>
              {t('priceFreeSub').split('·').map(s => <li key={s}>{s.trim()}</li>)}
            </ul>
            <button className="btn btn-block mt24" onClick={onSignup}>{t('getStarted')}</button>
          </div>
          <div className="card price-card pro reveal">
            <div className="chip active">⭐ {t('premiumPlan')}</div>
            <div className="price">{t('pricePro')}</div>
            <ul>
              {t('priceProSub').split('·').map(s => <li key={s}>{s.trim()}</li>)}
            </ul>
            <button className="btn btn-primary btn-block mt24" onClick={onSignup}>{t('getStarted')}</button>
          </div>
        </div>

        <div className="cta-band reveal">
          <h2>{t('lpCtaTitle')}</h2>
          <p>{t('lpCtaSub')}</p>
          <button className="btn" onClick={onSignup}>{t('getStarted')} →</button>
        </div>

        <footer>
          <div className="lfoot">
            <div>
              <div className="logo"><span className="orb">🏠</span>{t('appName')}</div>
              <p>{t('tagline')}</p>
            </div>
            <div>
              <h4>{t('lpFootProduct')}</h4>
              <a href="#features">{t('lpNavFeatures')}</a>
              <a href="#how">{t('lpNavHow')}</a>
              <a href="#pricing">{t('lpNavPricing')}</a>
              <a onClick={onLogin} style={{ cursor: 'pointer' }}>{t('login')}</a>
            </div>
            <div>
              <h4>{t('lpFootLangs')}</h4>
              {LANGS.map(l => <span key={l.code} className="item">{l.flag} {l.native}</span>)}
            </div>
          </div>
          <div className="lfoot-bottom">
            <span>© {new Date().getFullYear()} {t('appName')}</span>
            <span>{t('madeWith')}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
