import React, { useEffect, useRef, useState } from 'react';

/* Tiny celebration + motion helpers — no dependencies. */

const CONFETTI_COLORS = ['#6c5ce7', '#0ea97f', '#f59f00', '#ec4899', '#3b82f6', '#e5484d', '#2fd3a5', '#ffc14d'];

/* Fire a confetti burst from the middle of the screen (rent collected,
   dues cleared…). Pieces are plain divs animated with WAAPI and removed
   when done, so repeated bursts never leak nodes. */
export function confetti({ count = 90, big = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'confetti-layer';
  document.body.appendChild(wrap);
  const W = window.innerWidth, H = window.innerHeight;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const size = 6 + Math.random() * (big ? 9 : 6);
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    p.style.cssText = `width:${size}px;height:${size * (Math.random() > .5 ? 1 : 2.2)}px;background:${color};` +
      (Math.random() > .6 ? 'border-radius:50%;' : 'border-radius:2px;');
    wrap.appendChild(p);
    const x0 = W / 2 + (Math.random() - .5) * 120;
    const y0 = H * 0.38;
    const dx = (Math.random() - .5) * W * 0.9;
    const dy = H * (0.5 + Math.random() * 0.45);
    const rise = -(120 + Math.random() * 260);
    const spin = 360 + Math.random() * 720;
    const dur = 1400 + Math.random() * 1200;
    p.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${x0 + dx * .35}px, ${y0 + rise}px) rotate(${spin / 2}deg)`, opacity: 1, offset: .28 },
      { transform: `translate(${x0 + dx}px, ${y0 + dy}px) rotate(${spin}deg)`, opacity: 0 }
    ], { duration: dur, easing: 'cubic-bezier(.16,.8,.4,1)', fill: 'forwards' });
  }
  setTimeout(() => wrap.remove(), 2900);
}

/* Animated number — counts from the previous value to the new one.
   Formats with the given fn (defaults to Indian-style thousands). */
export function CountUp({ value, format, duration = 700 }) {
  const fmt = format || ((n) => Math.round(n).toLocaleString('en-IN'));
  const target = Number(value) || 0;
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) { setShown(target); return; }
    let raf; const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return <>{fmt(shown)}</>;
}

/* ₹-formatted CountUp, the common case for money tiles. */
export function RupeeCount({ value }) {
  return <CountUp value={value} format={(n) => '₹' + Math.round(n).toLocaleString('en-IN')} />;
}

/* Animated SVG progress ring (collection rate, occupancy…). */
export function ProgressRing({ pct = 0, size = 92, stroke = 9, color = 'var(--green)', track = 'var(--surface2)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * clamped) / 100}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.3,.8,.3,1)' }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}
