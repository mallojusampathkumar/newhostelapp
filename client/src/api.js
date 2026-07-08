// Thin fetch wrapper. Token lives in localStorage.
const BASE = '/api';

export function getToken() { return localStorage.getItem('ss_token'); }
export function setToken(t) { t ? localStorage.setItem('ss_token', t) : localStorage.removeItem('ss_token'); }

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.code = data?.code;
    // account got blocked / trial expired mid-session → let the app shell react
    if (res.status === 403 && (data?.code === 'blocked' || data?.code === 'pending')) {
      window.dispatchEvent(new CustomEvent('ss-access', { detail: { code: data.code } }));
    }
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });
